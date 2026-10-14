/* eslint-disable @next/next/no-img-element -- banners come from the ERP's media host or the installation's content */
import Link from "next/link";
import { Suspense } from "react";
import { localized } from "@/config/content-schema";
import { Benefits, shopBenefits } from "@/components/benefits";
import { HeroCarousel } from "@/components/hero-carousel";
import { ArrowRightIcon } from "@/components/icons";
import { ProductGrid, ProductGridSkeleton } from "@/components/product-card";
import { ProductImage } from "@/components/product-image";
import { SectionHeader } from "@/components/section-header";
import { type Dictionary, dictionary, isLocale } from "@/lib/i18n";
import { safeImage } from "@/lib/format";
import type { Product } from "@/lib/types";
import { listProducts, navigationCategories, type ProductQuery } from "@/server/catalog";
import { currentTenant } from "@/server/current";
import { imagesFor } from "@/server/media";
import { siteContent } from "@/server/site-content";
import { siteFeatures } from "@/server/site-config";
import { customizations, type HeroSlotProps } from "@site/customizations";

type SectionName = "flashDeals" | "bestSellers" | "featured" | "newArrivals";

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  const lang = isLocale(raw) ? raw : "en";
  const t = dictionary(lang);
  const { site } = await currentTenant();
  const Hero = customizations.Hero ?? DefaultHero;

  return (
    <div className="space-y-10 sm:space-y-12">
      <Hero name={site.name} tagline={site.branding.tagline} shopHref={`/${lang}/products`} shopLabel={t.home.shopNow} />
      <Suspense fallback={<CategoryTilesSkeleton />}>
        <CategoryTiles lang={lang} t={t} />
      </Suspense>
      <Suspense
        fallback={
          <section className="space-y-4">
            <div className="skeleton h-7 w-48" />
            <ProductGridSkeleton count={6} />
          </section>
        }
      >
        <ProductSections lang={lang} t={t} />
      </Suspense>
      <Suspense fallback={null}>
        <HomeBenefits lang={lang} t={t} />
      </Suspense>
    </div>
  );
}

/* ---- Hero -------------------------------------------------------------------------------------- */

/**
 * Template default for the Hero slot (site/customizations.tsx may replace it). In order:
 *   1. the installation's own slides (site/content.json),
 *   2. the ERP banner (branding.banner_url),
 *   3. a panel in the website's own colours: its name, its tagline, and real product photos.
 * It never invents an offer or a discount.
 */
async function DefaultHero({ name, tagline, shopHref, shopLabel }: HeroSlotProps) {
  const tenant = await currentTenant();
  const lang = shopHref.split("/")[1] ?? "en";
  const t = dictionary(isLocale(lang) ? lang : "en");
  const slides = siteContent().hero.slides;
  const banner = safeImage(tenant.site.branding.banner_url);
  const frame = "relative overflow-hidden rounded-card border border-line";

  if (slides.length > 0) {
    return (
      <>
        <h1 className="sr-only">{name}</h1>
        <HeroCarousel
          slides={slides.map((slide) => ({
            image: slide.image,
            alt: localized(slide.alt, lang),
            headline: slide.headline ? localized(slide.headline, lang) : null,
            subline: slide.subline ? localized(slide.subline, lang) : null,
            cta: slide.cta ? { href: `/${lang}${slide.cta.href}`, label: localized(slide.cta.label, lang) } : null,
          }))}
          labels={{
            region: t.home.slides,
            slide: t.home.slide,
            previous: t.home.previousSlide,
            next: t.home.nextSlide,
            show: t.home.showSlide,
          }}
        />
      </>
    );
  }

  if (banner) {
    return (
      <section className={frame} data-slot="hero">
        <h1 className="sr-only">{name}</h1>
        <Link href={shopHref} aria-label={shopLabel}>
          <img
            src={banner}
            alt=""
            width={1600}
            height={600}
            fetchPriority="high"
            className="aspect-[16/9] h-auto w-full object-cover sm:aspect-[8/3]"
          />
        </Link>
      </section>
    );
  }

  const products = await listProducts(tenant, { sort: "featured", limit: 12 })
    .then((page) => page.data)
    .catch(() => [] as Product[]);
  const pictured = products
    .map((product) => ({ product, image: imagesFor(product).primary }))
    .filter((entry) => entry.image !== null)
    .slice(0, 3);

  return (
    <section className={`${frame} bg-brand-soft`} data-slot="hero">
      {/* Decorative shapes in the website's own accent. */}
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-brand opacity-[0.08]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/3 size-96 rounded-full bg-brand opacity-[0.06]" />
      <div className="relative grid items-center gap-8 px-6 py-10 sm:px-10 sm:py-14 lg:min-h-[24rem] lg:grid-cols-[1.1fr_1fr] lg:px-16">
        <div className="max-w-xl">
          <p className="mb-3 inline-flex rounded-pill bg-surface px-3 py-1 text-sm font-medium text-brand shadow-sm">{t.home.heroWelcome}</p>
          <h1 className="text-3xl font-bold sm:text-5xl">{name}</h1>
          <p className="mt-4 text-base text-muted sm:text-lg">{tagline ?? t.home.heroBrowse}</p>
          <Link href={shopHref} className="btn btn-accent mt-7 min-h-12 px-6 text-base">
            {shopLabel}
            <ArrowRightIcon size={18} />
          </Link>
        </div>
        {pictured.length > 0 ? (
          <ul className="grid grid-cols-3 gap-3 sm:gap-4" aria-hidden="true">
            {pictured.map(({ product, image }, index) => (
              <li
                key={product.id}
                className={`relative aspect-[3/4] overflow-hidden rounded-card bg-surface shadow-card ${index === 1 ? "lg:-translate-y-5" : "lg:translate-y-3"}`}
              >
                <ProductImage image={image} sizes="(min-width: 1024px) 14vw, 30vw" placeholderLabel="" preload={index === 0} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/* ---- Shop by category -------------------------------------------------------------------------- */

/**
 * The website's categories (from the ERP) as image tiles. A tile's picture is the primary image of a
 * product the website actually lists in that category; a category with none shows its initial.
 */
async function CategoryTiles({ lang, t }: { lang: string; t: Dictionary }) {
  const tenant = await currentTenant();
  const [categories, page] = await Promise.all([
    navigationCategories(tenant),
    listProducts(tenant, { limit: 50 }).catch(() => null),
  ]);
  if (categories.length === 0) {
    return null;
  }
  const pictureOf = (slug: string) => {
    for (const product of page?.data ?? []) {
      if (product.categories.some((category) => category.slug === slug)) {
        const image = imagesFor(product).primary;
        if (image) {
          return image;
        }
      }
    }
    return null;
  };

  return (
    <section aria-labelledby="shop-by-category">
      <SectionHeader id="shop-by-category" title={t.home.shopByCategory} />
      <ul className="scroll-x -mx-[var(--gutter)] flex gap-3 px-[var(--gutter)] sm:mx-0 sm:flex-wrap sm:gap-4 sm:px-0">
        {categories.map((category) => {
          const image = pictureOf(category.slug);
          return (
            <li key={category.slug} className="w-[6.5rem] shrink-0 sm:w-[8.5rem]">
              <Link href={`/${lang}${category.href}`} className="group block text-center">
                <span className="relative flex aspect-square items-center justify-center overflow-hidden rounded-card bg-brand-soft transition group-hover:shadow-card">
                  {image ? (
                    <span className="absolute inset-3 sm:inset-4">
                      <ProductImage image={{ url: image.url, alt: "" }} sizes="136px" placeholderLabel="" className="transition duration-300 group-hover:scale-105" />
                    </span>
                  ) : (
                    <span aria-hidden className="text-3xl font-bold text-brand">
                      {Array.from(category.name)[0]}
                    </span>
                  )}
                </span>
                <span className="mt-2 block text-sm leading-tight font-medium group-hover:text-brand">{category.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CategoryTilesSkeleton() {
  return (
    <section className="space-y-4">
      <div className="skeleton h-7 w-52" />
      <div className="flex gap-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="skeleton aspect-square w-[6.5rem] sm:w-[8.5rem]" />
        ))}
      </div>
    </section>
  );
}

/* ---- Product sections -------------------------------------------------------------------------- */

/**
 * The homepage product sections, in the website's order. Each comes from its own ERP listing; a
 * section that would only repeat products already shown above it is left out, and a failing one
 * never takes the page down. New arrivals always renders (it falls back to the plain listing).
 *
 * Labels say only what the data supports. "Featured products" is the shop's own choice: the products
 * it marked featured, or — when it marked none — its own display order. "Best sellers" is not shown
 * by default: the storefront cannot see sales figures, so it cannot tell a real ranking from an empty
 * one. A website with real sales can opt in through `customizations.homeSections`.
 */
async function ProductSections({ lang, t }: { lang: string; t: Dictionary }) {
  const tenant = await currentTenant();
  const features = siteFeatures();
  const definitions: Record<SectionName, { title: string; href: string; query: ProductQuery }> = {
    flashDeals: { title: t.home.flashDeals, href: `/${lang}/products?flash_deal=true`, query: { flash_deal: "true", limit: 12 } },
    bestSellers: { title: t.home.bestSellers, href: `/${lang}/products?sort=best_selling`, query: { sort: "best_selling", limit: 12 } },
    featured: { title: t.home.featured, href: `/${lang}/products?featured=true`, query: { featured: "true", limit: 12 } },
    newArrivals: { title: t.home.newArrivals, href: `/${lang}/products?sort=newest`, query: { sort: "newest", limit: 12 } },
  };
  const order = (customizations.homeSections ?? (["flashDeals", "featured", "newArrivals"] as const)).filter((name) => features[name]);

  const results = await Promise.all(
    order.map(async (name) => {
      try {
        const products = (await listProducts(tenant, definitions[name].query)).data;
        if (name === "featured" && products.length === 0) {
          // Nothing marked featured: the shop's own display order is still its own choice.
          definitions.featured.href = `/${lang}/products?sort=featured`;
          return { name, products: (await listProducts(tenant, { sort: "featured", limit: 12 })).data };
        }
        return { name, products };
      } catch (error) {
        console.error("[storefront] home section failed", { section: name, error: error instanceof Error ? error.message : error });
        if (name !== "newArrivals") {
          return { name, products: [] as Product[] };
        }
        const fallback = await listProducts(tenant, { limit: 12 }).then((page) => page.data).catch(() => [] as Product[]);
        return { name, products: fallback };
      }
    }),
  );

  const shown = new Set<string>();
  const sections = results.filter(({ products }) => {
    const fresh = products.some((product) => !shown.has(product.id));
    products.forEach((product) => shown.add(product.id));
    return products.length > 0 && fresh;
  });

  if (sections.length === 0) {
    return (
      <section className="card p-10 text-center text-muted">
        <p>{t.catalog.empty}</p>
      </section>
    );
  }
  return (
    <>
      {sections.map(({ name, products }) => (
        <section key={name} aria-labelledby={`section-${name}`}>
          <SectionHeader id={`section-${name}`} title={definitions[name].title} href={definitions[name].href} linkLabel={t.home.viewAll} />
          <ProductGrid products={products} lang={lang} t={t} />
        </section>
      ))}
    </>
  );
}

async function HomeBenefits({ lang, t }: { lang: string; t: Dictionary }) {
  const items = await shopBenefits(await currentTenant(), lang, t);
  return <Benefits items={items} title={t.benefits.title} />;
}
