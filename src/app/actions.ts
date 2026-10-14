"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import type { Order, Quote } from "@/lib/types";
import { canViewOrder, clampQuantity, currentCartId, mutateCart } from "@/server/cart";
import { findProduct } from "@/server/catalog";
import { checkoutSchema, orderWrite, placeOrder, quoteCart, type PlaceResult } from "@/server/checkout";
import { currentTenant } from "@/server/current";
import { imagesFor } from "@/server/media";
import { previewMode, previewQuoteEnabled } from "@/server/site-config";

/** The single answer every disabled operation gives in a read-only preview. */
const PREVIEW_REFUSAL = { kind: "refused", code: "preview_disabled", details: {} } as const;

export type CartActionState = { status: "idle" | "added" | "error"; message?: string; count?: number };

export async function addToCartAction(_previous: CartActionState, form: FormData): Promise<CartActionState> {
  const tenant = await currentTenant();
  const slug = String(form.get("slug") ?? "");
  const sku = String(form.get("sku") ?? "");
  const quantity = Number.parseInt(String(form.get("quantity") ?? "1"), 10);

  // The product and variant are re-read from the ERP for this website — never trusted from the form.
  const product = await findProduct(tenant, slug);
  const variant = product?.variants.find((candidate) => candidate.sku === sku);
  if (!product || !variant || !variant.price) {
    return { status: "error", message: "unavailable" };
  }
  if (!variant.availability.in_stock) {
    return { status: "error", message: "out_of_stock" };
  }
  const bounds = { minQuantity: Math.max(1, product.min_order_quantity || 1), maxQuantity: product.max_order_quantity };
  const label = Object.values(variant.attributes).join(" / ") || null;

  const cart = await mutateCart(tenant, (current) => {
    const existing = current.lines.find((line) => line.sku === sku);
    if (existing) {
      existing.quantity = clampQuantity(existing.quantity + (Number.isInteger(quantity) ? quantity : 1), bounds);
    } else {
      current.lines.push({
        sku,
        quantity: clampQuantity(Number.isInteger(quantity) ? quantity : 1, bounds),
        productSlug: product.slug,
        name: product.name,
        variantLabel: label,
        image: imagesFor(product).primary?.url ?? null, // display snapshot only (trusted origin, position 1)
        ...bounds,
      });
    }
    return current;
  });
  revalidatePath("/", "layout");
  // "Buy now": the same add, then straight to checkout (which re-quotes everything with the ERP).
  const lang = String(form.get("lang") ?? "");
  if (form.get("intent") === "buy" && isLocale(lang)) {
    redirect(`/${lang}/checkout`);
  }
  return { status: "added", count: cart.lines.reduce((sum, line) => sum + line.quantity, 0) };
}

export async function updateCartLineAction(form: FormData): Promise<void> {
  const tenant = await currentTenant();
  const sku = String(form.get("sku") ?? "");
  const quantity = form.get("remove") ? 0 : Number.parseInt(String(form.get("quantity") ?? "0"), 10);
  await mutateCart(tenant, (current) => {
    for (const line of current.lines) {
      if (line.sku === sku) {
        line.quantity = clampQuantity(quantity, line);
      }
    }
    return current;
  });
  revalidatePath("/", "layout");
}

export type QuoteActionResult =
  | { kind: "ok"; quoteId: string; quote: Quote }
  | { kind: "placed"; orderId: string }
  | { kind: "invalid"; fields: Record<string, string> }
  | { kind: "empty" }
  | { kind: "refused"; code: string; details: Record<string, unknown> }
  | { kind: "unavailable" };

export async function quoteAction(input: Record<string, string>): Promise<QuoteActionResult> {
  if (previewMode() && !previewQuoteEnabled()) {
    return PREVIEW_REFUSAL;
  }
  const tenant = await currentTenant();
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return { kind: "invalid", fields: fieldErrors(parsed.error.issues) };
  }
  const cartId = await currentCartId();
  if (!cartId) {
    return { kind: "empty" };
  }
  return quoteCart(tenant, cartId, parsed.data.paymentMethod, parsed.data.areaId || null, true);
}

export type PlaceActionResult =
  | Exclude<PlaceResult, { kind: "placed" }>
  | { kind: "invalid"; fields: Record<string, string> };

export async function placeOrderAction(
  lang: string,
  input: Record<string, string>,
  quoteId: string,
): Promise<PlaceActionResult> {
  // Preview: ordering is disabled, refused before anything else runs (the ERP client refuses too).
  if (previewMode()) {
    return PREVIEW_REFUSAL;
  }
  const tenant = await currentTenant();
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return { kind: "invalid", fields: fieldErrors(parsed.error.issues) };
  }
  const cartId = await currentCartId();
  if (!cartId) {
    return { kind: "stale-quote" };
  }
  const result = await placeOrder(tenant, cartId, parsed.data, quoteId);
  if (result.kind === "placed") {
    revalidatePath("/", "layout");
    redirect(`/${isLocale(lang) ? lang : "en"}/orders/${result.orderId}`);
  }
  return result;
}

export type ConfirmationResult =
  | { kind: "ok"; order: Order }
  | { kind: "refused"; code: string; details: Record<string, unknown> }
  | { kind: "unavailable" }
  | { kind: "forbidden" };

export async function confirmCodAction(orderId: string, code: string): Promise<ConfirmationResult> {
  if (previewMode()) {
    return PREVIEW_REFUSAL;
  }
  const tenant = await currentTenant();
  if (!(await canViewOrder(tenant, orderId))) {
    return { kind: "forbidden" };
  }
  const trimmed = code.replace(/\s/g, "");
  if (!/^\d{4,8}$/.test(trimmed)) {
    return { kind: "refused", code: "confirmation_refused", details: {} };
  }
  return orderWrite(tenant, orderId, "/confirmation", { code: trimmed });
}

export async function resendCodeAction(orderId: string): Promise<ConfirmationResult> {
  if (previewMode()) {
    return PREVIEW_REFUSAL;
  }
  const tenant = await currentTenant();
  if (!(await canViewOrder(tenant, orderId))) {
    return { kind: "forbidden" };
  }
  return orderWrite(tenant, orderId, "/confirmation/code", {});
}

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const name = String(issue.path[0] ?? "form");
    fields[name] ??= issue.message;
  }
  return fields;
}
