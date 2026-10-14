import "server-only";
import { decryptSecret } from "./crypto";
import { env } from "./env";
import { keys, redis } from "./redis";

/**
 * The server-side credential registry (D30 §2). Maps a verified host to a website, and a website
 * to its own Storefront API credential. The secret is stored AES-256-GCM encrypted, bound to the
 * website key as additional data so a ciphertext copied onto another website's entry fails to
 * decrypt.
 *
 * Interim provisioning: until the ERP's authenticated provisioning channel exists (D30 §2, phase
 * P3), entries are written by `scripts/registry.mjs` from an operator's terminal. Nothing reads a
 * website, account or credential identifier from a request, cookie or query string.
 */
export type RegistryEntry = {
  websiteKey: string;
  keyId: string;
  encryptedSecret: string;
  hosts: string[];
  primaryHost: string;
  updatedAt: string;
};

export type Credential = { websiteKey: string; keyId: string; secret: string };

export async function websiteKeyForHost(host: string): Promise<string | null> {
  const client = await redis();
  return client.get(keys.host(host));
}

export async function registryEntry(websiteKey: string): Promise<RegistryEntry | null> {
  const client = await redis();
  const raw = await client.get(keys.website(websiteKey));
  if (!raw) {
    return null;
  }
  const entry = JSON.parse(raw) as RegistryEntry & { removed?: boolean };
  // A removed website keeps a tombstone (for revision ordering) and serves nothing.
  if (entry.websiteKey !== websiteKey || entry.removed || !entry.keyId || !Array.isArray(entry.hosts)) {
    return null;
  }
  return entry;
}

export function credentialOf(entry: RegistryEntry): Credential {
  return {
    websiteKey: entry.websiteKey,
    keyId: entry.keyId,
    secret: decryptSecret(entry.encryptedSecret, env.registryKey, `website:${entry.websiteKey}`),
  };
}
