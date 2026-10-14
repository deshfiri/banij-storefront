import { existsSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Strict installation identity (Phase 1, step 3) against the live development ERP and Redis.
 * Read-only towards the ERP: only GET /site is called. Places no orders, changes no ERP data.
 *
 * The configured website id is an assertion; the ERP derives identity from the credential. These
 * tests prove the installation serves nothing unless credential, configured website, configured
 * primary host and ERP-registered hosts all agree — and that identity is never served stale.
 */
const enabled = process.env.RUN_ERP_INTEGRATION === "1";
if (enabled && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const WEBSITE = "01M4MHJ7BA282X3QXV1Q256ZMP";
const PRIMARY = "karimtraders.feriwala.shop";
const DEV_HOST = "karimtraders.localhost:3000";
const OTHER_WEBSITE_HOST = "rb35vhxhcf.feriwala.shop"; // dev website 1 — a real host of ANOTHER website
const template = JSON.parse(readFileSync("site/site.config.json", "utf8"));

type Modules = {
  proxy: typeof import("@/proxy").proxy;
  tenant: typeof import("@/server/tenant");
  redis: typeof import("@/server/redis");
};

/** Loads the proxy against a given public site config, in a fresh module scope. */
async function withConfig(config: unknown): Promise<Modules> {
  vi.resetModules();
  vi.doMock("@site/site.config.json", () => ({ default: config }));
  return {
    proxy: (await import("@/proxy")).proxy,
    tenant: await import("@/server/tenant"),
    redis: await import("@/server/redis"),
  };
}

const request = (host: string, path = "/en") => new NextRequest(`http://${host}${path}`, { headers: { host } });

describe.runIf(enabled)("installation identity (live dev ERP, read-only)", () => {
  const realKeyId = process.env.BANIJ_CREDENTIAL_KEY_ID!;
  const realSecret = process.env.BANIJ_CREDENTIAL_SECRET!;
  let m: Modules;
  const cacheKey = (keyId = realKeyId, host = PRIMARY) => m.tenant.siteCacheKey(WEBSITE, keyId, host);

  beforeEach(async () => {
    vi.stubEnv("STOREFRONT_MODE", "");
    m = await withConfig(template);
    await (await m.redis.redis()).del(cacheKey());
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    process.env.BANIJ_CREDENTIAL_KEY_ID = realKeyId;
    process.env.BANIJ_CREDENTIAL_SECRET = realSecret;
    await (await m.redis.redis()).del(cacheKey());
  });
  afterAll(async () => {
    await (await m.redis.redis()).quit();
  });

  it("serves when credential, configured website, configured primary and ERP hosts agree", async () => {
    const response = await m.proxy(request(DEV_HOST));
    expect(response.status).toBe(200);
  });

  it("refuses an undeclared host with 404", async () => {
    expect((await m.proxy(request("karimtraders.evil.com"))).status).toBe(404);
    expect((await m.proxy(request("rb35vhxhcf.localhost:3000"))).status).toBe(404);
  });

  it("503s when the ERP's website is not the configured website, revealing nothing", async () => {
    await m.proxy(request(DEV_HOST)); // warm the cache with the real /site
    const site = JSON.parse((await (await m.redis.redis()).get(cacheKey()))!);
    await (await m.redis.redis()).set(cacheKey(), JSON.stringify({ ...site, id: "01M4MH9Z0JXPDX8300NHCKERGP" }), { EX: 30 });
    const response = await m.proxy(request(DEV_HOST));
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain(site.name);
    expect(body).not.toMatch(/identity|mismatch|credential/i);
  });

  it("503s when the configured primary is not a host the ERP registered for the website", async () => {
    await m.proxy(request(DEV_HOST));
    const site = JSON.parse((await (await m.redis.redis()).get(cacheKey()))!);
    await (await m.redis.redis()).set(
      cacheKey(),
      JSON.stringify({ ...site, hosts: { primary: "elsewhere.example.com", subdomain: "elsewhere.feriwala.shop", aliases: [] } }),
      { EX: 30 },
    );
    expect((await m.proxy(request(DEV_HOST))).status).toBe(503);
  });

  it("503s on a refused credential and caches nothing", async () => {
    process.env.BANIJ_CREDENTIAL_SECRET = "f".repeat(64);
    const response = await m.proxy(request(DEV_HOST));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("300");
    expect(await (await m.redis.redis()).exists(cacheKey())).toBe(0);
  });

  it("never reuses identity cached under a previous credential", async () => {
    expect((await m.proxy(request(DEV_HOST))).status).toBe(200);
    expect(await (await m.redis.redis()).exists(cacheKey())).toBe(1); // cached under the real key id
    // The operator swaps .env to a different credential (well-formed, unknown to the ERP).
    const otherKeyId = "wsk_01M4ZZZZZZZZZZZZZZZZZZZZZZ";
    process.env.BANIJ_CREDENTIAL_KEY_ID = otherKeyId;
    const response = await m.proxy(request(DEV_HOST));
    expect(response.status).toBe(503); // re-read with the new credential, refused — not the cached 200
    expect(await (await m.redis.redis()).exists(cacheKey(otherKeyId))).toBe(0);
  });

  it("503s when the configured primary belongs to another website (ERP host_mismatch), uncached", async () => {
    m = await withConfig({
      ...template,
      domains: { primary: OTHER_WEBSITE_HOST, aliases: [], development: ["identity-probe.localhost"] },
    });
    const response = await m.proxy(request("identity-probe.localhost"));
    expect(response.status).toBe(503);
    expect(await (await m.redis.redis()).exists(cacheKey(realKeyId, OTHER_WEBSITE_HOST))).toBe(0);
  });

  it("serves a configured alias only while the ERP lists it (unlisted alias → 404, primary unaffected)", async () => {
    m = await withConfig({
      ...template,
      domains: { ...template.domains, aliases: ["www.unregistered-alias.example"] },
    });
    expect((await m.proxy(request("www.unregistered-alias.example"))).status).toBe(404);
    expect((await m.proxy(request(DEV_HOST))).status).toBe(200);
  });

  it("503s an installation whose .env is incomplete", async () => {
    delete process.env.BANIJ_CREDENTIAL_SECRET;
    const response = await m.proxy(request(DEV_HOST));
    expect(response.status).toBe(503);
  });
});
