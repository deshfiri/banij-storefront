#!/usr/bin/env node
/**
 * Interim operator provisioning for the storefront credential registry (D30 §2).
 *
 *   put:    echo '{"keyId":"wsk_…","secret":"…"}' | node scripts/registry.mjs put \
 *             --website <website public id> --hosts a.example,b.example --primary a.example
 *   show:   node scripts/registry.mjs show --website <id>      (never prints the secret)
 *   remove: node scripts/registry.mjs remove --website <id>
 *
 * The secret arrives on stdin only — never argv, which other users can read from the process list —
 * and is written AES-256-GCM encrypted, bound to the website key. Replaced by the ERP's
 * authenticated provisioning channel when that is built.
 */
import { createCipheriv, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createClient } from "redis";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

const [command, ...rest] = process.argv.slice(2);
// Production websites are provisioned by the ERP channel (src/app/api/internal/registry). Direct
// writes there are a recorded break-glass action only.
if (process.env.NODE_ENV === "production" && ["put", "remove"].includes(command) && !rest.includes("--break-glass")) {
  console.error("registry: direct writes are disabled in production; use the ERP provisioning channel or --break-glass");
  process.exit(1);
}
if (rest.includes("--break-glass")) {
  rest.splice(rest.indexOf("--break-glass"), 1);
  console.warn(JSON.stringify({ at: new Date().toISOString(), channel: "provisioning", event: "break_glass", command, user: process.env.USER }));
}
const args = {};
for (let i = 0; i < rest.length; i += 2) {
  args[rest[i].replace(/^--/, "")] = rest[i + 1];
}

const HOST = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
const website = args.website;
if (!website || !/^[0-9A-Z]{26}$/.test(website)) {
  fail("--website must be the website's public id (a ULID)");
}

const client = createClient({ url: process.env.STOREFRONT_REDIS_URL });
await client.connect();
const websiteKey = `bsf:registry:website:${website}`;

try {
  if (command === "put") {
    const hosts = (args.hosts ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
    const primary = (args.primary ?? hosts[0] ?? "").toLowerCase();
    if (hosts.length === 0 || !hosts.every((h) => HOST.test(h)) || !hosts.includes(primary)) {
      fail("--hosts must be valid host names and include --primary");
    }
    const input = JSON.parse(await readStdin());
    if (!/^wsk_[0-9A-Z]{26}$/.test(input.keyId ?? "") || !/^[0-9a-f]{64}$/.test(input.secret ?? "")) {
      fail("stdin must be {\"keyId\":\"wsk_…\",\"secret\":\"<64 hex>\"}");
    }
    for (const host of hosts) {
      const owner = await client.get(`bsf:registry:host:${host}`);
      if (owner && owner !== website) {
        fail(`host ${host} is already mapped to another website`);
      }
    }
    const previous = await client.get(websiteKey);
    const entry = {
      websiteKey: website,
      keyId: input.keyId,
      encryptedSecret: encrypt(input.secret, `website:${website}`),
      hosts,
      primaryHost: primary,
      updatedAt: new Date().toISOString(),
    };
    const multi = client.multi();
    if (previous) {
      for (const old of JSON.parse(previous).hosts ?? []) {
        if (!hosts.includes(old)) multi.del(`bsf:registry:host:${old}`);
      }
    }
    multi.set(websiteKey, JSON.stringify(entry));
    for (const host of hosts) multi.set(`bsf:registry:host:${host}`, website);
    multi.incr(`bsf:t:${website}:cachev`);
    multi.del(`bsf:t:${website}:site`);
    await multi.exec();
    console.log(`registry: ${website} → ${hosts.join(", ")} (key ${input.keyId.slice(0, 8)}…)`);
  } else if (command === "show") {
    const raw = await client.get(websiteKey);
    if (!raw) fail("no entry");
    const { encryptedSecret: _omit, ...visible } = JSON.parse(raw);
    console.log(JSON.stringify({ ...visible, keyId: `${visible.keyId.slice(0, 8)}…` }, null, 2));
  } else if (command === "remove") {
    const raw = await client.get(websiteKey);
    const multi = client.multi();
    for (const host of raw ? JSON.parse(raw).hosts : []) multi.del(`bsf:registry:host:${host}`);
    multi.del(websiteKey);
    multi.del(`bsf:t:${website}:site`);
    await multi.exec();
    console.log(`registry: removed ${website}`);
  } else {
    fail("usage: registry.mjs put|show|remove --website <id> …");
  }
} finally {
  await client.quit();
}

function encrypt(plaintext, aad) {
  const key = Buffer.from(process.env.STOREFRONT_REGISTRY_KEY ?? "", "base64");
  if (key.length !== 32) fail("STOREFRONT_REGISTRY_KEY must be 32 bytes, base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function fail(message) {
  console.error(`registry: ${message}`);
  process.exit(1);
}
