import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Catalog } from "@/components/catalog";
import { dictionary, isLocale } from "@/lib/i18n";
import { listCategories, sanitizeProductQuery } from "@/server/catalog";
import { currentTenant } from "@/server/current";

type Props = {
  params: Promise<{ lang: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function category(slug: string) {
  const tenant = await currentTenant();
  const categories = await listCategories(tenant);
  return categories.find((candidate) => candidate.slug === slug) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  const found = await category(slug);
  return found ? { title: found.name, alternates: { canonical: `/${lang}/categories/${found.slug}` } } : {};
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { lang: raw, slug } = await params;
  const lang = isLocale(raw) ? raw : "en";
  const found = await category(slug);
  if (!found) {
    notFound();
  }
  const tenant = await currentTenant();
  const query = { ...sanitizeProductQuery(await searchParams), category: found.slug };
  return (
    <Catalog
      tenant={tenant}
      query={query}
      lang={lang}
      t={dictionary(lang)}
      basePath={`/${lang}/categories/${found.slug}`}
      title={found.name}
      categoryName={found.name}
      categoryInPath
    />
  );
}
