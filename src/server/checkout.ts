import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Money, Order, Quote } from "@/lib/types";
import { type Cart, clearCart, readCart, rememberOrder, releaseLock } from "./cart";
import { randomToken, sha256Hex } from "./crypto";
import { ErpError, ErpUnavailable, erpRequest } from "./erp";
import { keys, redis } from "./redis";
import { siteFeatures } from "./site-config";
import type { Tenant } from "./tenant";

/** Bangladeshi mobile: 01XXXXXXXXX, 8801XXXXXXXXX or +8801XXXXXXXXX, spaces and hyphens allowed. */
export function toE164(raw: string): string | null {
  const compact = raw.replace(/[\s\-()]/g, "");
  const match = /^(?:\+?880|0)(1[3-9]\d{8})$/.exec(compact);
  return match ? `+880${match[1]}` : null;
}

const AREA = /^[a-z]+:[0-9-]+:[0-9]+$/;

export const checkoutSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z
    .string()
    .trim()
    .max(32)
    .refine((value) => toE164(value) !== null, { message: "invalid_mobile" }),
  email: z.union([z.literal(""), z.string().trim().email().max(254)]).optional(),
  line1: z.string().trim().min(3).max(255),
  line2: z.string().trim().max(255).optional(),
  city: z.string().trim().min(2).max(120),
  district: z.string().trim().max(120).optional(),
  postcode: z.string().trim().max(20).optional(),
  areaId: z.union([z.literal(""), z.string().regex(AREA).max(80)]).optional(),
  note: z.string().trim().max(1000).optional(),
  paymentMethod: z.enum(["cod", "online"]),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

type Attempt = {
  quoteId: string;
  quote: Quote;
  cartVersion: number;
  items: { sku: string; quantity: number }[];
  paymentMethod: string;
  areaId: string | null;
  idempotencyKey?: string;
  reference?: string;
  placedAt?: string;
  bodyHash?: string;
  /** The exact payload sent under idempotencyKey, kept until its outcome is known. */
  payload?: Record<string, unknown>;
  orderId?: string;
};

const ATTEMPT_TTL_SECONDS = 60 * 60 * 24;

export type QuoteResult =
  | { kind: "ok"; quoteId: string; quote: Quote }
  | { kind: "empty" }
  | { kind: "placed"; orderId: string }
  | { kind: "refused"; code: string; details: Record<string, unknown> }
  | { kind: "unavailable" };

/**
 * Asks the ERP what this cart costs now. Advisory: it reserves nothing (D31 H1, H2).
 *
 * With `startAttempt`, the quote becomes the checkout attempt the customer confirms. Before it
 * replaces an earlier attempt whose order request had an unknown outcome, that exact request is
 * replayed under its own key, so a timed-out order can never be followed by a second one.
 */
export async function quoteCart(
  tenant: Tenant,
  cartId: string,
  paymentMethod: string,
  areaId: string | null,
  startAttempt = false,
): Promise<QuoteResult> {
  if (startAttempt) {
    const pending = await resolvePendingAttempt(tenant, cartId);
    if (pending) {
      return pending;
    }
  }
  const cart = await readCart(tenant);
  if (cart.lines.length === 0) {
    return { kind: "empty" };
  }
  const items = cart.lines.map((line) => ({ sku: line.sku, quantity: line.quantity }));
  try {
    const { data } = await erpRequest<{ data: Quote }>(tenant.credential, "POST", "/checkout/quote", {
      body: {
        items,
        payment_method: paymentMethod,
        delivery: { area_id: areaId },
        coupon_code: null,
      },
      statedHost: tenant.statedHost,
    });
    const quote = data.data;
    if (!startAttempt) {
      return { kind: "ok", quoteId: "", quote };
    }
    const attempt: Attempt = {
      quoteId: randomToken(12),
      quote,
      cartVersion: cart.version,
      items,
      paymentMethod,
      areaId,
    };
    // A fresh quote starts a fresh attempt: any earlier key is for a body we will never send again.
    await (await redis()).set(keys.attempt(tenant.websiteKey, cartId), JSON.stringify(attempt), {
      EX: ATTEMPT_TTL_SECONDS,
    });
    return { kind: "ok", quoteId: attempt.quoteId, quote };
  } catch (error) {
    if (error instanceof ErpError) {
      return { kind: "refused", code: error.body.code, details: error.body.details };
    }
    if (error instanceof ErpUnavailable) {
      return { kind: "unavailable" };
    }
    throw error;
  }
}

async function resolvePendingAttempt(tenant: Tenant, cartId: string): Promise<QuoteResult | null> {
  const client = await redis();
  const attemptKey = keys.attempt(tenant.websiteKey, cartId);
  const lockKey = keys.attemptLock(tenant.websiteKey, cartId);
  const token = randomToken(12);
  if ((await client.set(lockKey, token, { NX: true, PX: 45000 })) !== "OK") {
    return { kind: "unavailable" };
  }
  try {
    const raw = await client.get(attemptKey);
    const attempt = raw ? (JSON.parse(raw) as Attempt) : null;
    if (!attempt || !attempt.idempotencyKey || !attempt.payload) {
      return null;
    }
    if (attempt.orderId) {
      return { kind: "placed", orderId: attempt.orderId };
    }
    try {
      const { data } = await erpRequest<Order>(tenant.credential, "POST", "/orders", {
        body: attempt.payload,
        idempotencyKey: attempt.idempotencyKey,
        statedHost: tenant.statedHost,
      });
      await settle(tenant, attemptKey, attempt, data.id);
      return { kind: "placed", orderId: data.id };
    } catch (error) {
      if (error instanceof ErpError) {
        const existing = (error.body.details.order as { id?: string } | undefined)?.id;
        if (error.body.code === "duplicate_storefront_order" && existing) {
          await settle(tenant, attemptKey, attempt, existing);
          return { kind: "placed", orderId: existing };
        }
        if (error.body.code === "request_in_progress") {
          return { kind: "unavailable" };
        }
        // Definitively refused: no order exists under that key, so a new attempt is safe.
        await client.del(attemptKey);
        return null;
      }
      if (error instanceof ErpUnavailable) {
        return { kind: "unavailable" };
      }
      throw error;
    }
  } finally {
    await releaseLock(lockKey, token);
  }
}

export type PlaceResult =
  | { kind: "placed"; orderId: string }
  | { kind: "stale-quote" }
  | { kind: "busy" }
  | { kind: "price-changed"; authoritative: { grand_total: Money } & Record<string, unknown> }
  | { kind: "refused"; code: string; details: Record<string, unknown> }
  | { kind: "retry" };

/**
 * Places the order exactly once.
 *
 * The body's claimed prices are the quote the customer was shown, held server-side — never figures
 * from the browser. The Idempotency-Key and storefront reference are written to Redis *before* the
 * call, so a timeout, a double click or a reload resubmits the identical body under the identical
 * key and the ERP answers with the order it already made (contract §4.7, §6.1). Any definitive
 * refusal discards them: the ERP stores refusals against the key, and the corrected order must be
 * a new request with a new key (§6.1.1).
 */
export async function placeOrder(
  tenant: Tenant,
  cartId: string,
  input: CheckoutInput,
  quoteId: string,
): Promise<PlaceResult> {
  const client = await redis();
  const attemptKey = keys.attempt(tenant.websiteKey, cartId);
  const lockKey = keys.attemptLock(tenant.websiteKey, cartId);
  const token = randomToken(12);
  if ((await client.set(lockKey, token, { NX: true, PX: 45000 })) !== "OK") {
    return { kind: "busy" };
  }

  try {
    const raw = await client.get(attemptKey);
    const attempt = raw ? (JSON.parse(raw) as Attempt) : null;
    if (!attempt || attempt.quoteId !== quoteId) {
      return { kind: "stale-quote" };
    }
    if (attempt.orderId) {
      return { kind: "placed", orderId: attempt.orderId };
    }

    const cart: Cart = await readCart(tenant);
    const areaId = input.areaId ? input.areaId : null;
    if (
      cart.version !== attempt.cartVersion ||
      attempt.paymentMethod !== input.paymentMethod ||
      attempt.areaId !== areaId
    ) {
      return { kind: "stale-quote" };
    }
    if (input.paymentMethod !== "cod" || !siteFeatures().cashOnDelivery) {
      return { kind: "refused", code: "payment_method_unavailable", details: { method: input.paymentMethod } };
    }
    if (!attempt.quote.payment.cod.enabled || !attempt.quote.payment.cod.eligible) {
      return { kind: "refused", code: "cod_limit_exceeded", details: { maximum: attempt.quote.payment.cod.maximum } };
    }

    const body = orderBody(attempt, input, areaId);
    const bodyHash = sha256Hex(JSON.stringify(body));
    if (attempt.idempotencyKey && attempt.payload && attempt.bodyHash !== bodyHash) {
      // An earlier request in this attempt has an unknown outcome; re-quoting resolves it first.
      return { kind: "stale-quote" };
    }
    if (!attempt.idempotencyKey) {
      attempt.idempotencyKey = randomUUID();
      attempt.reference = newReference();
      attempt.placedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
      attempt.bodyHash = bodyHash;
    }
    const payload = { storefront_order_reference: attempt.reference, placed_at: attempt.placedAt, ...body };
    attempt.payload = payload;
    await client.set(attemptKey, JSON.stringify(attempt), { EX: ATTEMPT_TTL_SECONDS });

    try {
      const { data } = await erpRequest<Order>(tenant.credential, "POST", "/orders", {
        body: payload,
        idempotencyKey: attempt.idempotencyKey,
        statedHost: tenant.statedHost,
      });
      await settle(tenant, attemptKey, attempt, data.id);
      return { kind: "placed", orderId: data.id };
    } catch (error) {
      if (error instanceof ErpError) {
        if (error.status === 409 && error.body.code === "request_in_progress") {
          return { kind: "retry" };
        }
        if (error.status === 409 && error.body.code === "duplicate_storefront_order") {
          // Our own reference, generated for this attempt alone: the order exists already.
          const existing = (error.body.details.order as { id?: string } | undefined)?.id;
          if (existing) {
            await settle(tenant, attemptKey, attempt, existing);
            return { kind: "placed", orderId: existing };
          }
        }
        await client.del(attemptKey);
        if (error.body.code === "price_mismatch") {
          return {
            kind: "price-changed",
            authoritative: error.body.details.authoritative as { grand_total: Money },
          };
        }
        return { kind: "refused", code: error.body.code, details: error.body.details };
      }
      if (error instanceof ErpUnavailable) {
        // Outcome unknown: keep the key and reference so the retry is the same request.
        return { kind: "retry" };
      }
      throw error;
    }
  } finally {
    await releaseLock(lockKey, token);
  }
}

async function settle(tenant: Tenant, attemptKey: string, attempt: Attempt, orderId: string): Promise<void> {
  attempt.orderId = orderId;
  await (await redis()).set(attemptKey, JSON.stringify(attempt), { EX: ATTEMPT_TTL_SECONDS });
  await rememberOrder(tenant, orderId);
  await clearCart(tenant);
}

function orderBody(attempt: Attempt, input: CheckoutInput, areaId: string | null) {
  const quote = attempt.quote;
  const money = (value: Money) => ({ amount: value.amount, currency: value.currency });
  const priceOf = new Map(quote.items.map((line) => [line.sku.toUpperCase(), line.unit_price]));
  const address = {
    line1: input.line1,
    line2: input.line2 || null,
    city: input.city,
    district: input.district || null,
    postcode: input.postcode || null,
    country: "BD",
    area_id: areaId,
  };
  return {
    customer: {
      storefront_customer_reference: null,
      name: input.name,
      email: input.email || null,
      phone: toE164(input.phone),
      is_guest: true,
    },
    shipping_address: address,
    items: attempt.items.map((item) => {
      const price = priceOf.get(item.sku.toUpperCase());
      if (!price) {
        throw new Error(`Quote has no line for ${item.sku}`);
      }
      return { sku: item.sku, quantity: item.quantity, unit_price: money(price) };
    }),
    totals: {
      subtotal: money(quote.subtotal),
      discount: money(quote.discount),
      shipping: money(quote.shipping),
      tax: money(quote.tax),
      grand_total: money(quote.grand_total),
    },
    payment: { method: "cod" },
    coupon_code: null,
    customer_note: input.note || null,
  };
}

function newReference(): string {
  const now = new Date();
  const date = now.toISOString().slice(2, 10).replace(/-/g, "");
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = Buffer.from(randomToken(10), "base64url");
  let suffix = "";
  for (let i = 0; i < 10; i++) {
    suffix += alphabet[bytes[i] % 32];
  }
  return `SF-${date}-${suffix}`;
}

export type OrderActionResult =
  | { kind: "ok"; order: Order }
  | { kind: "refused"; code: string; details: Record<string, unknown> }
  | { kind: "unavailable" };

export async function readOrder(tenant: Tenant, orderId: string): Promise<Order | null> {
  try {
    const { data } = await erpRequest<Order>(tenant.credential, "GET", `/orders/${encodeURIComponent(orderId)}`, {
      statedHost: tenant.statedHost,
    });
    return data;
  } catch (error) {
    if (error instanceof ErpError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function orderWrite(
  tenant: Tenant,
  orderId: string,
  path: "/confirmation" | "/confirmation/code",
  body: unknown,
): Promise<OrderActionResult> {
  try {
    const { data } = await erpRequest<Order>(tenant.credential, "POST", `/orders/${encodeURIComponent(orderId)}${path}`, {
      body,
      idempotencyKey: randomUUID(),
      statedHost: tenant.statedHost,
    });
    return { kind: "ok", order: data };
  } catch (error) {
    if (error instanceof ErpError) {
      return { kind: "refused", code: error.body.code, details: error.body.details };
    }
    if (error instanceof ErpUnavailable) {
      return { kind: "unavailable" };
    }
    throw error;
  }
}
