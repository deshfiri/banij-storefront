import "server-only";
import rawConfig from "@site/site.config.json";
import { parseImageOrigin } from "@/config/image-origin";
import { parseSiteConfig, type SiteConfig } from "@/config/site-schema";
import type { Credential } from "./registry";

/**
 * Deployment mode (P3, superseding D30).
 *
 * - `single` (default, the production model): this deployment is ONE independently installed
 *   website. Its public identity comes from `site/site.config.json`; its credentials from the
 *   server-side environment. There is no registry lookup and every other host is a 404.
 * - `shared` (LEGACY, development compatibility only, pending approved removal): one deployment,
 *   many websites, resolved through the development credential registry. Selected only by
 *   `STOREFRONT_MODE=shared` outside production; production refuses it at boot.
 */
export function storefrontMode(): "shared" | "single" {
  return process.env.STOREFRONT_MODE === "shared" && process.env.NODE_ENV !== "production" ? "shared" : "single";
}

/**
 * Private preview (docs/private-preview-plan.md): a read-only visual preview of an installation.
 * Browsing, cart, themes and localization work; every order operation is refused before it can
 * reach the ERP. Server-side only (`STOREFRONT_PREVIEW=true` in the installation's .env).
 */
export function previewMode(): boolean {
  return process.env.STOREFRONT_PREVIEW === "true";
}

/** The advisory checkout quote in preview: off unless explicitly enabled (it needs `orders:write`). */
export function previewQuoteEnabled(): boolean {
  return previewMode() && process.env.STOREFRONT_PREVIEW_QUOTE === "true";
}

/** A preview runs only as a single installation whose site is configured as staging or development. */
export function assertPreviewMode(): void {
  if (!previewMode()) {
    return;
  }
  if (storefrontMode() !== "single") {
    throw new Error("STOREFRONT_PREVIEW requires a single installation");
  }
  if (siteConfig().deployment.environment === "production") {
    throw new Error("STOREFRONT_PREVIEW is refused for a site configured as production");
  }
}

/**
 * The trusted image origin must parse, and a local/private one (which needs Next's
 * `dangerouslyAllowLocalIP`) is development/staging only — a production site uses public HTTPS media.
 *
 * It must also be the origin this build allows: the image optimizer's allow-list is fixed at build
 * time (next.config.ts), so a server started with a different STOREFRONT_IMAGE_ORIGIN would show
 * placeholders for every product. `STOREFRONT_BUILD_IMAGE_ORIGIN` is what the build recorded; it is
 * absent outside a Next build (tests), where there is nothing to compare.
 */
export function assertImageOrigin(): void {
  const origin = parseImageOrigin(process.env.STOREFRONT_IMAGE_ORIGIN);
  if (origin?.isLocal && storefrontMode() === "single" && siteConfig().deployment.environment === "production") {
    throw new Error("STOREFRONT_IMAGE_ORIGIN must not be a local address on a production-configured site");
  }
  const built = process.env.STOREFRONT_BUILD_IMAGE_ORIGIN;
  if (built !== undefined && JSON.stringify(parseImageOrigin(built || undefined)) !== JSON.stringify(origin)) {
    throw new Error("STOREFRONT_IMAGE_ORIGIN differs from the image origin this build allows; rebuild with the same value");
  }
}

/** Fails a production boot that asks for the legacy shared mode, instead of silently ignoring it. */
export function assertDeploymentMode(): void {
  if (process.env.NODE_ENV === "production" && process.env.STOREFRONT_MODE === "shared") {
    throw new Error("STOREFRONT_MODE=shared is legacy development compatibility and is refused in production");
  }
}

let cached: SiteConfig | null = null;

/** The validated site config. Throws at first use if it is invalid — a misconfigured site serves nothing. */
export function siteConfig(): SiteConfig {
  cached ??= parseSiteConfig(rawConfig);
  return cached;
}

/** Feature flags: the site's own in single mode; template defaults for the shared deployment. */
export function siteFeatures(): SiteConfig["features"] {
  if (storefrontMode() === "single") {
    return siteConfig().features;
  }
  return { flashDeals: true, bestSellers: true, featured: true, newArrivals: true, cashOnDelivery: true, onlinePayment: false };
}

/** Hosts this single-website deployment answers on. */
export function singleSiteHosts(config: SiteConfig): string[] {
  const dev = process.env.NODE_ENV !== "production" ? config.domains.development : [];
  return [config.domains.primary, ...config.domains.aliases, ...dev];
}

/**
 * Installation environment (P3): entered manually by an admin into the server-side .env, never in
 * site.config.json, the repository, the image or the browser.
 */
const INSTALLATION_ENV = {
  BANIJ_ERP_BASE_URL: (value: string) => /^https:\/\/[^\s/?#]+(?::\d{1,5})?\/?$/.test(value),
  BANIJ_CREDENTIAL_KEY_ID: (value: string) => /^wsk_[0-9A-Z]{26}$/.test(value),
  BANIJ_CREDENTIAL_SECRET: (value: string) => /^[0-9a-f]{64}$/.test(value),
} as const;

/** Validates the installation env. The error names the variables at fault — never a value. */
export function assertInstallationEnv(): void {
  const faulty = Object.entries(INSTALLATION_ENV)
    .filter(([name, valid]) => !valid((process.env[name] ?? "").trim()))
    .map(([name]) => name);
  if (faulty.length > 0) {
    throw new Error(`Installation environment missing or malformed: ${faulty.join(", ")}`);
  }
}

/**
 * The installation's credential, from the server-side environment only. `websiteKey` is the
 * configured (expected) website id, used solely to namespace this installation's own Redis keys —
 * it is never sent to the ERP, which derives the website from the credential.
 */
export function installationCredential(config: SiteConfig): Credential {
  assertInstallationEnv();
  return {
    websiteKey: config.website.id,
    keyId: process.env.BANIJ_CREDENTIAL_KEY_ID!.trim(),
    secret: process.env.BANIJ_CREDENTIAL_SECRET!.trim(),
  };
}

/** The ERP endpoint of this installation (server-side .env). */
export function installationErpBaseUrl(): string {
  assertInstallationEnv();
  return process.env.BANIJ_ERP_BASE_URL!.trim();
}
