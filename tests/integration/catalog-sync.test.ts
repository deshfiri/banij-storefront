import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Page, Product } from "@/lib/types";

/**
 * How a product the owner connects in the ERP reaches the storefront — with a mocked ERP (no ERP
 * data is read or written) and the real cache code against the storefront's own Redis, under a
 * throwaway website key that is deleted afterwards.
 *
 * Verified behaviour: every catalogue read is a live, signed ERP API read, cached in Redis for at
 * most CATALOG_TTL_SECONDS (60 s) per query. A newly connected product therefore appears within
 * 60 seconds, with no rebuild or redeploy. Bumping the per-website cache version refreshes at once —
 * the hook a webhook receiver would use; no receiver is implemented yet.
 */
const enabled = process.env.RUN_ERP_INTEGRATION === "1";
if (enabled && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const erpCatalogue: Product[] = [];
const erpCalls: string[] = [];
vi.mock("@/server/erp", () => ({
  ErpError: class ErpError extends Error {
    constructor(public status: number) {
      super(`ERP ${status}`);
    }
  },
  erpRequest: async (_credential: unknown, _method: string, path: string) => {
    erpCalls.push(path);
    if (path === "/products") {
      const page: Page<Product> = { data: [...erpCatalogue], meta: { next_cursor: null, has_more: false } };
      return { data: page, status: 200 };
    }
    const slug = decodeURIComponent(path.replace("/products/", ""));
    const found = erpCatalogue.find((product) => product.slug === slug);
    if (!found) {
      const { ErpError } = await import("@/server/erp");
      throw new (ErpError as unknown as new (status: number) => Error)(404);
    }
    return { data: found, status: 200 };
  },
}));

const WEBSITE = `01SYNCTEST${Date.now().toString(36).toUpperCase().padStart(16, "0")}`.slice(0, 26);
const tenant = { websiteKey: WEBSITE, credential: {}, statedHost: "sync-test.invalid" } as never;

function catalogSyncProduct(slug: string): Product {
  return { id: `id-${slug}`, slug, sku: slug.toUpperCase(), name: slug, media: [], variants: [], categories: [] } as unknown as Product;
}

describe.runIf(enabled)("catalogue synchronisation (mocked ERP, live Redis)", () => {
  let catalog: typeof import("@/server/catalog");
  let store: typeof import("@/server/redis");

  async function expireCatalogueCache() {
    const client = await store.redis();
    for await (const batch of client.scanIterator({ MATCH: `bsf:t:${WEBSITE}:c:*`, COUNT: 100 })) {
      for (const key of [batch].flat()) {
        await client.pExpire(key, 1);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  beforeAll(async () => {
    catalog = await import("@/server/catalog");
    store = await import("@/server/redis");
    erpCatalogue.push(catalogSyncProduct("connected-before"));
  });

  afterAll(async () => {
    const client = await store.redis();
    const doomed: string[] = [store.keys.cacheVersion(WEBSITE)];
    for await (const batch of client.scanIterator({ MATCH: `bsf:t:${WEBSITE}:*`, COUNT: 100 })) {
      doomed.push(...[batch].flat());
    }
    await client.del(doomed);
    await client.quit();
  });

  it("serves a cached listing for at most 60 seconds", async () => {
    expect((await catalog.listProducts(tenant, { limit: 12 })).data.map((p) => p.slug)).toEqual(["connected-before"]);
    const client = await store.redis();
    const cacheKeys: string[] = [];
    for await (const batch of client.scanIterator({ MATCH: `bsf:t:${WEBSITE}:c:*`, COUNT: 100 })) {
      cacheKeys.push(...[batch].flat());
    }
    expect(cacheKeys).toHaveLength(1);
    const ttl = await client.ttl(cacheKeys[0]);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it("shows a newly connected product once the cached listing expires — no rebuild, no redeploy", async () => {
    erpCatalogue.push(catalogSyncProduct("connected-now"));
    // Within the TTL the cached listing is still served…
    expect((await catalog.listProducts(tenant, { limit: 12 })).data.map((p) => p.slug)).toEqual(["connected-before"]);
    // …and the next read after it expires is a live ERP read that includes the new product.
    await expireCatalogueCache();
    const callsBefore = erpCalls.length;
    expect((await catalog.listProducts(tenant, { limit: 12 })).data.map((p) => p.slug)).toEqual(["connected-before", "connected-now"]);
    expect(erpCalls.length).toBe(callsBefore + 1);
  });

  it("a product page never requested before is a live read; one seen as missing stays missing until its entry expires", async () => {
    erpCatalogue.push(catalogSyncProduct("later"));
    expect((await catalog.findProduct(tenant, "later"))?.slug).toBe("later");
    expect(await catalog.findProduct(tenant, "not-yet")).toBeNull();
    erpCatalogue.push(catalogSyncProduct("not-yet"));
    expect(await catalog.findProduct(tenant, "not-yet")).toBeNull();
    await expireCatalogueCache();
    expect((await catalog.findProduct(tenant, "not-yet"))?.slug).toBe("not-yet");
  });

  it("bumping the website's cache version refreshes every catalogue read at once (the webhook hook)", async () => {
    const cachedCount = (await catalog.listProducts(tenant, { limit: 12 })).data.length;
    erpCatalogue.push(catalogSyncProduct("via-version-bump"));
    expect((await catalog.listProducts(tenant, { limit: 12 })).data).toHaveLength(cachedCount);
    const client = await store.redis();
    await client.incr(store.keys.cacheVersion(WEBSITE));
    expect((await catalog.listProducts(tenant, { limit: 12 })).data.map((p) => p.slug)).toContain("via-version-bump");
  });

  it("a disconnected product disappears the same way", async () => {
    erpCatalogue.splice(0, erpCatalogue.length, catalogSyncProduct("connected-before"));
    await expireCatalogueCache();
    expect((await catalog.listProducts(tenant, { limit: 12 })).data.map((p) => p.slug)).toEqual(["connected-before"]);
  });
});
