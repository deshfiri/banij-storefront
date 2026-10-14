import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isLocale } from "@/lib/i18n";
import { listCategories, listProducts } from "@/server/catalog";
import { previewMode } from "@/server/site-config";
import { resolveTenant } from "@/server/tenant";
import { publicOrigin } from "@/server/urls";

/** This website's own pages only, under its own primary host. Bounded to the first 200 products. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (previewMode()) {
    return []; // a read-only preview lists nothing
  }
  const resolution = await resolveTenant((await headers()).get("host"));
  if (resolution.kind !== "ok") {
    return [];
  }
  const tenant = resolution.tenant;
  const origin = publicOrigin(tenant.site.hosts.primary, tenant.requestHost);
  const locales = tenant.site.locale.available.filter(isLocale);
  const [products, categories] = await Promise.all([
    listProducts(tenant, { limit: 200 }).then((page) => page.data).catch(() => []),
    listCategories(tenant).catch(() => []),
  ]);
  return locales.flatMap((lang) => [
    { url: `${origin}/${lang}`, changeFrequency: "daily" as const },
    { url: `${origin}/${lang}/products`, changeFrequency: "daily" as const },
    ...categories.map((category) => ({ url: `${origin}/${lang}/categories/${category.slug}` })),
    ...products.map((product) => ({ url: `${origin}/${lang}/products/${product.slug}`, lastModified: product.updated_at })),
  ]);
}
