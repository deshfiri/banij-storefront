import type { Metadata } from "next";
import { Catalog } from "@/components/catalog";
import { dictionary, isLocale } from "@/lib/i18n";
import { navigationCategories, sanitizeProductQuery } from "@/server/catalog";
import { currentTenant } from "@/server/current";
import { previewMode } from "@/server/site-config";

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { lang } = await params;
  const query = sanitizeProductQuery(await searchParams);
  const t = dictionary(isLocale(lang) ? lang : "en");
  const filtered = Object.keys(query).length > 0;
  return {
    title: query.q ? `${t.catalog.searchFor} ${query.q}` : t.catalog.title,
    alternates: { canonical: `/${lang}/products` },
    // Filtered, sorted and paginated variants are not separate pages for search engines. The key is
    // omitted otherwise — an explicit `undefined` would erase the layout's preview `noindex`.
    ...(filtered && !previewMode() ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function ProductsPage({ params, searchParams }: Props) {
  const { lang: raw } = await params;
  const lang = isLocale(raw) ? raw : "en";
  const t = dictionary(lang);
  const tenant = await currentTenant();
  const query = sanitizeProductQuery(await searchParams);
  // A catalogue category chosen from the navigation: show its own name, from the ERP.
  const categoryName = query.category
    ? (await navigationCategories(tenant)).find((category) => category.slug === query.category)?.name
    : undefined;
  return (
    <Catalog
      tenant={tenant}
      query={query}
      lang={lang}
      t={t}
      basePath={`/${lang}/products`}
      title={categoryName ?? t.catalog.title}
      categoryName={categoryName}
    />
  );
}
