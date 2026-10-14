import { createPublicKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hmacHex } from "@/server/crypto";
import { bindingOf, open, privateKeyFromBase64, seal } from "@/server/provisioning-crypto";
import { isProvisioningRequest, provisioningCanonical, provisioningConfig, provisioningSchema, verifySignature } from "@/server/provisioning";

const WEBSITE = "01M4MHJ7BA282X3QXV1Q256ZMP";
const OTHER = "01M4MH9Z0JXPDX8300NHCKERGP";
const KEY = "wsk_01M4SZJK0000000000000000AA";

describe("provisioning seal", () => {
  const { privateKey } = generateKeyPairSync("x25519");
  const publicKey = createPublicKey(privateKey);
  const secret = "a".repeat(64);

  it("opens only with the same website, key id and revision", () => {
    const sealed = seal(secret, publicKey, bindingOf(WEBSITE, KEY, 3));
    expect(JSON.stringify(sealed)).not.toContain(secret);
    expect(open(sealed, privateKey, bindingOf(WEBSITE, KEY, 3))).toBe(secret);
    expect(() => open(sealed, privateKey, bindingOf(OTHER, KEY, 3))).toThrow();
    expect(() => open(sealed, privateKey, bindingOf(WEBSITE, KEY, 2))).toThrow();
    expect(() => open(sealed, privateKey, bindingOf(WEBSITE, "wsk_01M4SZJK0000000000000000BB", 3))).toThrow();
  });

  it("refuses another recipient and a tampered ciphertext", () => {
    const sealed = seal(secret, publicKey, bindingOf(WEBSITE, KEY, 1));
    const stranger = generateKeyPairSync("x25519").privateKey;
    expect(() => open(sealed, stranger, bindingOf(WEBSITE, KEY, 1))).toThrow();
    const ct = Buffer.from(sealed.ct, "base64url");
    ct[0] ^= 1;
    expect(() => open({ ...sealed, ct: ct.toString("base64url") }, privateKey, bindingOf(WEBSITE, KEY, 1))).toThrow();
  });

  it("loads only an X25519 private key", () => {
    const ed = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    expect(() => privateKeyFromBase64(ed)).toThrow();
  });
});

describe("provisioning request authentication", () => {
  const saved = { ...process.env };
  const hmacSecret = Buffer.alloc(32, 9).toString("base64");

  beforeEach(() => {
    // Provisioning exists only in legacy shared development mode (P3).
    process.env.STOREFRONT_MODE = "shared";
    process.env.STOREFRONT_PROVISIONING_HOST = "registry.internal.example";
    process.env.STOREFRONT_PROVISIONING_KEY_ID = "sfp_test";
    process.env.STOREFRONT_PROVISIONING_SECRET = hmacSecret;
    process.env.STOREFRONT_PROVISIONING_PRIVATE_KEY = generateKeyPairSync("x25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const signed = (body: string, overrides: Record<string, string> = {}, now = Date.now()) => {
    const timestamp = Math.floor(now / 1000).toString();
    const nonce = randomUUID();
    const signature = hmacHex(Buffer.from(hmacSecret, "base64"), provisioningCanonical(timestamp, nonce, body));
    const values: Record<string, string> = {
      "x-banij-provisioning-key-id": "sfp_test",
      "x-banij-timestamp": timestamp,
      "x-banij-nonce": nonce,
      "x-banij-signature": `sha256=${signature}`,
      ...overrides,
    };
    return { get: (name: string) => values[name] ?? null };
  };

  it("is disabled unless every part is configured", () => {
    delete process.env.STOREFRONT_PROVISIONING_SECRET;
    expect(provisioningConfig()).toBeNull();
    expect(isProvisioningRequest("registry.internal.example", "/api/internal/registry")).toBe(false);
  });

  it("answers only on the internal host and path", () => {
    expect(isProvisioningRequest("registry.internal.example", "/api/internal/registry")).toBe(true);
    expect(isProvisioningRequest("karimtraders.feriwala.shop", "/api/internal/registry")).toBe(false);
    expect(isProvisioningRequest("registry.internal.example", "/api/internal/other")).toBe(false);
  });

  it("accepts a correctly signed request", () => {
    expect(verifySignature(provisioningConfig()!, signed("{}"), "{}")).toBeNull();
  });

  it.each([
    ["a wrong key id", { "x-banij-provisioning-key-id": "sfp_other" }, "unknown_key"],
    ["a malformed nonce", { "x-banij-nonce": "not-a-uuid" }, "malformed_nonce"],
    ["a forged signature", { "x-banij-signature": `sha256=${"0".repeat(64)}` }, "invalid_signature"],
    ["a bare signature", { "x-banij-signature": "0".repeat(64) }, "invalid_signature"],
  ])("refuses %s", (_label, overrides, reason) => {
    expect(verifySignature(provisioningConfig()!, signed("{}", overrides), "{}")).toBe(reason);
  });

  it("refuses a modified body and a stale timestamp", () => {
    expect(verifySignature(provisioningConfig()!, signed("{}"), '{"op":"remove"}')).toBe("invalid_signature");
    expect(verifySignature(provisioningConfig()!, signed("{}", {}, Date.now() - 301_000), "{}")).toBe("stale_timestamp");
  });

  it("rejects payloads outside the schema", () => {
    expect(provisioningSchema.safeParse({ op: "upsert", website_id: WEBSITE, revision: 1 }).success).toBe(false);
    expect(provisioningSchema.safeParse({ op: "remove", website_id: "1", revision: 1 }).success).toBe(false);
    expect(provisioningSchema.safeParse({ op: "remove", website_id: WEBSITE, revision: 0 }).success).toBe(false);
    expect(provisioningSchema.safeParse({ op: "remove", website_id: WEBSITE, revision: 2 }).success).toBe(true);
  });
});
