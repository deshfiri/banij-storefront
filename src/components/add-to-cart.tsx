"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { addToCartAction, type CartActionState } from "@/app/actions";
import { CartIcon, MinusIcon, PlusIcon } from "@/components/icons";
import { type Dictionary, fill } from "@/lib/i18n";
import type { Variant } from "@/lib/types";

/**
 * Product page purchase box: the ERP's price, options, stock as the ERP reports it, a quantity
 * stepper, Add to cart and Buy now (adds, then goes straight to checkout). The server action re-reads
 * the product, variant and price from the ERP; nothing from this form is trusted.
 *
 * On phones a sticky bar repeats the price and both actions once the main buttons scroll out of view.
 * It belongs to the same form, so it always submits the selected option and quantity. While the main
 * buttons are visible the bar is inert and hidden from assistive technology — one set of controls at
 * a time.
 */
export function AddToCart({
  slug,
  variants,
  minQuantity,
  maxQuantity,
  lang,
  t,
}: {
  slug: string;
  variants: Variant[];
  minQuantity: number;
  maxQuantity: number | null;
  lang: string;
  t: Dictionary;
}) {
  const initial = variants.find((v) => v.availability.in_stock && v.price) ?? variants[0];
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [quantity, setQuantity] = useState(String(minQuantity));
  const [state, action, pending] = useActionState<CartActionState, FormData>(addToCartAction, { status: "idle" });
  const selected = useMemo(() => variants.find((v) => v.sku === sku), [variants, sku]);
  const purchasable = Boolean(selected?.availability.in_stock && selected.price);
  const max = Math.max(minQuantity, Math.min(maxQuantity ?? 99, selected?.availability.quantity || 99));
  const hasOptions = variants.length > 1;
  const current = Number.parseInt(quantity, 10);
  const step = (delta: number) => {
    const base = Number.isInteger(current) ? current : minQuantity;
    setQuantity(String(Math.min(max, Math.max(minQuantity, base + delta))));
  };

  // The sticky bar shows only while the main action row is off screen (mobile only, via CSS).
  const actions = useRef<HTMLDivElement>(null);
  const [barVisible, setBarVisible] = useState(false);
  useEffect(() => {
    const target = actions.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setBarVisible(!entry.isIntersecting), { threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  const barQuantity = Number.isInteger(current) && current >= minQuantity ? current : minQuantity;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="sku" value={sku} />
      <input type="hidden" name="lang" value={lang} />

      {selected?.price ? (
        <p className="tabular flex items-baseline gap-3">
          <span className="text-3xl font-bold sm:text-4xl">{selected.price.formatted}</span>
          {selected.compare_at_price ? <s className="text-lg text-muted">{selected.compare_at_price.formatted}</s> : null}
        </p>
      ) : (
        <p className="text-muted">{t.product.unavailable}</p>
      )}

      <p className="text-sm font-medium" aria-live="polite">
        {selected?.availability.in_stock ? (
          selected.availability.quantity > 0 && selected.availability.quantity <= 5 ? (
            <span className="text-warning">● {fill(t.product.lowStock, { n: selected.availability.quantity })}</span>
          ) : (
            <span className="text-success">● {t.product.inStock}</span>
          )
        ) : (
          <span className="text-danger">● {t.product.outOfStock}</span>
        )}
      </p>

      {hasOptions ? (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{t.product.option}</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((variant) => {
              const label = Object.values(variant.attributes).join(" / ") || variant.sku;
              const out = !variant.availability.in_stock;
              return (
                <label
                  key={variant.sku}
                  className={`flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-ctl border px-3.5 text-sm font-medium transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${
                    variant.sku === sku ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface hover:border-muted"
                  } ${out ? "opacity-50 line-through" : ""}`}
                >
                  <input
                    type="radio"
                    name="variant"
                    value={variant.sku}
                    checked={variant.sku === sku}
                    onChange={() => setSku(variant.sku)}
                    className="sr-only"
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold" id="quantity-label">
            {t.product.quantity}
          </span>
          <div className="stepper">
            <button type="button" onClick={() => step(-1)} disabled={!Number.isInteger(current) || current <= minQuantity} aria-label={t.product.decrease}>
              <MinusIcon size={18} />
            </button>
            <input
              type="number"
              name="quantity"
              min={minQuantity}
              max={max}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              inputMode="numeric"
              aria-labelledby="quantity-label"
            />
            <button type="button" onClick={() => step(1)} disabled={Number.isInteger(current) && current >= max} aria-label={t.product.increase}>
              <PlusIcon size={18} />
            </button>
          </div>
        </div>
        <div ref={actions} className="grid grid-cols-2 gap-3">
          <button type="submit" disabled={!purchasable || pending} className="btn btn-outline min-h-12 border-brand text-brand hover:bg-brand-soft">
            <CartIcon size={18} />
            {pending ? "…" : t.product.addToCart}
          </button>
          <button type="submit" name="intent" value="buy" disabled={!purchasable || pending} className="btn btn-accent min-h-12">
            {t.product.buyNow}
          </button>
        </div>
      </div>

      <p role="status" aria-live="polite" className="min-h-5 text-sm">
        {state.status === "added" ? (
          <span className="text-success">
            {t.product.added} ·{" "}
            <Link href={`/${lang}/cart`} className="font-medium underline">
              {t.nav.cart} ({state.count})
            </Link>
          </span>
        ) : state.status === "error" ? (
          <span className="text-danger">{state.message === "out_of_stock" ? t.product.outOfStock : t.product.unavailable}</span>
        ) : null}
      </p>
      <p className="text-xs text-muted">{t.product.availabilityNote}</p>

      <div
        data-sticky-buy
        aria-hidden={!barVisible}
        inert={!barVisible}
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-pop backdrop-blur transition-transform duration-200 motion-reduce:transition-none md:hidden ${
          barVisible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {selected?.price ? <p className="tabular truncate text-lg leading-tight font-bold">{selected.price.formatted}</p> : null}
            {barVisible ? (
              <p className="truncate text-xs">
                {state.status === "added" ? (
                  <Link href={`/${lang}/cart`} className="font-medium text-success underline">
                    ✓ {t.nav.cart} ({state.count})
                  </Link>
                ) : purchasable ? (
                  <span className="text-muted">
                    {selected && hasOptions ? `${Object.values(selected.attributes).join(" / ") || selected.sku} · ` : ""}× {barQuantity}
                  </span>
                ) : (
                  <span className="text-danger">{t.product.outOfStock}</span>
                )}
              </p>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={!purchasable || pending}
            aria-label={fill(t.product.addQuantity, { n: barQuantity })}
            title={fill(t.product.addQuantity, { n: barQuantity })}
            className="btn btn-outline size-12 shrink-0 border-brand px-0 text-brand"
          >
            <CartIcon size={20} />
          </button>
          <button type="submit" name="intent" value="buy" disabled={!purchasable || pending} className="btn btn-accent min-h-12 shrink-0 px-6">
            {t.product.buyNow}
          </button>
        </div>
      </div>
    </form>
  );
}
