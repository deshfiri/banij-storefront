import type { Metadata } from "next";
import Link from "next/link";
import { CartQuantity } from "@/components/cart-quantity";
import { isTrustedImageUrl } from "@/config/image-origin";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CartIcon } from "@/components/icons";
import { ProductImage } from "@/components/product-image";
import { EmptyState } from "@/components/states";
import { dictionary, isLocale } from "@/lib/i18n";
import { currentCartId, readCart } from "@/server/cart";
import { quoteCart } from "@/server/checkout";
import { findProduct } from "@/server/catalog";
import { imageOrigin } from "@/server/media";
import { currentTenant } from "@/server/current";
import { previewMode, previewQuoteEnabled } from "@/server/site-config";

export const metadata: Metadata = { title: "Cart", robots: { index: false } };

export default async function CartPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  const lang = isLocale(raw) ? raw : "en";
  const t = dictionary(lang);
  const tenant = await currentTenant();
  const cart = await readCart(tenant);

  if (cart.lines.length === 0) {
    return (
      <div className="py-6">
        <EmptyState
          headingLevel={1}
          icon={<CartIcon size={26} />}
          title={t.cart.title}
          text={t.cart.empty}
          action={{ href: `/${lang}/products`, label: t.cart.continue }}
        />
      </div>
    );
  }

  // Live prices for display come from the ERP's advisory quote, never from the cart snapshot.
  // A read-only preview without the quote shows each product's own ERP price instead (catalogue
  // read only); it never computes a total.
  const usesQuote = !previewMode() || previewQuoteEnabled();
  const method = tenant.site.checkout.payment_methods.includes("cod") ? "cod" : "online";
  const cartId = await currentCartId();
  const quote = usesQuote && cartId ? await quoteCart(tenant, cartId, method, null) : null;
  const catalogPrices = usesQuote
    ? null
    : new Map(
        await Promise.all(
          cart.lines.map(async (line) => {
            const product = await findProduct(tenant, line.productSlug).catch(() => null);
            return [line.sku, product?.variants.find((variant) => variant.sku === line.sku)?.price ?? null] as const;
          }),
        ),
      );
  const lines = quote?.kind === "ok" ? new Map(quote.quote.items.map((line) => [line.sku.toUpperCase(), line])) : null;
  const refusedSku = quote?.kind === "refused" ? String(quote.details.sku ?? "") : "";

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ href: `/${lang}`, label: t.nav.home }, { label: t.cart.title }]} />
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem] lg:gap-8">
      <section className="space-y-4">
        <h1 className="text-2xl font-bold sm:text-3xl">{t.cart.title}</h1>
        <ul className="space-y-3">
          {cart.lines.map((line) => {
            const priced = lines?.get(line.sku.toUpperCase());
            const image = line.image && isTrustedImageUrl(line.image, imageOrigin()) ? { url: line.image, alt: "" } : null;
            return (
              <li key={line.sku} className="card flex gap-4 p-3 sm:p-4">
                <div className="relative size-20 shrink-0 overflow-hidden rounded-ctl border border-line bg-surface sm:size-24">
                  <ProductImage image={image} sizes="96px" placeholderLabel="" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <Link href={`/${lang}/products/${line.productSlug}`} className="line-clamp-2 font-semibold hover:text-brand hover:underline">
                    {line.name}
                  </Link>
                  {line.variantLabel ? <p className="text-sm text-muted">{line.variantLabel}</p> : null}
                  {priced ? (
                    <p className="tabular text-sm">
                      {priced.unit_price.formatted} × {line.quantity} = <strong>{priced.line_total.formatted}</strong>
                      {!priced.availability.reservable ? (
                        <span className="ml-2 text-warning">· {t.checkout.notReservable}</span>
                      ) : null}
                    </p>
                  ) : refusedSku === line.sku ? (
                    <p className="text-sm text-danger">{t.product.unavailable}</p>
                  ) : catalogPrices?.get(line.sku) ? (
                    <p className="tabular text-sm" data-preview-price>
                      {catalogPrices.get(line.sku)!.formatted} × {line.quantity}
                    </p>
                  ) : null}
                  <CartQuantity
                    sku={line.sku}
                    name={line.name}
                    quantity={line.quantity}
                    minQuantity={line.minQuantity}
                    maxQuantity={line.maxQuantity}
                    labels={{ quantity: t.product.quantity, decrease: t.product.decrease, increase: t.product.increase, remove: t.cart.remove }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <aside className="card h-fit space-y-4 p-5 sm:p-6 lg:sticky lg:top-[calc(var(--header-h)+5rem)]">
        <h2 className="text-lg font-bold">{t.checkout.summary}</h2>
        {quote?.kind === "ok" ? (
          <p className="tabular flex justify-between border-t border-line pt-4 text-lg">
            <span>{t.cart.subtotal}</span>
            <strong>{quote.quote.subtotal.formatted}</strong>
          </p>
        ) : quote?.kind === "unavailable" ? (
          <p className="text-sm text-danger">{t.states.errorText}</p>
        ) : null}
        {previewMode() ? (
          <p className="text-sm font-medium" data-preview-cart-note>
            {t.preview.cartNote}
          </p>
        ) : (
          <p className="text-sm text-muted">{t.cart.estimate}</p>
        )}
        <Link href={`/${lang}/checkout`} className="btn btn-accent min-h-12 w-full">
          {t.cart.checkout}
        </Link>
        <Link href={`/${lang}/products`} className="btn btn-ghost w-full">
          {t.cart.continue}
        </Link>
      </aside>
    </div>
    </div>
  );
}
