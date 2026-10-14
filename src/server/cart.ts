import "server-only";
import { cookies } from "next/headers";
import { randomToken } from "./crypto";
import { env } from "./env";
import { keys, redis } from "./redis";
import type { Tenant } from "./tenant";

/**
 * The server-side cart. The cookie holds only a random id; the cart itself lives in the
 * storefront's Redis under the website's own key, so the same cookie presented on another
 * website's host finds nothing (D30 §5). Lines carry display snapshots only — every price the
 * customer is asked to pay comes from the ERP's quote.
 */
export type CartLine = {
  sku: string;
  quantity: number;
  productSlug: string;
  name: string;
  variantLabel: string | null;
  image: string | null;
  maxQuantity: number | null;
  minQuantity: number;
};

export type Cart = { lines: CartLine[]; version: number; updatedAt: string };

const CART_COOKIE = "bsf_cart";
const SESSION_COOKIE = "bsf_session";
const CART_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_LINES = 50;
const ID = /^[A-Za-z0-9_-]{22}$/;

function cookieOptions(maxAge: number) {
  // No Domain attribute: host-only, so a cookie never travels to another website's host.
  return { httpOnly: true, sameSite: "lax" as const, secure: env.secureCookies, path: "/", maxAge };
}

async function cartId(create: boolean): Promise<string | null> {
  const jar = await cookies();
  const existing = jar.get(CART_COOKIE)?.value;
  if (existing && ID.test(existing)) {
    return existing;
  }
  if (!create) {
    return null;
  }
  const id = randomToken(16);
  jar.set(CART_COOKIE, id, cookieOptions(CART_TTL_SECONDS));
  return id;
}

export async function currentCartId(): Promise<string | null> {
  return cartId(false);
}

export async function readCart(tenant: Tenant): Promise<Cart> {
  const id = await cartId(false);
  if (!id) {
    return emptyCart();
  }
  const raw = await (await redis()).get(keys.cart(tenant.websiteKey, id));
  return raw ? (JSON.parse(raw) as Cart) : emptyCart();
}

/** Applies a change to the cart under a short per-cart lock, so concurrent tabs cannot lose a line. */
export async function mutateCart(tenant: Tenant, change: (cart: Cart) => Cart): Promise<Cart> {
  const id = (await cartId(true))!;
  const key = keys.cart(tenant.websiteKey, id);
  const lockKey = `${key}:lock`;
  const token = randomToken(12);
  const client = await redis();
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await client.set(lockKey, token, { NX: true, PX: 3000 })) === "OK") {
      try {
        const raw = await client.get(key);
        const current = raw ? (JSON.parse(raw) as Cart) : emptyCart();
        const next = change(structuredClone(current));
        next.lines = next.lines.filter((line) => line.quantity > 0).slice(0, MAX_LINES);
        next.version = current.version + 1;
        next.updatedAt = new Date().toISOString();
        await client.set(key, JSON.stringify(next), { EX: CART_TTL_SECONDS });
        return next;
      } finally {
        await releaseLock(lockKey, token);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Cart is busy; please try again");
}

/** Deletes a lock only if this holder still owns it. */
export async function releaseLock(lockKey: string, token: string): Promise<void> {
  await (await redis()).eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    { keys: [lockKey], arguments: [token] },
  );
}

export async function clearCart(tenant: Tenant): Promise<void> {
  const id = await cartId(false);
  if (id) {
    await (await redis()).del(keys.cart(tenant.websiteKey, id));
  }
}

function emptyCart(): Cart {
  return { lines: [], version: 0, updatedAt: new Date(0).toISOString() };
}

export function clampQuantity(quantity: number, line: Pick<CartLine, "minQuantity" | "maxQuantity">): number {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return 0;
  }
  const max = Math.min(line.maxQuantity ?? 10000, 10000);
  return Math.max(line.minQuantity, Math.min(quantity, max));
}

/** Orders this browser placed on this website — the only orders it may view without an OTP (§6.2). */
export async function rememberOrder(tenant: Tenant, orderId: string): Promise<void> {
  const jar = await cookies();
  let id = jar.get(SESSION_COOKIE)?.value;
  if (!id || !ID.test(id)) {
    id = randomToken(16);
    jar.set(SESSION_COOKIE, id, cookieOptions(CART_TTL_SECONDS));
  }
  const client = await redis();
  const key = keys.session(tenant.websiteKey, id);
  await client.multi().sAdd(key, orderId).expire(key, CART_TTL_SECONDS).exec();
}

export async function canViewOrder(tenant: Tenant, orderId: string): Promise<boolean> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id || !ID.test(id)) {
    return false;
  }
  return (await (await redis()).sIsMember(keys.session(tenant.websiteKey, id), orderId)) === 1;
}

/**
 * The orders this browser placed on this website, newest first (order ids are ULIDs, so they sort
 * by time). Only ids the session itself recorded — never a lookup by phone number or anything else.
 */
export async function rememberedOrders(tenant: Tenant, limit = 20): Promise<string[]> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id || !ID.test(id)) {
    return [];
  }
  const ids = await (await redis()).sMembers(keys.session(tenant.websiteKey, id));
  return ids
    .filter((orderId) => /^[0-9A-Z]{26}$/.test(orderId))
    .sort()
    .reverse()
    .slice(0, limit);
}
