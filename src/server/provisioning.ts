import "server-only";
import { z } from "zod";
import type { Site } from "@/lib/types";
import { constantTimeEqualHex, encryptSecret, hmacHex, randomToken, sha256Hex } from "./crypto";
import { env } from "./env";
import { ErpError, ErpUnavailable, erpRequest } from "./erp";
import { normalizeHost } from "./host";
import { bindingOf, open, privateKeyFromBase64 } from "./provisioning-crypto";
import { keys, redis } from "./redis";
import type { RegistryEntry } from "./registry";
import { storefrontMode } from "./site-config";

/**
 * The receiving end of the ERP → storefront credential provisioning channel (D30 §2,
 * docs/provisioning-protocol.md). The ERP pushes; the storefront verifies, opens, checks the
 * credential against the ERP itself, and writes the encrypted registry entry. No secret is logged,
 * returned or stored in the clear.
 */
export const PROVISIONING_PATH = "/api/internal/registry";
const CLOCK_SKEW_SECONDS = 300;
const NONCE_TTL_SECONDS = 600;

export type ProvisioningConfig = { host: string; keyId: string; secret: string; privateKeyDer: string };

/**
 * Null — and the endpoint answers 404 — unless every part is configured AND the deployment runs in
 * legacy shared development mode. A single installation never exposes provisioning (P3: manual .env
 * only). No partial mode exists.
 */
export function provisioningConfig(): ProvisioningConfig | null {
  if (storefrontMode() !== "shared") {
    return null;
  }
  const host = process.env.STOREFRONT_PROVISIONING_HOST?.toLowerCase();
  const keyId = process.env.STOREFRONT_PROVISIONING_KEY_ID;
  const secret = process.env.STOREFRONT_PROVISIONING_SECRET;
  const privateKeyDer = process.env.STOREFRONT_PROVISIONING_PRIVATE_KEY;
  if (!host || !keyId || !secret || !privateKeyDer || Buffer.from(secret, "base64").length < 32) {
    return null;
  }
  return { host, keyId, secret, privateKeyDer };
}

export function isProvisioningRequest(rawHost: string | null, pathname: string): boolean {
  const config = provisioningConfig();
  return Boolean(config && pathname === PROVISIONING_PATH && normalizeHost(rawHost) === config.host);
}

export function provisioningCanonical(timestamp: string, nonce: string, body: string): string {
  return ["POST", PROVISIONING_PATH, timestamp, nonce, sha256Hex(body)].join("\n");
}

const ULID = /^[0-9A-Z]{26}$/;
const b64url = z.string().regex(/^[A-Za-z0-9_-]+$/).max(4096);

export const provisioningSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("upsert"),
    website_id: z.string().regex(ULID),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    hosts: z.object({
      primary: z.string().max(253),
      subdomain: z.string().max(253),
      aliases: z.array(z.string().max(253)).max(20),
    }),
    credential: z.object({
      key_id: z.string().regex(/^wsk_[0-9A-Z]{26}$/),
      sealed_secret: z.object({ epk: b64url, iv: b64url, ct: b64url, tag: b64url }),
    }),
  }),
  z.object({
    op: z.literal("remove"),
    website_id: z.string().regex(ULID),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
]);

export type ProvisioningOutcome =
  | { status: 200; body: { status: "applied" | "unchanged" | "stale"; revision: number } }
  | { status: 400 | 401 | 409 | 422 | 503; body: { error: string } };

type Headers = { get(name: string): string | null };

export function verifySignature(config: ProvisioningConfig, headers: Headers, body: string, now = Date.now()): string | null {
  const keyId = headers.get("x-banij-provisioning-key-id");
  const timestamp = headers.get("x-banij-timestamp") ?? "";
  const nonce = headers.get("x-banij-nonce") ?? "";
  const signature = headers.get("x-banij-signature") ?? "";
  if (keyId !== config.keyId) return "unknown_key";
  if (!/^\d{9,11}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > CLOCK_SKEW_SECONDS) return "stale_timestamp";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce)) return "malformed_nonce";
  const match = /^sha256=([0-9a-f]{64})$/.exec(signature);
  const expected = hmacHex(Buffer.from(config.secret, "base64"), provisioningCanonical(timestamp, nonce, body));
  if (!match || !constantTimeEqualHex(match[1], expected)) return "invalid_signature";
  return null;
}

export async function handleProvisioning(headers: Headers, body: string): Promise<ProvisioningOutcome> {
  const config = provisioningConfig();
  if (!config) {
    return { status: 503, body: { error: "provisioning_disabled" } };
  }
  const refusal = verifySignature(config, headers, body);
  if (refusal) {
    audit("refused", { reason: refusal });
    return { status: 401, body: { error: "unauthenticated" } };
  }
  const client = await redis();
  const nonce = (headers.get("x-banij-nonce") ?? "").toLowerCase();
  if ((await client.set(`bsf:provisioning:nonce:${nonce}`, "1", { NX: true, EX: NONCE_TTL_SECONDS })) !== "OK") {
    audit("refused", { reason: "replayed_nonce" });
    return { status: 401, body: { error: "unauthenticated" } };
  }

  let parsed: z.infer<typeof provisioningSchema>;
  try {
    parsed = provisioningSchema.parse(JSON.parse(body));
  } catch {
    return { status: 422, body: { error: "validation_failed" } };
  }

  const lockKey = `bsf:provisioning:lock:${parsed.website_id}`;
  const token = randomToken(12);
  if ((await client.set(lockKey, token, { NX: true, PX: 30000 })) !== "OK") {
    return { status: 409, body: { error: "in_progress" } };
  }
  try {
    const raw = await client.get(keys.website(parsed.website_id));
    const current = raw ? (JSON.parse(raw) as RegistryEntry & { revision?: number }) : null;
    const currentRevision = current?.revision ?? 0;
    if (parsed.revision < currentRevision) {
      audit("stale", { website: parsed.website_id, revision: parsed.revision, current: currentRevision });
      return { status: 200, body: { status: "stale", revision: currentRevision } };
    }
    if (parsed.revision === currentRevision && current) {
      return { status: 200, body: { status: "unchanged", revision: currentRevision } };
    }

    if (parsed.op === "remove") {
      const multi = client.multi();
      for (const host of current?.hosts ?? []) multi.del(keys.host(host));
      multi.set(keys.website(parsed.website_id), JSON.stringify({ websiteKey: parsed.website_id, removed: true, revision: parsed.revision }));
      multi.incr(keys.cacheVersion(parsed.website_id));
      await multi.exec();
      await purgeSiteCache(parsed.website_id);
      audit("removed", { website: parsed.website_id, revision: parsed.revision });
      return { status: 200, body: { status: "applied", revision: parsed.revision } };
    }

    const hosts = [...new Set([parsed.hosts.primary, parsed.hosts.subdomain, ...parsed.hosts.aliases].map((h) => normalizeHost(h)))];
    if (hosts.some((h) => h === null) || !hosts.includes(normalizeHost(parsed.hosts.primary))) {
      return { status: 422, body: { error: "invalid_host" } };
    }
    const validHosts = hosts as string[];
    for (const host of validHosts) {
      const owner = await client.get(keys.host(host));
      if (owner && owner !== parsed.website_id) {
        audit("refused", { website: parsed.website_id, reason: "host_conflict" });
        return { status: 409, body: { error: "host_conflict" } };
      }
    }

    let secret: string;
    try {
      secret = open(parsed.credential.sealed_secret, privateKeyFromBase64(config.privateKeyDer), bindingOf(parsed.website_id, parsed.credential.key_id, parsed.revision));
    } catch {
      audit("refused", { website: parsed.website_id, reason: "unsealable" });
      return { status: 422, body: { error: "unsealable_secret" } };
    }
    if (!/^[0-9a-f]{64}$/.test(secret)) {
      return { status: 422, body: { error: "unsealable_secret" } };
    }

    // The credential must open this website's own /site on its own primary host before it is stored.
    const primary = normalizeHost(parsed.hosts.primary)!;
    try {
      const { data } = await erpRequest<{ data: Site }>(
        { websiteKey: parsed.website_id, keyId: parsed.credential.key_id, secret },
        "GET",
        "/site",
        { statedHost: primary },
      );
      if (data.data.id !== parsed.website_id) {
        audit("refused", { website: parsed.website_id, reason: "website_mismatch" });
        return { status: 422, body: { error: "credential_website_mismatch" } };
      }
    } catch (error) {
      // A suspended website's credential is refused by the ERP but must still be registered, so the
      // storefront can show its unavailable page (D30 §4, D6).
      const suspended = error instanceof ErpError && error.body.code === "website_unavailable";
      if (!suspended) {
        audit("refused", { website: parsed.website_id, reason: error instanceof ErpError ? error.body.code : "erp_unreachable" });
        return error instanceof ErpUnavailable
          ? { status: 503, body: { error: "erp_unreachable" } }
          : { status: 422, body: { error: "credential_rejected" } };
      }
    }

    const entry: RegistryEntry & { revision: number } = {
      websiteKey: parsed.website_id,
      keyId: parsed.credential.key_id,
      encryptedSecret: encryptSecret(secret, env.registryKey, `website:${parsed.website_id}`),
      hosts: validHosts,
      primaryHost: primary,
      updatedAt: new Date().toISOString(),
      revision: parsed.revision,
    };
    const multi = client.multi();
    for (const old of current?.hosts ?? []) {
      if (!validHosts.includes(old)) multi.del(keys.host(old));
    }
    multi.set(keys.website(parsed.website_id), JSON.stringify(entry));
    for (const host of validHosts) multi.set(keys.host(host), parsed.website_id);
    multi.incr(keys.cacheVersion(parsed.website_id));
    await multi.exec();
    await purgeSiteCache(parsed.website_id);
    audit("applied", { website: parsed.website_id, revision: parsed.revision, key: `${parsed.credential.key_id.slice(0, 8)}…`, hosts: validHosts.length });
    return { status: 200, body: { status: "applied", revision: parsed.revision } };
  } finally {
    await client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", {
      keys: [lockKey],
      arguments: [token],
    });
  }
}

async function purgeSiteCache(websiteKey: string): Promise<void> {
  const client = await redis();
  for await (const batch of client.scanIterator({ MATCH: `${keys.site(websiteKey)}*`, COUNT: 100 })) {
    if (batch.length > 0) await client.del(batch);
  }
}

/** Structured, secret-free audit line. */
function audit(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ at: new Date().toISOString(), channel: "provisioning", event, ...fields }));
}
