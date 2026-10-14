import "server-only";
import { createHash } from "node:crypto";
import type { Category, DeliveryArea, Facets, Page, Product } from "@/lib/types";
import { ErpError, erpRequest } from "./erp";
import { keys, redis } from "./redis";
import type { Tenant } from "./tenant";

const CATALOG_TTL_SECONDS = 60;
const AREAS_TTL_SECONDS = 3600;

/**
 * Catalogue reads, cached in the storefront's Redis under the tenant's own key and a per-tenant
 * version that a webhook bumps (D30 §5). Nothing customer-specific passes through here.
 */
async function cached<T>(tenant: Tenant, name: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const client = await redis();
  const version = (await client.get(keys.cacheVersion(tenant.websiteKey))) ?? "0";
  const key = keys.cache(tenant.websiteKey, version, createHash("sha256").update(name).digest("hex").slice(0, 32));
  const hit = await client.get(key);
  if (hit) {
    return JSON.parse(hit) as T;
  }
  const value = await load();
  await client.set(key, JSON.stringify(value), { EX: ttl });
  return value;
}

export type ProductQuery = {
  q?: string;
  sort?: string;
  category?: string;
  brand?: string;
  price_min?: string;
  price_max?: string;
  in_stock?: string;
  featured?: string;
  flash_deal?: string;
  cursor?: string;
  limit?: number;
};

const SORTS = new Set(["featured", "newest", "price_asc", "price_desc", "name", "best_selling"]);
const FLAGS = new Set(["true", "false"]);
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

/** Drops anything the ERP would reject, so a hand-edited URL degrades to "no filter", not an error. */
export function sanitizeProductQuery(input: Record<string, string | string[] | undefined>): ProductQuery {
  const one = (name: string): string | undefined => {
    const value = input[name];
    const text = Array.isArray(value) ? value[0] : value;
    return text === undefined ? undefined : text.trim();
  };
  const query: ProductQuery = {};
  const q = one("q");
  if (q) query.q = q.slice(0, 100);
  const sort = one("sort");
  if (sort && SORTS.has(sort)) query.sort = sort;
  for (const name of ["category", "brand"] as const) {
    const value = one(name);
    if (value && /^[A-Za-z0-9_-]{1,100}$/.test(value)) query[name] = value;
  }
  const min = one("price_min");
  const max = one("price_max");
  if (min && AMOUNT.test(min)) query.price_min = min;
  if (max && AMOUNT.test(max)) query.price_max = max;
  if (query.price_min && query.price_max && compareDecimal(query.price_min, query.price_max) > 0) {
    delete query.price_max;
  }
  for (const name of ["in_stock", "featured", "flash_deal"] as const) {
    const value = one(name);
    if (value && FLAGS.has(value)) query[name] = value;
  }
  const cursor = one("cursor");
  if (cursor && /^[A-Za-z0-9_\-=.]{1,512}$/.test(cursor)) query.cursor = cursor;
  return query;
}

/** Compares two non-negative decimal strings exactly — no float ever touches an amount. */
export function compareDecimal(a: string, b: string): number {
  const [ai, af = ""] = a.split(".");
  const [bi, bf = ""] = b.split(".");
  const left = ai.replace(/^0+/, "").padStart(13, "0") + af.padEnd(2, "0");
  const right = bi.replace(/^0+/, "").padStart(13, "0") + bf.padEnd(2, "0");
  return left === right ? 0 : left > right ? 1 : -1;
}

export function listProducts(tenant: Tenant, query: ProductQuery): Promise<Page<Product>> {
  const params = { limit: 24, ...query };
  return cached(tenant, `products:${JSON.stringify(params)}`, CATALOG_TTL_SECONDS, async () => {
    const { data } = await erpRequest<Page<Product>>(tenant.credential, "GET", "/products", {
      query: params,
      statedHost: tenant.statedHost,
    });
    return data;
  });
}

export function productFacets(tenant: Tenant, query: ProductQuery): Promise<Facets> {
  const filters: ProductQuery = { ...query };
  delete filters.cursor;
  delete filters.limit;
  return cached(tenant, `facets:${JSON.stringify(filters)}`, CATALOG_TTL_SECONDS, async () => {
    const { data } = await erpRequest<{ data: Facets }>(tenant.credential, "GET", "/products/facets", {
      query: filters,
      statedHost: tenant.statedHost,
    });
    return data.data;
  });
}

/** A product by slug or id, or null when it is not published on this website. */
export function findProduct(tenant: Tenant, slug: string): Promise<Product | null> {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(slug)) {
    return Promise.resolve(null);
  }
  return cached(tenant, `product:${slug}`, CATALOG_TTL_SECONDS, async () => {
    try {
      const { data } = await erpRequest<Product>(tenant.credential, "GET", `/products/${encodeURIComponent(slug)}`, {
        statedHost: tenant.statedHost,
      });
      return data;
    } catch (error) {
      if (error instanceof ErpError && error.status === 404) {
        return null;
      }
      throw error;
    }
  });
}

export function listCategories(tenant: Tenant): Promise<Category[]> {
  return cached(tenant, "categories", CATALOG_TTL_SECONDS, async () => {
    const { data } = await erpRequest<Page<Category>>(tenant.credential, "GET", "/categories", {
      query: { limit: 200 },
      statedHost: tenant.statedHost,
    });
    return data.data;
  });
}

export type NavCategory = { slug: string; name: string; href: string };

/**
 * Categories for the header and footer navigation, as locale-relative paths.
 *
 * 1. The website's own categories (ERP `/categories`) → `/categories/{slug}`.
 * 2. Until the website has any, the catalogue categories its published products carry (each
 *    product's `categories[0]`, from the first page of the listing) → `/products?category={slug}`,
 *    which the ERP's listing filter accepts for catalogue categories (contract §5.1.2).
 * 3. Neither → an empty list; the UI shows "All products" only.
 *
 * Never invents a category and never fails the page: errors degrade to an empty list.
 */
export async function navigationCategories(tenant: Tenant): Promise<NavCategory[]> {
  const own = await listCategories(tenant).catch(() => []);
  if (own.length > 0) {
    return own.map((category) => ({ slug: category.slug, name: category.name, href: `/categories/${category.slug}` }));
  }
  const page = await listProducts(tenant, { limit: 50 }).catch(() => null);
  const seen = new Map<string, NavCategory>();
  for (const product of page?.data ?? []) {
    const category = product.categories[0];
    if (category && /^[A-Za-z0-9_-]{1,100}$/.test(category.slug) && !seen.has(category.slug)) {
      seen.set(category.slug, {
        slug: category.slug,
        name: category.name,
        href: `/products?category=${encodeURIComponent(category.slug)}`,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function deliveryAreas(tenant: Tenant, parent: string | null): Promise<DeliveryArea[]> {
  if (parent !== null && !/^[a-z]+:[0-9-]+:[0-9]+$/.test(parent)) {
    return Promise.resolve([]);
  }
  return cached(tenant, `areas:${parent ?? ""}`, AREAS_TTL_SECONDS, async () => {
    const { data } = await erpRequest<{ data: DeliveryArea[] }>(tenant.credential, "GET", "/delivery/areas", {
      query: parent ? { parent } : undefined,
      statedHost: tenant.statedHost,
    });
    return data.data;
  });
}
