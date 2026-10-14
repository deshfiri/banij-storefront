import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Order, Quote } from "@/lib/types";

/**
 * Against the running development ERP. Opt-in (`RUN_ERP_INTEGRATION=1`). The order test additionally
 * needs `ALLOW_ERP_ORDERS=1`, because it places one order in the ERP development database. Run through
 * `dev/integration.sh`, which supplies the dev TLS root.
 */
const enabled = process.env.RUN_ERP_INTEGRATION === "1";
if (enabled && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

describe.runIf(enabled)("Storefront API, live dev ERP", () => {
  let mod: {
    erp: typeof import("@/server/erp");
    tenant: typeof import("@/server/tenant");
    redis: typeof import("@/server/redis");
  };
  let resolved: import("@/server/tenant").Tenant;

  beforeAll(async () => {
    mod = {
      erp: await import("@/server/erp"),
      tenant: await import("@/server/tenant"),
      redis: await import("@/server/redis"),
    };
    const resolution = await mod.tenant.resolveTenant("karimtraders.localhost:3000");
    if (resolution.kind !== "ok") {
      throw new Error(`dev tenant did not resolve: ${resolution.kind}`);
    }
    resolved = resolution.tenant;
  });

  afterAll(async () => {
    await (await mod.redis.redis()).quit();
  });

  it("resolves only registered hosts", async () => {
    expect(resolved.site.name).toBe("Karim Traders Shop");
    expect((await mod.tenant.resolveTenant("rb35vhxhcf.localhost:3000")).kind).toBe("not-found");
    expect((await mod.tenant.resolveTenant("karimtraders.evil.com")).kind).toBe("not-found");
    expect((await mod.tenant.resolveTenant("127.0.0.1:3000")).kind).toBe("not-found");
  });

  it("is refused by the ERP when stating another website's host with this credential", async () => {
    const attempt = mod.erp.erpRequest(resolved.credential, "GET", "/site", { statedHost: "rb35vhxhcf.feriwala.shop" });
    await expect(attempt).rejects.toMatchObject({ status: 403, body: { code: "host_mismatch" } });
  });

  it("is refused by the ERP with a wrong secret", async () => {
    const forged = { ...resolved.credential, secret: "f".repeat(64) };
    await expect(mod.erp.erpRequest(forged, "GET", "/site", { statedHost: resolved.statedHost })).rejects.toMatchObject({
      status: 401,
    });
  });

  // Writes ERP data (one order). Runs only with explicit ALLOW_ERP_ORDERS=1 — A6 is not approved.
  it.runIf(process.env.ALLOW_ERP_ORDERS === "1")("creates one order per key and reference, and refuses a claimed price", async () => {
    const { erpRequest } = mod.erp;
    const items = [{ sku: "BSFLUN001", quantity: 1 }];
    const { data: quoted } = await erpRequest<{ data: Quote }>(resolved.credential, "POST", "/checkout/quote", {
      body: { items, payment_method: "cod", delivery: { area_id: null }, coupon_code: null },
      statedHost: resolved.statedHost,
    });
    const quote = quoted.data;
    const money = (m: { amount: string; currency: string }) => ({ amount: m.amount, currency: m.currency });
    const reference = `SF-IT-${randomUUID().slice(0, 8).toUpperCase()}`;
    const body = {
      storefront_order_reference: reference,
      customer: { name: "Integration Test", phone: "+8801712345679", email: null, is_guest: true },
      shipping_address: { line1: "Test House 1", city: "Dhaka", country: "BD" },
      items: [{ ...items[0], unit_price: money(quote.items[0].unit_price) }],
      totals: {
        subtotal: money(quote.subtotal),
        discount: money(quote.discount),
        shipping: money(quote.shipping),
        tax: money(quote.tax),
        grand_total: money(quote.grand_total),
      },
      payment: { method: "cod" },
    };
    const key = randomUUID();
    const first = await erpRequest<Order>(resolved.credential, "POST", "/orders", {
      body,
      idempotencyKey: key,
      statedHost: resolved.statedHost,
    });
    expect(first.status).toBe(201);
    expect(first.data.status).toBe("customer_verification_pending");
    expect(first.data.totals.grand_total.amount).toBe(quote.grand_total.amount);

    // Same key, same body: the stored answer, never a second order.
    const replay = await erpRequest<Order>(resolved.credential, "POST", "/orders", {
      body,
      idempotencyKey: key,
      statedHost: resolved.statedHost,
    });
    expect(replay.data.id).toBe(first.data.id);

    // Same reference under a fresh key: refused as a duplicate, pointing at the same order.
    await expect(
      erpRequest(resolved.credential, "POST", "/orders", { body, idempotencyKey: randomUUID(), statedHost: resolved.statedHost }),
    ).rejects.toMatchObject({ status: 409, body: { code: "duplicate_storefront_order" } });

    // A storefront claiming its own price is refused with the authoritative figures.
    const tampered = {
      ...body,
      storefront_order_reference: `${reference}-T`,
      items: [{ ...body.items[0], unit_price: { amount: "1.00", currency: "BDT" } }],
    };
    await expect(
      erpRequest(resolved.credential, "POST", "/orders", { body: tampered, idempotencyKey: randomUUID(), statedHost: resolved.statedHost }),
    ).rejects.toMatchObject({ status: 422, body: { code: "price_mismatch" } });
  });
});
