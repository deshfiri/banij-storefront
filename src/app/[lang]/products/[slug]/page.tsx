import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AddToCart } from "@/components/add-to-cart";
import { Benefits, shopBenefits } from "@/components/benefits";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ProductGallery } from "@/components/product-gallery";
import { ProductGrid } from "@/components/product-card";
import { SectionHeader } from "@/components/section-header";
import { type Dictionary, dictionary, isLocale } from "@/lib/i18n";
import type { Product } from "@/lib/types";
import { findProduct, listProducts, navigationCategories } from "@/server/catalog";
import { currentTenant } from "@/server/current";
import { imagesFor } from "@/server/media";
import { publicOrigin } from "@/server/urls";

/** A product image as the storefront itself serves it (the optimizer), never the raw ERP URL. */
function publicImageUrl(origin: string, url: string): string {
  return `${origin}/_next/image?url=${encodeURIComponent(url)}&w=1200&q=75`;
}

type Props = { params: Promise<{ lang: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  const tenant = await currentTenant();
  const product = await findProduct(tenant, slug);
  if (!product) {
    return { robots: { index: false } };
  }
  const { primary } = imagesFor(product);
  const origin = publicOrigin(tenant.site.hosts.primary, tenant.requestHost);
  return {
    title: product.seo.title || product.name,
    description: product.seo.description || product.short_description || undefined,
    alternates: { canonical: `/${lang}/products/${product.slug}` },
    openGraph: { title: product.name, images: primary ? [publicImageUrl(origin, primary.url)] : undefined, type: "website" },
  };
}

export default async function ProductPage({ params }: Props) {
  const { lang: raw, slug } = await params;
  const lang = isLocale(raw) ? raw : "en";
  const t = dictionary(lang);
  const tenant = await currentTenant();
  const product = await findProduct(tenant, slug);
  if (!product) {
    notFound();
  }
  const { primary, gallery } = imagesFor(product);
  const images = primary ? [primary, ...gallery] : [];
  const priced = product.variants.find((v) => v.price);
  const origin = publicOrigin(tenant.site.hosts.primary, tenant.requestHost);
  const category = product.categories[0] ?? null;
  const [benefits, navigation] = await Promise.all([shopBenefits(tenant, lang, t), navigationCategories(tenant)]);
  // The category's own storefront page when the website has one, otherwise the catalogue filter.
  const categoryHref = category
    ? `/${lang}${navigation.find((entry) => entry.slug === category.slug)?.href ?? `/products?category=${encodeURIComponent(category.slug)}`}`
    : `/${lang}/products`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    description: product.short_description ?? undefined,
    image: images.map((m) => publicImageUrl(origin, m.url)),
    brand: product.brand ? { "@type": "Brand", name: product.brand.name } : undefined,
    offers: priced?.price
      ? {
          "@type": "Offer",
          url: `${origin}/${lang}/products/${product.slug}`,
          priceCurrency: priced.price.currency,
          price: priced.price.amount,
          availability: product.variants.some((v) => v.availability.in_stock)
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
        }
      : undefined,
  };

  return (
    <article className="space-y-8 sm:space-y-10">
      <Breadcrumbs
        items={[
          { href: `/${lang}`, label: t.nav.home },
          ...(category ? [{ href: categoryHref, label: category.name }] : []),
          { label: product.name },
        ]}
      />

      <div className="grid gap-6 md:grid-cols-2 lg:gap-10">
        <ProductGallery images={images} labels={{ noImage: t.product.noImage, gallery: t.product.gallery, show: t.product.showImage }} />

        <div className="card space-y-5 p-5 sm:p-7">
          <div className="space-y-2">
            {category || product.brand ? (
              <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
                {[product.brand?.name, category?.name].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            <h1 className="text-2xl font-bold sm:text-3xl">{product.name}</h1>
            {product.promo_title && product.promotion ? (
              <p className="inline-block rounded-ctl bg-sale px-2 py-1 text-sm font-semibold text-white">{product.promo_title}</p>
            ) : null}
            {product.short_description ? <p className="text-muted">{product.short_description}</p> : null}
          </div>
          <div className="border-t border-line pt-5">
            <AddToCart
              slug={product.slug}
              variants={product.variants}
              minQuantity={Math.max(1, product.min_order_quantity || 1)}
              maxQuantity={product.max_order_quantity}
              lang={lang}
              t={t}
            />
          </div>
          <Benefits items={benefits} title={t.benefits.title} compact />
          <dl className="flex flex-wrap gap-2 border-t border-line pt-4 text-sm">
            <div className="chip">
              <dt className="text-muted">{t.product.sku}:</dt>
              <dd className="tabular font-medium">{product.sku}</dd>
            </div>
            {category ? (
              <div className="chip">
                <dt className="text-muted">{t.product.category}:</dt>
                <dd>
                  <Link href={categoryHref} className="font-medium hover:text-brand hover:underline">
                    {category.name}
                  </Link>
                </dd>
              </div>
            ) : null}
            {product.brand ? (
              <div className="chip">
                <dt className="text-muted">{t.product.brand}:</dt>
                <dd className="font-medium">{product.brand.name}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>

      {product.description ? (
        <section className="card p-5 sm:p-7" aria-labelledby="product-description">
          <h2 id="product-description" className="section-title mb-4 text-lg sm:text-xl">
            {t.product.description}
          </h2>
          <div className="max-w-prose leading-relaxed whitespace-pre-line text-ink/90">{product.description}</div>
        </section>
      ) : null}

      <Suspense fallback={null}>
        <MoreProducts product={product} lang={lang} t={t} />
      </Suspense>
      {/* Room for the mobile sticky purchase bar, so it never covers the end of the page. */}
      <div aria-hidden="true" className="h-16 md:hidden" />

      <script
        type="application/ld+json"
        // JSON.stringify output with "<" escaped cannot break out of the script element.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
    </article>
  );
}

/** Other products this website lists — same category first, then the rest. Real ERP listings only. */
async function MoreProducts({ product, lang, t }: { product: Product; lang: string; t: Dictionary }) {
  const tenant = await currentTenant();
  const category = product.categories[0]?.slug;
  const [same, all] = await Promise.all([
    category ? listProducts(tenant, { category, limit: 12 }).then((p) => p.data).catch(() => [] as Product[]) : Promise.resolve([] as Product[]),
    listProducts(tenant, { limit: 12 }).then((p) => p.data).catch(() => [] as Product[]),
  ]);
  const seen = new Set([product.id]);
  const others = [...same, ...all].filter((candidate) => !seen.has(candidate.id) && seen.add(candidate.id)).slice(0, 6);
  if (others.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="more-products">
      <SectionHeader id="more-products" title={t.product.moreProducts} href={`/${lang}/products`} linkLabel={t.home.viewAll} />
      <ProductGrid products={others} lang={lang} t={t} />
    </section>
  );
}
