#!/usr/bin/env node
/**
 * REFERENCE SENDER — what the ERP does to provision a website (docs/provisioning-protocol.md).
 * For development and for the ERP team to test against; it is not part of the storefront runtime.
 *
 *   upsert: node scripts/provision-send.mjs upsert --website <ULID> --revision <n> \
 *             --primary a.feriwala.shop --subdomain a.feriwala.shop [--aliases x.com,y.com] < credential.json
 *           (stdin: {"keyId":"wsk_…","secret":"<64 hex>"} — never argv)
 *   upsert --from-registry: re-sends the credential already in the dev registry (decrypted in-process,
 *           never printed) — used to move an operator-provisioned entry onto the channel.
 *   remove: node scripts/provision-send.mjs remove --website <ULID> --revision <n>
 *
 * Options: --url (default http://127.0.0.1:3000/api/internal/registry), --host (default from env).
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createClient } from "redis";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);

const [op, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) {
  const name = rest[i].replace(/^--/, "");
  if (rest[i + 1] === undefined || rest[i + 1].startsWith("--")) args[name] = true;
  else args[name] = rest[++i];
}
const fail = (message) => {
  console.error(`provision-send: ${message}`);
  process.exit(1);
};
if (!["upsert", "remove"].includes(op)) fail("usage: provision-send.mjs upsert|remove --website <id> --revision <n> …");
if (!/^[0-9A-Z]{26}$/.test(args.website ?? "")) fail("--website must be a ULID");
const revision = Number(args.revision);
if (!Number.isSafeInteger(revision) || revision < 1) fail("--revision must be a positive integer");

const env = process.env;
const url = args.url ?? "http://127.0.0.1:3000/api/internal/registry";
const host = args.host ?? env.STOREFRONT_PROVISIONING_HOST;
// The ERP holds the storefront's PUBLIC key; this dev sender derives it from the private one in .env.local.
const recipient = createPublicKey(createPrivateKey({ key: Buffer.from(env.STOREFRONT_PROVISIONING_PRIVATE_KEY ?? "", "base64"), format: "der", type: "pkcs8" }));

let body;
if (op === "remove") {
  body = { op, website_id: args.website, revision };
} else {
  const source = args["from-registry-of"] ?? (args["from-registry"] ? args.website : null);
  const credential = source ? await fromRegistry(source) : JSON.parse(await stdin());
  if (!/^wsk_[0-9A-Z]{26}$/.test(credential.keyId ?? "") || !/^[0-9a-f]{64}$/.test(credential.secret ?? "")) fail("bad credential");
  const binding = `${args.website}|${credential.keyId}|${revision}`;
  body = {
    op,
    website_id: args.website,
    revision,
    hosts: {
      primary: args.primary,
      subdomain: args.subdomain ?? args.primary,
      aliases: typeof args.aliases === "string" ? args.aliases.split(",").filter(Boolean) : [],
    },
    credential: { key_id: credential.keyId, sealed_secret: seal(credential.secret, binding) },
  };
}

const raw = JSON.stringify(body);
const timestamp = Math.floor(Date.now() / 1000).toString();
const nonce = randomUUID();
const canonical = ["POST", "/api/internal/registry", timestamp, nonce, createHash("sha256").update(raw).digest("hex")].join("\n");
const signature = createHmac("sha256", Buffer.from(env.STOREFRONT_PROVISIONING_SECRET ?? "", "base64")).update(canonical).digest("hex");
// node:http rather than fetch: fetch drops a caller-supplied Host header, and the internal host is
// what selects the provisioning route.
const send = () =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(
      target,
      {
        method: "POST",
        headers: {
          host,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(raw),
          "x-banij-provisioning-key-id": env.STOREFRONT_PROVISIONING_KEY_ID ?? "",
          "x-banij-timestamp": timestamp,
          "x-banij-nonce": nonce,
          "x-banij-signature": `sha256=${signature}`,
        },
      },
      (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => resolve({ status: response.statusCode, text }));
      },
    );
    request.on("error", reject);
    request.end(raw);
  });
let response = await send();
console.log(response.status, response.text);
// --twice: re-sends the byte-identical signed request, which must be refused as a replay.
if (args.twice) {
  response = await send();
  console.log("replay:", response.status, response.text);
  process.exit(response.status === 401 ? 0 : 1);
}
process.exit(response.status >= 200 && response.status < 300 ? 0 : 1);

function seal(plaintext, binding) {
  const ephemeral = generateKeyPairSync("x25519");
  const epk = Buffer.from(ephemeral.publicKey.export({ format: "jwk" }).x, "base64url");
  const recipientRaw = Buffer.from(recipient.export({ format: "jwk" }).x, "base64url");
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([epk, recipientRaw]), Buffer.from(`banij-storefront-provisioning-v1|${binding}`), 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(binding));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { epk: epk.toString("base64url"), iv: iv.toString("base64url"), ct: ct.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}

async function fromRegistry(website) {
  const client = createClient({ url: env.STOREFRONT_REDIS_URL });
  await client.connect();
  const entry = JSON.parse((await client.get(`bsf:registry:website:${website}`)) ?? "null");
  await client.quit();
  if (!entry?.encryptedSecret) fail("no registry entry to re-send");
  const sealed = Buffer.from(entry.encryptedSecret, "base64");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(env.STOREFRONT_REGISTRY_KEY, "base64"), sealed.subarray(0, 12));
  decipher.setAAD(Buffer.from(`website:${website}`));
  decipher.setAuthTag(sealed.subarray(12, 28));
  const secret = Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString("utf8");
  return { keyId: entry.keyId, secret };
}

async function stdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
