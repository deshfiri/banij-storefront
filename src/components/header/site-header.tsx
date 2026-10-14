import Link from "next/link";
import { Suspense } from "react";
import { BrandMark } from "@/components/brand-mark";
import { CartIcon, UserIcon } from "@/components/icons";
import { type Dictionary, fill, languageName, LOCALES } from "@/lib/i18n";
import type { Site } from "@/lib/types";
import type { NavCategory } from "@/server/catalog";
import { CategoryBar } from "./category-bar";
import { LanguageLink } from "./language-link";
import { MobileMenu } from "./mobile-menu";
import { SearchBox, SearchForm } from "./search-box";

/**
 * Site header.
 *
 *   ≥1024px  [mark  Shop name]  [———————— search ————————][⌕]   [বাংলা] [cart] [orders]
 *   <1024px  [☰] [mark  Shop name]                 [বাংলা] [cart] [orders]
 *            [——————————— search ———————————][⌕]
 *            category tabs (scroll horizontally)
 *
 * The person icon opens the orders this browser placed (there are no customer accounts). The cart
 * count is server-rendered. Colours come from the website's own branding.
 */
export function SiteHeader({
  lang,
  site,
  categories,
  cartCount,
  ordersEnabled,
  t,
}: {
  lang: string;
  site: Site;
  categories: NavCategory[];
  cartCount: number;
  ordersEnabled: boolean;
  t: Dictionary;
}) {
  const otherLocales = LOCALES.filter((l) => l !== lang && site.locale.available.includes(l));
  const languages = LOCALES.filter((l) => site.locale.available.includes(l)).map((locale) => ({ locale, label: languageName(locale) }));
  const cartLabel = fill(t.nav.cartWithCount, { n: cartCount });

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/90">
      <div className="page-container flex flex-wrap items-center gap-x-2.5 gap-y-2.5 py-3 sm:gap-x-3 lg:flex-nowrap lg:gap-x-8 lg:py-4">
        <MobileMenu
          lang={lang}
          shopName={site.name}
          categories={categories}
          languages={languages}
          contact={{ phone: site.contact.phone, email: site.contact.email }}
          ordersHref={ordersEnabled ? `/${lang}/orders` : null}
          labels={{
            orders: t.nav.orders,
            open: t.nav.openMenu,
            close: t.nav.closeMenu,
            menu: t.nav.menu,
            all: t.nav.allProducts,
            categories: t.nav.categories,
            language: t.nav.language,
            contact: t.footer.contact,
            empty: t.nav.categoriesSoon,
          }}
        />

        <Link href={`/${lang}`} className="flex min-w-0 flex-1 items-center lg:flex-none" aria-label={site.name} title={site.name}>
          <BrandMark site={site} />
        </Link>

        <div className="order-last w-full lg:order-none lg:flex-1">
          <Suspense fallback={<SearchForm lang={lang} placeholder={t.nav.search} buttonLabel={t.nav.searchButton} />}>
            <SearchBox lang={lang} placeholder={t.nav.search} buttonLabel={t.nav.searchButton} />
          </Suspense>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {otherLocales.map((l) => (
            <Suspense
              key={l}
              fallback={
                <Link href={`/${l}`} hrefLang={l} lang={l} className="btn btn-sm btn-ghost">
                  {languageName(l)}
                </Link>
              }
            >
              <LanguageLink to={l} label={languageName(l)} className="btn btn-sm btn-ghost" />
            </Suspense>
          ))}
          <Link href={`/${lang}/cart`} className="icon-btn" aria-label={cartLabel} data-cart-count={cartCount}>
            <CartIcon size={22} />
            {cartCount > 0 ? (
              <span className="count-badge" aria-hidden="true">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            ) : null}
          </Link>
          {ordersEnabled ? (
            // From 640px up; on phones "Your orders" is in the menu drawer, leaving room for the shop name.
            <Link href={`/${lang}/orders`} className="icon-btn hidden sm:inline-flex" aria-label={t.nav.orders} title={t.nav.orders}>
              <UserIcon size={22} />
            </Link>
          ) : null}
        </div>
      </div>

      <Suspense fallback={null}>
        <CategoryBar
          lang={lang}
          categories={categories}
          labels={{ all: t.nav.all, allProducts: t.nav.allProducts, navigation: t.nav.categories, empty: t.nav.categoriesSoon }}
        />
      </Suspense>
    </header>
  );
}
