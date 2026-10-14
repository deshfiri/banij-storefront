import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { previewMode } from "@/server/site-config";
import { resolveTenant } from "@/server/tenant";
import { publicOrigin } from "@/server/urls";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // A read-only preview is never crawled, and advertises no sitemap.
  if (previewMode()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  const resolution = await resolveTenant((await headers()).get("host"));
  if (resolution.kind !== "ok") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  const { site, requestHost } = resolution.tenant;
  const origin = publicOrigin(site.hosts.primary, requestHost);
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/*/cart", "/*/checkout", "/*/orders/"] },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
