import { existsSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * What a customer gets when the website or the ERP cannot serve: the real proxy, the real registry,
 * the real Redis. Suspension and maintenance are what the ERP's /site answer would make the
 * storefront cache; the ERP itself is not changed.
 */
const enabled = process.env.RUN_ERP_INTEGRATION === "1";
if (enabled && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const WEBSITE = "01M4MHJ7BA282X3QXV1Q256ZMP";
const STATED = "karimtraders.feriwala.shop";
const HOST = "karimtraders.localhost:3000";

describe.runIf(enabled)("unavailable states (live registry)", () => {
  let proxy: typeof import("@/proxy").proxy;
  let store: typeof import("@/server/redis");
  const siteKey = () => siteCacheKey(WEBSITE, process.env.BANIJ_CREDENTIAL_KEY_ID ?? "", STATED);
  let siteCacheKey: typeof import("@/server/tenant").siteCacheKey;
  const realErp = process.env.BANIJ_ERP_BASE_URL;

  beforeAll(async () => {
    proxy = (await import("@/proxy")).proxy;
    store = await import("@/server/redis");
    siteCacheKey = (await import("@/server/tenant")).siteCacheKey;
  });
  afterEach(async () => {
    process.env.BANIJ_ERP_BASE_URL = realErp;
    await (await store.redis()).del(siteKey());
  });
  afterAll(async () => {
    await (await store.redis()).quit();
  });

  const request = (path = "/en") => new NextRequest(`http://${HOST}${path}`, { headers: { host: HOST } });

  it("answers 503 with Retry-After when the ERP cannot be reached, and caches nothing", async () => {
    await (await store.redis()).del(siteKey());
    process.env.BANIJ_ERP_BASE_URL = "https://127.0.0.1:9";
    const response = await proxy(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await (await store.redis()).exists(siteKey())).toBe(0);
  });

  it("answers 503 for a suspended website without naming the reason", async () => {
    await (await store.redis()).set(siteKey(), JSON.stringify({ unavailable: "suspended" }), { EX: 30 });
    const response = await proxy(request("/en/products"));
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("not available right now");
    expect(body).toContain('name="robots" content="noindex"');
  });

  it("shows the website's maintenance message, escaped", async () => {
    await (await store.redis()).del(siteKey());
    const live = await proxy(request());
    expect(live.status).toBe(200);
    const site = JSON.parse((await (await store.redis()).get(siteKey()))!);
    await (await store.redis()).set(
      siteKey(),
      JSON.stringify({ ...site, status: "maintenance", maintenance_message: "Back at <b>5pm</b>" }),
      { EX: 30 },
    );
    const response = await proxy(request());
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("Back at &lt;b&gt;5pm&lt;/b&gt;");
    expect(body).not.toContain("<b>5pm</b>");
  });

  it("serves again as soon as the ERP answers", async () => {
    const response = await proxy(request());
    expect(response.status).toBe(200);
  });
});
