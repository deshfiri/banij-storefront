import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Read-only preview (STOREFRONT_PREVIEW=true): every order operation is refused at the ERP-client
 * choke point and at the server actions, before any request is signed or sent.
 */
vi.mock("@/server/current", () => ({
  currentTenant: vi.fn(async () => {
    throw new Error("currentTenant must not be reached in preview for a disabled action");
  }),
}));

const ORDER_ID = "01M4T0960T4XYMZ2T4PM0DBYR4";
const credential = { websiteKey: "01M4MHJ7BA282X3QXV1Q256ZMP", keyId: "wsk_01M4SZJK0000000000000000AA", secret: "a".repeat(64) };
const template = JSON.parse(readFileSync("site/site.config.json", "utf8"));

function previewEnv(extra: Record<string, string | undefined> = {}) {
  vi.stubEnv("STOREFRONT_MODE", "");
  vi.stubEnv("STOREFRONT_PREVIEW", "true");
  vi.stubEnv("BANIJ_ERP_BASE_URL", "https://erp.example.com");
  vi.stubEnv("BANIJ_CREDENTIAL_KEY_ID", credential.keyId);
  vi.stubEnv("BANIJ_CREDENTIAL_SECRET", credential.secret);
  for (const [name, value] of Object.entries(extra)) vi.stubEnv(name, value);
}

const MUTATING_OR_ORDER_READS: ["GET" | "POST", string][] = [
  ["POST", "/orders"],
  ["GET", "/orders"],
  ["GET", `/orders/${ORDER_ID}`],
  ["POST", `/orders/${ORDER_ID}/confirmation`],
  ["POST", `/orders/${ORDER_ID}/confirmation/code`],
  ["POST", `/orders/${ORDER_ID}/cancellation`],
  ["POST", `/orders/${ORDER_ID}/payment-session`],
  ["POST", `/orders/${ORDER_ID}/return-requests`],
  ["POST", `/orders/${ORDER_ID}/refund-requests`],
  ["POST", "/customers"],
  ["GET", "/inventory"],
  ["GET", "/inventory/BSFTEA001"],
  ["GET", "/connection"],
  ["POST", "/checkout/quote"],
  ["POST", "/site"],
  ["GET", "/products/a/b"],
];

const CATALOGUE_READS: ["GET", string][] = [
  ["GET", "/site"],
  ["GET", "/products"],
  ["GET", "/products/facets"],
  ["GET", "/products/sylhet-premium-black-tea-400g"],
  ["GET", "/categories"],
  ["GET", "/categories/grocery"],
  ["GET", "/delivery/areas"],
];

describe("preview ERP-client allow-list", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(MUTATING_OR_ORDER_READS)("refuses %s %s without any network request", async (method, path) => {
    previewEnv();
    const { erpRequest, PreviewRefused } = await import("@/server/erp");
    await expect(erpRequest(credential, method, path, { statedHost: "karimtraders.feriwala.shop", body: {}, idempotencyKey: "k" })).rejects.toBeInstanceOf(PreviewRefused);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(CATALOGUE_READS)("allows the catalogue read %s %s", async (method, path) => {
    previewEnv();
    const { erpRequest } = await import("@/server/erp");
    await erpRequest(credential, method, path, { statedHost: "karimtraders.feriwala.shop" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("allows the advisory quote only when explicitly enabled — and still never an order", async () => {
    previewEnv({ STOREFRONT_PREVIEW_QUOTE: "true" });
    const { erpRequest, PreviewRefused } = await import("@/server/erp");
    await erpRequest(credential, "POST", "/checkout/quote", { statedHost: "karimtraders.feriwala.shop", body: {} });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await expect(erpRequest(credential, "POST", "/orders", { statedHost: "x.example", body: {}, idempotencyKey: "k" })).rejects.toBeInstanceOf(PreviewRefused);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("names no order id in the refusal", async () => {
    previewEnv();
    const { erpRequest } = await import("@/server/erp");
    await expect(erpRequest(credential, "GET", `/orders/${ORDER_ID}`, { statedHost: "x.example" })).rejects.toThrow(/\/orders\/\{id\}/);
    await expect(erpRequest(credential, "GET", `/orders/${ORDER_ID}`, { statedHost: "x.example" })).rejects.not.toThrow(ORDER_ID);
  });

  it("is inert outside preview: order calls go to the ERP as before", async () => {
    previewEnv({ STOREFRONT_PREVIEW: undefined });
    const { erpRequest } = await import("@/server/erp");
    await erpRequest(credential, "GET", `/orders/${ORDER_ID}`, { statedHost: "karimtraders.feriwala.shop" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("preview server actions", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("no network in preview action tests");
    }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses placing an order, COD confirmation and code resend before resolving the shop", async () => {
    previewEnv();
    const actions = await import("@/app/actions");
    const refusal = { kind: "refused", code: "preview_disabled", details: {} };
    await expect(actions.placeOrderAction("en", {}, "quote-id")).resolves.toEqual(refusal);
    await expect(actions.confirmCodAction(ORDER_ID, "123456")).resolves.toEqual(refusal);
    await expect(actions.resendCodeAction(ORDER_ID)).resolves.toEqual(refusal);
    await expect(actions.quoteAction({})).resolves.toEqual(refusal);
    const { currentTenant } = await import("@/server/current");
    expect(currentTenant).not.toHaveBeenCalled();
  });
});

describe("preview boot rules", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@site/site.config.json");
  });

  it("is allowed on a single installation configured as development or staging", async () => {
    previewEnv();
    vi.resetModules();
    const { assertPreviewMode } = await import("@/server/site-config");
    expect(() => assertPreviewMode()).not.toThrow();
  });

  it("is refused for a site configured as production", async () => {
    previewEnv();
    vi.resetModules();
    vi.doMock("@site/site.config.json", () => ({
      default: { ...template, domains: { ...template.domains, development: [] }, deployment: { environment: "production" } },
    }));
    const { assertPreviewMode } = await import("@/server/site-config");
    expect(() => assertPreviewMode()).toThrow(/production/);
  });

  it("is refused in legacy shared mode", async () => {
    previewEnv({ STOREFRONT_MODE: "shared", NODE_ENV: "development" });
    vi.resetModules();
    const { assertPreviewMode } = await import("@/server/site-config");
    expect(() => assertPreviewMode()).toThrow(/single installation/);
  });

  it("enables the quote only with both flags", async () => {
    vi.resetModules();
    const { previewQuoteEnabled } = await import("@/server/site-config");
    vi.stubEnv("STOREFRONT_PREVIEW_QUOTE", "true");
    expect(previewQuoteEnabled()).toBe(false);
    vi.stubEnv("STOREFRONT_PREVIEW", "true");
    expect(previewQuoteEnabled()).toBe(true);
  });
});
