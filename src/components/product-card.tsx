import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { type Dictionary, fill } from "@/lib/i18n";
import type { Product } from "@/lib/types";
import { imagesFor } from "@/server/media";
import { Price } from "./price";
import { ProductImage } from "./product-image";
import { QuickAdd } from "./quick-add";

export function primaryVariant(product: Product) {
  return product.variants.find((variant) => variant.availability.in_stock && variant.price) ?? product.variants[0];
}

export function Availability({ inStock, quantity, t }: { inStock: boolean; quantity: number; t: Dictionary }) {
  if (!inStock) {
    return <span className="text-xs font-medium text-danger">● {t.product.outOfStock}</span>;
  }
  if (quantity > 0 && quantity <= 5) {
    return <span className="text-xs font-medium text-warning">● {fill(t.product.lowStock, { n: quantity })}</span>;
  }
  return <span className="text-xs font-medium text-success">● {t.product.inStock}</span>;
}

/**
 * Product card: image, name, the ERP's own price and a compact add control. One link covers the
 * image, name and price; the add control sits beside it, never inside it. Stock is only mentioned
 * when it matters (out of stock, or low) — and then exactly as the ERP reports it. No rating is
 * shown: the ERP sends none.
 */
export function ProductCard({ product, lang, t }: { product: Product; lang: string; t: Dictionary }) {
  const variant = primaryVariant(product);
  const { primary } = imagesFor(product);
  const purchasable = product.variants.filter((v) => v.availability.in_stock && v.price);
  const inStock = purchasable.length > 0;
  const quantity = variant?.availability.quantity ?? 0;
  const href = `/${lang}/products/${product.slug}`;

  return (
    <article className="card group relative flex flex-col overflow-hidden transition-shadow hover:shadow-card">
      <Link href={href} className="flex flex-1 flex-col">
        <div className="relative aspect-square overflow-hidden bg-surface" data-card-image>
          <ProductImage
            image={primary}
            sizes="(min-width: 1500px) 16vw, (min-width: 1200px) 20vw, (min-width: 900px) 25vw, (min-width: 640px) 33vw, 50vw"
            placeholderLabel={t.product.noImage}
            className="p-1 transition duration-300 group-hover:scale-[1.03]"
          />
          {variant?.compare_at_price ? (
            <span className="absolute left-2 top-2 rounded-ctl bg-sale px-2 py-0.5 text-xs font-semibold text-white">
              {product.promo_title || t.product.sale}
            </span>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 px-3 pt-3 pb-3.5 sm:px-4">
          <h3 className="line-clamp-2 min-h-[2.6em] text-[0.9375rem] leading-snug font-semibold">{product.name}</h3>
          {!inStock || (quantity > 0 && quantity <= 5) ? (
            <Availability inStock={inStock} quantity={quantity} t={t} />
          ) : null}
          <Price value={variant?.price ?? null} compareAt={variant?.compare_at_price} className="mt-auto pr-12 text-lg" />
        </div>
      </Link>
      {inStock ? (
        <div className="absolute right-3 bottom-3 sm:right-4">
          {purchasable.length === 1 ? (
            <QuickAdd
              slug={product.slug}
              sku={purchasable[0].sku}
              label={fill(t.product.quickAdd, { name: product.name })}
              addedLabel={t.product.added}
              errorLabel={t.product.unavailable}
            />
          ) : (
            // Same destination as the card link: hidden from assistive tech and the tab order.
            <Link
              href={href}
              aria-hidden="true"
              tabIndex={-1}
              aria-label={fill(t.product.chooseOptions, { name: product.name })}
              title={fill(t.product.chooseOptions, { name: product.name })}
              className="inline-flex size-10 items-center justify-center rounded-ctl border border-brand text-brand transition hover:bg-brand-soft sm:size-11"
            >
              <ChevronRightIcon size={20} />
            </Link>
          )}
        </div>
      ) : null}
    </article>
  );
}

export function ProductGrid({ products, lang, t, narrow = false }: { products: Product[]; lang: string; t: Dictionary; narrow?: boolean }) {
  return (
    <div className={`product-grid ${narrow ? "product-grid-narrow" : ""}`}>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} lang={lang} t={t} />
      ))}
    </div>
  );
}

export function ProductGridSkeleton({ count = 6, narrow = false }: { count?: number; narrow?: boolean }) {
  return (
    <div className={`product-grid ${narrow ? "product-grid-narrow" : ""}`} aria-busy>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card overflow-hidden">
          <div className="skeleton aspect-square rounded-none" />
          <div className="space-y-2 p-4">
            <div className="skeleton h-4 w-4/5" />
            <div className="skeleton h-4 w-3/5" />
            <div className="flex items-center justify-between pt-2">
              <div className="skeleton h-5 w-2/5" />
              <div className="skeleton size-10" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
