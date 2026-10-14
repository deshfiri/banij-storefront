import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Cart isolation against the real storefront Redis (no ERP). The same cart cookie presented to two
 * websites must reach two different carts: a cookie can never carry a cart across tenants.
 */
const enabled = process.env.RUN_ERP_INTEGRATION === "1";
if (enabled && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));

const tenantA = { websiteKey: "01TESTTENANTAAAAAAAAAAAAAA" } as never;
const tenantB = { websiteKey: "01TESTTENANTBBBBBBBBBBBBBB" } as never;
const line = { sku: "SKU-A", quantity: 2, productSlug: "a", name: "A", variantLabel: null, image: null, maxQuantity: 10, minQuantity: 1 };

describe.runIf(enabled)("cart isolation (live Redis)", () => {
  let cart: typeof import("@/server/cart");
  let store: typeof import("@/server/redis");

  beforeAll(async () => {
    cart = await import("@/server/cart");
    store = await import("@/server/redis");
  });

  afterAll(async () => {
    const id = jar.get("bsf_cart");
    const client = await store.redis();
    if (id) {
      await client.del([store.keys.cart("01TESTTENANTAAAAAAAAAAAAAA", id), store.keys.cart("01TESTTENANTBBBBBBBBBBBBBB", id)]);
    }
    await client.quit();
  });

  it("issues a random 128-bit cart id and keys the cart by website", async () => {
    await cart.mutateCart(tenantA, (current) => ({ ...current, lines: [line] }));
    const id = jar.get("bsf_cart")!;
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const client = await store.redis();
    expect(await client.exists(store.keys.cart("01TESTTENANTAAAAAAAAAAAAAA", id))).toBe(1);
    expect(await client.exists(store.keys.cart("01TESTTENANTBBBBBBBBBBBBBB", id))).toBe(0);
  });

  it("shows another website nothing for the same cookie", async () => {
    expect((await cart.readCart(tenantA)).lines).toHaveLength(1);
    expect((await cart.readCart(tenantB)).lines).toHaveLength(0);
  });

  it("keeps each website's changes to itself", async () => {
    await cart.mutateCart(tenantB, (current) => ({ ...current, lines: [{ ...line, sku: "SKU-B", quantity: 1 }] }));
    expect((await cart.readCart(tenantA)).lines.map((l) => l.sku)).toEqual(["SKU-A"]);
    expect((await cart.readCart(tenantB)).lines.map((l) => l.sku)).toEqual(["SKU-B"]);
  });

  it("ignores a forged cookie value instead of using it as a key", async () => {
    jar.set("bsf_cart", "../../bsf:registry:website:x");
    expect((await cart.readCart(tenantA)).lines).toHaveLength(0);
  });

  it("serialises concurrent changes to one cart without losing an update", async () => {
    jar.set("bsf_cart", "AAAAAAAAAAAAAAAAAAAAAA");
    await Promise.all(
      Array.from({ length: 10 }, () =>
        cart.mutateCart(tenantA, (current) => {
          const existing = current.lines.find((l) => l.sku === "SKU-A");
          if (existing) existing.quantity += 1;
          else current.lines.push({ ...line, quantity: 1 });
          return current;
        }),
      ),
    );
    expect((await cart.readCart(tenantA)).lines[0].quantity).toBe(10);
    await (await store.redis()).del(store.keys.cart("01TESTTENANTAAAAAAAAAAAAAA", "AAAAAAAAAAAAAAAAAAAAAA"));
  });
});
