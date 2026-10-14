import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { looksSecret, parseSiteConfig, siteConfigSchema } from "@/config/site-schema";
import { assertInstallationEnv, installationCredential, installationErpBaseUrl } from "@/server/site-config";

const template = JSON.parse(readFileSync("site/site.config.json", "utf8"));
const siteB = {
  ...template,
  website: { id: "01M4MH9Z0JXPDX8300NHCKERGP", slug: "legacybazaar" },
  domains: { primary: "legacy.example.com", aliases: ["www.legacy.example.com"], development: [] },
  theme: { preset: "minimal", colors: { primary: "#0f766e" } },
  deployment: { environment: "production" },
};

describe("public site config (schema v2)", () => {
  it("accepts the template's own config and fills defaults", () => {
    const config = parseSiteConfig(template);
    expect(config.schemaVersion).toBe(2);
    expect(config.features).toEqual({
      flashDeals: true,
      bestSellers: true,
      featured: true,
      newArrivals: true,
      cashOnDelivery: true,
      onlinePayment: false,
    });
    expect(config.domains.aliases).toEqual([]);
  });

  it("keeps two websites' configurations entirely separate", () => {
    const a = parseSiteConfig(template);
    const b = parseSiteConfig(siteB);
    expect(a.website.id).not.toBe(b.website.id);
    const hostsA = [a.domains.primary, ...a.domains.aliases, ...a.domains.development];
    const hostsB = [b.domains.primary, ...b.domains.aliases, ...b.domains.development];
    expect(hostsA.filter((h) => hostsB.includes(h))).toEqual([]);
    b.theme.colors.primary = "#000000";
    expect(parseSiteConfig(siteB).theme.colors.primary).toBe("#0f766e");
  });

  it("refuses any credential or ERP endpoint in public config", () => {
    expect(siteConfigSchema.safeParse({ ...template, credential: { keyId: "wsk_01M4SZJK0000000000000000AA" } }).success).toBe(false);
    expect(siteConfigSchema.safeParse({ ...template, erp: { baseUrl: "https://erp.example.com" } }).success).toBe(false);
    expect(siteConfigSchema.safeParse({ ...template, schemaVersion: 1 }).success).toBe(false);
  });

  it("refuses secrets and key ids anywhere in the config", () => {
    const withKeyId = { ...template, website: { ...template.website, slug: "wsk-01m4" }, theme: { colors: {}, preset: "classic" } };
    expect(siteConfigSchema.safeParse(withKeyId).success).toBe(true);
    expect(looksSecret(JSON.stringify({ note: "wsk_01M4SZJK0000000000000000AA" }))).toBe(true);
    expect(looksSecret('{"k":"' + "f".repeat(64) + '"}')).toBe(true);
    expect(looksSecret(JSON.stringify(template))).toBe(false);
  });

  it("refuses development hosts in production, duplicate hosts, unknown keys and malformed hosts", () => {
    // Independent of the installation's own site.config.json (a staging or production branch has no
    // development hosts): state them explicitly.
    const withDevelopmentHosts = { ...template, domains: { ...template.domains, development: ["shop.localhost"] } };
    expect(siteConfigSchema.safeParse({ ...withDevelopmentHosts, deployment: { environment: "production" } }).success).toBe(false);
    expect(siteConfigSchema.safeParse({ ...withDevelopmentHosts, deployment: { environment: "staging" } }).success).toBe(true);
    expect(siteConfigSchema.safeParse({ ...siteB, domains: { primary: "a.example.com", aliases: ["a.example.com"] } }).success).toBe(false);
    expect(siteConfigSchema.safeParse({ ...template, extra: true }).success).toBe(false);
    expect(siteConfigSchema.safeParse({ ...template, website: { id: "12", slug: "x1" } }).success).toBe(false);
    expect(siteConfigSchema.safeParse({ ...siteB, domains: { primary: "https://a.example.com" } }).success).toBe(false);
    expect(siteConfigSchema.safeParse({ ...siteB, domains: { primary: "a.example.com:443" } }).success).toBe(false);
  });

  it("cannot switch on online payment from config", () => {
    expect(siteConfigSchema.safeParse({ ...template, features: { onlinePayment: true } }).success).toBe(false);
  });
});

describe("installation environment (server-side .env)", () => {
  const valid = {
    BANIJ_ERP_BASE_URL: "https://erp.example.com",
    BANIJ_CREDENTIAL_KEY_ID: "wsk_01M4SZJK0000000000000000AA",
    BANIJ_CREDENTIAL_SECRET: "a".repeat(64),
  };
  const stub = (overrides: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries({ ...valid, ...overrides })) vi.stubEnv(name, value);
  };
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds the credential from env only; the configured id is just the local namespace", () => {
    stub({});
    const credential = installationCredential(parseSiteConfig(template));
    expect(credential).toEqual({ websiteKey: template.website.id, keyId: valid.BANIJ_CREDENTIAL_KEY_ID, secret: valid.BANIJ_CREDENTIAL_SECRET });
    expect(installationErpBaseUrl()).toBe("https://erp.example.com");
  });

  it.each([
    ["missing secret", { BANIJ_CREDENTIAL_SECRET: undefined }, "BANIJ_CREDENTIAL_SECRET"],
    ["short secret", { BANIJ_CREDENTIAL_SECRET: "abc123" }, "BANIJ_CREDENTIAL_SECRET"],
    ["upper-case secret", { BANIJ_CREDENTIAL_SECRET: "A".repeat(64) }, "BANIJ_CREDENTIAL_SECRET"],
    ["malformed key id", { BANIJ_CREDENTIAL_KEY_ID: "key-1" }, "BANIJ_CREDENTIAL_KEY_ID"],
    ["plain-HTTP ERP", { BANIJ_ERP_BASE_URL: "http://erp.example.com" }, "BANIJ_ERP_BASE_URL"],
    ["ERP URL with a path", { BANIJ_ERP_BASE_URL: "https://erp.example.com/api" }, "BANIJ_ERP_BASE_URL"],
  ])("refuses a %s, naming the variable but never the value", (_label, overrides, name) => {
    stub(overrides);
    let message = "";
    try {
      assertInstallationEnv();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(name);
    for (const value of [...Object.values(valid), ...Object.values(overrides)]) {
      if (value && value.length > 8) expect(message).not.toContain(value);
    }
  });
});
