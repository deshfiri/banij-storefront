import "server-only";
import rawContent from "@site/content.json";
import { parseSiteContent, type SiteContent } from "@/config/content-schema";

let cached: SiteContent | null = null;

/** The installation's validated public content (site/content.json). Invalid content fails loudly. */
export function siteContent(): SiteContent {
  cached ??= parseSiteContent(rawContent);
  return cached;
}
