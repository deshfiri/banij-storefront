#!/usr/bin/env node
/**
 * DEVELOPMENT ONLY. Writes an installation's server-side credential env (BANIJ_ERP_BASE_URL,
 * BANIJ_CREDENTIAL_KEY_ID, BANIJ_CREDENTIAL_SECRET) into an env file, mode 0600, replacing any
 * previous values of those three keys and leaving every other line untouched.
 *
 * The values come from the legacy DEV registry (decrypted in-process). In a real installation an
 * admin types them in by hand from the ERP's credential screen. Prints nothing secret.
 *
 *   node dev/dev-env.mjs --website <ERP website public id> --erp https://127.0.0.1:8443 [--file .env.local]
 */
import { createDecipheriv } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "redis";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => (index % 2 === 0 ? [...pairs, [value.replace(/^--/, ""), all[index + 1]]] : pairs), []),
);
const file = args.file ?? ".env.local";
if (!/^[0-9A-Z]{26}$/.test(args.website ?? "") || !/^https:\/\//.test(args.erp ?? "")) {
  console.error("usage: dev-env.mjs --website <ULID> --erp https://… [--file <env file>]");
  process.exit(1);
}
// The registry key and Redis URL of the legacy dev registry live in the template's .env.local.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const client = createClient({ url: process.env.STOREFRONT_REDIS_URL });
await client.connect();
const entry = JSON.parse((await client.get(`bsf:registry:website:${args.website}`)) ?? "null");
await client.quit();
if (!entry?.encryptedSecret) {
  console.error("no dev registry entry for that website");
  process.exit(1);
}
const sealed = Buffer.from(entry.encryptedSecret, "base64");
const decipher = createDecipheriv("aes-256-gcm", Buffer.from(process.env.STOREFRONT_REGISTRY_KEY, "base64"), sealed.subarray(0, 12));
decipher.setAAD(Buffer.from(`website:${args.website}`));
decipher.setAuthTag(sealed.subarray(12, 28));
const secret = Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString("utf8");

const values = { BANIJ_ERP_BASE_URL: args.erp, BANIJ_CREDENTIAL_KEY_ID: entry.keyId, BANIJ_CREDENTIAL_SECRET: secret };
const kept = (existsSync(file) ? readFileSync(file, "utf8") : "")
  .split("\n")
  .filter((line) => !Object.keys(values).some((name) => line.startsWith(`${name}=`)));
while (kept.length > 0 && kept.at(-1) === "") kept.pop();
const lines = [...kept, "", "# Installation credential (server-side only; entered by hand in a real installation)"];
for (const [name, value] of Object.entries(values)) lines.push(`${name}=${value}`);
writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
chmodSync(file, 0o600);
console.log(`wrote BANIJ_* for ${args.website} to ${file} (0600); key ${entry.keyId.slice(0, 8)}…`);
