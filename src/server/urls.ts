import "server-only";
import { env } from "./env";
import { siteConfig, storefrontMode } from "./site-config";
import { canonicalHostFor } from "./tenant";

/**
 * The public origin pages, canonical links, robots and sitemaps use.
 *
 * Single installation: always the configured primary host over HTTPS (the identity check proves the
 * ERP lists it for this website); only a configured development host, outside production, keeps the
 * browser where it is. Legacy shared development mode keeps its previous behaviour.
 */
export function publicOrigin(primaryHost: string, requestHost: string): string {
  const port = env.publicPort ? `:${env.publicPort}` : "";
  if (storefrontMode() === "single") {
    const config = siteConfig();
    if (process.env.NODE_ENV !== "production" && config.domains.development.includes(requestHost)) {
      return `${env.publicScheme}://${requestHost}${port}`;
    }
    return `https://${config.domains.primary}`;
  }
  if (canonicalHostFor(requestHost) !== requestHost) {
    return `${env.publicScheme}://${requestHost}${port}`;
  }
  return `https://${primaryHost}`;
}
