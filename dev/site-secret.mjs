#!/usr/bin/env node
/**
 * DEPRECATED (Phase 1): superseded by dev/dev-env.mjs (credentials in .env, not a secret file).
 * Kept until the approved legacy cleanup.
 *
 * DEVELOPMENT ONLY. Writes a website's credential secret from the dev registry to a 0600 file, for a
 * single-website build to read via BANIJ_CREDENTIAL_SECRET_FILE. Prints nothing secret.
 *   node dev/site-secret.mjs <website id> <output file>
 */
import { createDecipheriv } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { createClient } from "redis";

for (const file of [".env.local"]) if (existsSync(file)) process.loadEnvFile(file);
const [website, out] = process.argv.slice(2);
if (!/^[0-9A-Z]{26}$/.test(website ?? "") || !out) {
  console.error("usage: site-secret.mjs <website id> <output file>");
  process.exit(1);
}
const client = createClient({ url: process.env.STOREFRONT_REDIS_URL });
await client.connect();
const entry = JSON.parse((await client.get(`bsf:registry:website:${website}`)) ?? "null");
await client.quit();
if (!entry?.encryptedSecret) {
  console.error("no registry entry");
  process.exit(1);
}
const sealed = Buffer.from(entry.encryptedSecret, "base64");
const decipher = createDecipheriv("aes-256-gcm", Buffer.from(process.env.STOREFRONT_REGISTRY_KEY, "base64"), sealed.subarray(0, 12));
decipher.setAAD(Buffer.from(`website:${website}`));
decipher.setAuthTag(sealed.subarray(12, 28));
writeFileSync(out, Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]), { mode: 0o600 });
console.log(`secret for ${website} written to ${out} (0600); key ${entry.keyId.slice(0, 8)}…`);
