import Link from "next/link";
import { ProductGrid } from "@/components/product-card";
import { CloseIcon, SearchIcon } from "@/components/icons";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { EmptyState } from "@/components/states";
import { type Dictionary, fill } from "@/lib/i18n";
import type { Facets, Page, Product } from "@/lib/types";
import { listProducts, productFacets, type ProductQuery } from "@/server/catalog";
import type { Tenant } from "@/server/tenant";

const SORT_KEYS = ["featured", "best_selling", "newest", "price_asc", "price_desc", "name"] as const;

/**
 * The catalogue: all products, a category, or search results. Filters are a plain GET form (no
 * JavaScript needed): a sidebar from tablet up, a collapsible panel on phones. Every product, price
 * and facet comes from the ERP for this website.
 */
export async function Catalog({
  tenant,
  query,
  lang,
  t,
  basePath,
  title,
  categoryInPath = false,
  categoryName,
}: {
  tenant: Tenant;
  query: ProductQuery;
  lang: string;
  t: Dictionary;
  basePath: string;
  title: string;
  /** True on /categories/{slug}, where the category is the route; otherwise it is a query parameter. */
  categoryInPath?: boolean;
  /** The category's display name, when the listing is filtered to one. */
  categoryName?: string;
}) {
  let page: Page<Product>;
  let facets: Facets | null = null;
  try {
    [page, facets] = await Promise.all([listProducts(tenant, query), productFacets(tenant, query).catch(() => null)]);
  } catch {
    return (
      <EmptyState
        tone="error"
        title={t.states.error}
        text={t.states.errorText}
        action={{ href: basePath, label: t.states.retry }}
        role="alert"
        headingLevel={1}
      />
    );
  }

  const params = (extra: Record<string, string | undefined>) => {
    const merged: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...query, ...extra })) {
      if (value !== undefined && value !== "" && key !== "limit" && !(categoryInPath && key === "category")) {
        merged[key] = String(value);
      }
    }
    const search = new URLSearchParams(merged).toString();
    return search ? `${basePath}?${search}` : basePath;
  };

  const brandName = facets?.brands.find((brand) => brand.slug === query.brand)?.name ?? query.brand;
  const chips = [
    query.q ? { key: "q", label: `“${query.q}”` } : null,
    !categoryInPath && query.category ? { key: "category", label: categoryName ?? query.category } : null,
    query.brand ? { key: "brand", label: brandName ?? "" } : null,
    query.price_min ? { key: "price_min", label: `≥ ৳${query.price_min}` } : null,
    query.price_max ? { key: "price_max", label: `≤ ৳${query.price_max}` } : null,
    query.in_stock === "true" ? { key: "in_stock", label: t.catalog.inStockOnly } : null,
    query.flash_deal === "true" ? { key: "flash_deal", label: t.catalog.flashOnly } : null,
  ].filter((chip): chip is { key: string; label: string } => chip !== null);
  const heading = query.q ? `${t.catalog.searchFor} “${query.q}”` : title;

  const filters = (
    <form action={basePath} className="space-y-4 text-sm" aria-label={t.catalog.filters}>
      {query.q ? <input type="hidden" name="q" value={query.q} /> : null}
      {!categoryInPath && query.category ? <input type="hidden" name="category" value={query.category} /> : null}
      <label className="block space-y-1.5">
        <span className="font-semibold">{t.catalog.sort}</span>
        <select name="sort" defaultValue={query.sort ?? ""} className="field">
          <option value="">—</option>
          {SORT_KEYS.map((key) => (
            <option key={key} value={key}>
              {t.catalog.sorts[key]}
            </option>
          ))}
        </select>
      </label>
      {facets && facets.brands.length > 0 ? (
        <label className="block space-y-1.5">
          <span className="font-semibold">{t.catalog.brand}</span>
          <select name="brand" defaultValue={query.brand ?? ""} className="field">
            <option value="">—</option>
            {facets.brands.map((brand) => (
              <option key={brand.id} value={brand.slug}>
                {brand.name} ({brand.products})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 font-semibold">{t.catalog.price}</legend>
        <div className="flex gap-2">
          <input name="price_min" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" placeholder={facets?.price_range?.minimum.amount ?? t.catalog.min} defaultValue={query.price_min} className="field tabular" aria-label={t.catalog.min} />
          <input name="price_max" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" placeholder={facets?.price_range?.maximum.amount ?? t.catalog.max} defaultValue={query.price_max} className="field tabular" aria-label={t.catalog.max} />
        </div>
      </fieldset>
      <label className="flex min-h-9 items-center gap-2.5">
        <input type="checkbox" name="in_stock" value="true" defaultChecked={query.in_stock === "true"} className="size-4 accent-brand" />
        {t.catalog.inStockOnly}
      </label>
      <label className="flex min-h-9 items-center gap-2.5">
        <input type="checkbox" name="flash_deal" value="true" defaultChecked={query.flash_deal === "true"} className="size-4 accent-brand" />
        {t.catalog.flashOnly}
      </label>
      <div className="flex gap-2 pt-1">
        <button className="btn btn-accent flex-1">{t.catalog.apply}</button>
        <Link href={basePath} className="btn btn-ghost">
          {t.catalog.clear}
        </Link>
      </div>
    </form>
  );

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { href: `/${lang}`, label: t.nav.home },
          ...(categoryName || query.q ? [{ href: `/${lang}/products`, label: t.nav.allProducts }] : []),
          { label: categoryName ?? (query.q ? `“${query.q}”` : title) },
        ]}
      />
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          {categoryName ? <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">{t.catalog.category}</p> : null}
          <h1 className="text-2xl font-bold sm:text-3xl">{heading}</h1>
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" aria-label={t.catalog.activeFilters}>
          {chips.map((chip) => (
            <Link key={chip.key} href={params({ [chip.key]: undefined, cursor: undefined })} className="chip hover:border-brand" aria-label={fill(t.catalog.removeFilter, { name: chip.label })}>
              {chip.label}
              <CloseIcon size={14} />
            </Link>
          ))}
          <Link href={basePath} className="px-2 text-sm font-medium text-brand hover:underline">
            {t.catalog.clear}
          </Link>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[16.5rem_1fr]">
        {/* One filter form: always open beside the grid on desktop; a CSS-only toggle on phones and tablets. */}
        <aside className="card h-fit">
          <input type="checkbox" id="filters-toggle" className="peer sr-only lg:hidden" />
          <label
            htmlFor="filters-toggle"
            className="flex min-h-12 cursor-pointer items-center justify-between px-4 font-semibold peer-focus-visible:outline-2 peer-focus-visible:outline-focus lg:hidden"
          >
            {t.catalog.filters}
            <span className="text-sm font-normal text-muted">{chips.length > 0 ? chips.length : ""}</span>
          </label>
          <div className="hidden border-t border-line p-4 peer-checked:block lg:block lg:border-0 lg:p-5">{filters}</div>
        </aside>

        <div className="space-y-6">
          {page.data.length === 0 ? (
            <EmptyState icon={<SearchIcon size={26} />} title={t.catalog.empty} text={t.catalog.emptyHint} action={{ href: basePath, label: t.catalog.clear }} />
          ) : (
            <ProductGrid products={page.data} lang={lang} t={t} narrow />
          )}
          <nav className="flex justify-between gap-3" aria-label="Pagination">
            {query.cursor ? (
              <Link href={params({ cursor: undefined })} className="btn btn-ghost">
                ← {t.catalog.first}
              </Link>
            ) : (
              <span />
            )}
            {page.meta.has_more && page.meta.next_cursor ? (
              <Link href={params({ cursor: page.meta.next_cursor })} className="btn btn-ghost">
                {t.catalog.next} →
              </Link>
            ) : null}
          </nav>
        </div>
      </div>
    </div>
  );
}
