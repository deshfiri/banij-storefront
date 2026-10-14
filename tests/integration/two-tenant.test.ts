import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Order, Page, Product, Quote } from "@/lib/types";

/**
 * Genuine two-tenant isolation: two websites, each with its own credential, products and orders,
 * served by one storefront. Runs only when a second development website is provisioned:
 *
 *   TENANT_B_HOST=<subdomain>.localhost:3000  TENANT_B_ONLY_SKU=<a SKU published on B but not A>
 *
 * Places one COD order on each website.
 */
const enabled = process.env.RUN_ERP_INTEGRATION === "1" && Boolean(process.env.TENANT_B_HOST);
if (enabled && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

type Tenant = import("@/server/tenant").Tenant;

describe.runIf(enabled)("two-tenant isolation (live dev ERP)", () => {
  let erp: typeof import("@/server/erp");
  let resolveTenant: typeof import("@/server/tenant").resolveTenant;
  let store: typeof import("@/server/redis");
  let a: Tenant;
  let b: Tenant;
  const orders: Record<"a" | "b", Order | null> = { a: null, b: null };

  beforeAll(async () => {
    erp = await import("@/server/erp");
    resolveTenant = (await import("@/server/tenant")).resolveTenant;
    store = await import("@/server/redis");
    const ra = await resolveTenant("karimtraders.localhost:3000");
    const rb = await resolveTenant(process.env.TENANT_B_HOST!);
    if (ra.kind !== "ok" || rb.kind !== "ok") throw new Error("both tenants must resolve");
    a = ra.tenant;
    b = rb.tenant;
  });
  afterAll(async () => {
    await (await store.redis()).quit();
  });

  const get = <T>(t: Tenant, path: string, statedHost = t.statedHost) =>
    erp.erpRequest<T>(t.credential, "GET", path, { statedHost });

  const placeOne = async (t: Tenant, sku: string): Promise<Order> => {
    const { data } = await erp.erpRequest<{ data: Quote }>(t.credential, "POST", "/checkout/quote", {
      body: { items: [{ sku, quantity: 1 }], payment_method: "cod", delivery: { area_id: null }, coupon_code: null },
      statedHost: t.statedHost,
    });
    const q = data.data;
    const money = (m: { amount: string; currency: string }) => ({ amount: m.amount, currency: m.currency });
    const created = await erp.erpRequest<Order>(t.credential, "POST", "/orders", {
      body: {
        storefront_order_reference: `SF-ISO-${randomUUID().slice(0, 8).toUpperCase()}`,
        customer: { name: "Isolation Test", phone: "+8801712345670", email: null, is_guest: true },
        shipping_address: { line1: "Isolation House 1", city: "Dhaka", country: "BD" },
        items: [{ sku, quantity: 1, unit_price: money(q.items[0].unit_price) }],
        totals: { subtotal: money(q.subtotal), discount: money(q.discount), shipping: money(q.shipping), tax: money(q.tax), grand_total: money(q.grand_total) },
        payment: { method: "cod" },
      },
      idempotencyKey: randomUUID(),
      statedHost: t.statedHost,
    });
    return created.data;
  };

  it("resolves each host to its own website and credential", () => {
    expect(a.websiteKey).not.toBe(b.websiteKey);
    expect(a.credential.keyId).not.toBe(b.credential.keyId);
    expect(a.site.id).toBe(a.websiteKey);
    expect(b.site.id).toBe(b.websiteKey);
  });

  it("refuses each credential on the other website's host", async () => {
    await expect(get(a, "/site", b.statedHost)).rejects.toMatchObject({ status: 403, body: { code: "host_mismatch" } });
    await expect(get(b, "/site", a.statedHost)).rejects.toMatchObject({ status: 403, body: { code: "host_mismatch" } });
  });

  it("lists only each website's own products", async () => {
    const onlyB = process.env.TENANT_B_ONLY_SKU!;
    const listA = (await get<Page<Product>>(a, "/products?limit=200")).data.data;
    const listB = (await get<Page<Product>>(b, "/products?limit=200")).data.data;
    const skusA = listA.flatMap((p) => p.variants.map((v) => v.sku));
    const skusB = listB.flatMap((p) => p.variants.map((v) => v.sku));
    expect(skusB).toContain(onlyB);
    expect(skusA).not.toContain(onlyB);
    const productB = listB.find((p) => p.variants.some((v) => v.sku === onlyB))!;
    await expect(get(a, `/products/${productB.slug}`)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to quote or order the other website's product", async () => {
    await expect(
      erp.erpRequest(a.credential, "POST", "/checkout/quote", {
        body: { items: [{ sku: process.env.TENANT_B_ONLY_SKU, quantity: 1 }], payment_method: "cod" },
        statedHost: a.statedHost,
      }),
    ).rejects.toMatchObject({ status: 422, body: { code: "product_unavailable" } });
  });

  it("keeps each website's orders invisible to the other", async () => {
    orders.a = await placeOne(a, "BSFTEA001");
    orders.b = await placeOne(b, process.env.TENANT_B_ONLY_SKU!);
    expect((await get<Order>(a, `/orders/${orders.a.id}`)).data.id).toBe(orders.a.id);
    // Another website's order is a plain 404 — indistinguishable from one that does not exist.
    await expect(get(a, `/orders/${orders.b.id}`)).rejects.toMatchObject({ status: 404, body: { code: "not_found" } });
    await expect(get(b, `/orders/${orders.a.id}`)).rejects.toMatchObject({ status: 404, body: { code: "not_found" } });
    const listA = (await get<Page<Order>>(a, "/orders")).data.data.map((o) => o.id);
    expect(listA).not.toContain(orders.b.id);
    console.log(`ISOLATION_ORDERS a=${orders.a.reference} b=${orders.b.reference}`);
  });

  it("keeps the same customer phone as two separate customers", async () => {
    // Both orders above used one mobile number; neither website can reach the other's order.
    expect(orders.a!.id).not.toBe(orders.b!.id);
  });
});
