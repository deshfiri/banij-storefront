#!/usr/bin/env node
/**
 * Generates the storefront's provisioning identity and appends it to an env file (default
 * .env.local, mode 0600). Prints only what the ERP needs to be configured with publicly: the key id
 * and the X25519 public key. The HMAC secret must be copied to the ERP's secret store out of band
 * (it is in the env file); it is never printed.
 *
 *   node scripts/provisioning-keys.mjs [--file .env.local] [--host registry.localhost]
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, readFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => (index % 2 === 0 ? [...pairs, [value.replace(/^--/, ""), all[index + 1]]] : pairs), []),
);
const file = args.file ?? ".env.local";
const host = (args.host ?? "registry.localhost").toLowerCase();
const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
if (/^STOREFRONT_PROVISIONING_PRIVATE_KEY=/m.test(existing)) {
  console.error(`${file} already holds a provisioning key; rotate deliberately by removing it first.`);
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync("x25519");
const keyId = `sfp_${randomBytes(9).toString("base64url")}`;
const lines = [
  "",
  "# ERP → storefront provisioning (docs/provisioning-protocol.md)",
  `STOREFRONT_PROVISIONING_HOST=${host}`,
  `STOREFRONT_PROVISIONING_KEY_ID=${keyId}`,
  `STOREFRONT_PROVISIONING_SECRET=${randomBytes(32).toString("base64")}`,
  `STOREFRONT_PROVISIONING_PRIVATE_KEY=${privateKey.export({ format: "der", type: "pkcs8" }).toString("base64")}`,
  "",
];
appendFileSync(file, lines.join("\n"), { mode: 0o600 });
chmodSync(file, 0o600);
console.log(`provisioning key id: ${keyId}`);
console.log(`provisioning public key (X25519, base64url): ${publicKey.export({ format: "jwk" }).x}`);
console.log(`provisioning host: ${host}`);
console.log(`HMAC secret written to ${file} (not printed).`);
