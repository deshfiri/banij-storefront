import "server-only";
import { installationErpBaseUrl, storefrontMode } from "./site-config";

/**
 * Server-only configuration. Nothing here may be imported by a client component:
 * `server-only` makes such an import a build error rather than a leaked secret.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export const env = {
  /** Base URL of the ERP, e.g. https://erp.banij.example — the API prefix is appended. */
  get erpBaseUrl(): string {
    // An installation takes its ERP endpoint from its server-side .env (BANIJ_ERP_BASE_URL);
    // ERP_BASE_URL is the legacy shared-development variable.
    const url = storefrontMode() === "single" ? installationErpBaseUrl() : required("ERP_BASE_URL");
    return url.replace(/\/+$/, "");
  },
  /** Dedicated storefront Redis — never the ERP's. */
  get redisUrl(): string {
    return required("STOREFRONT_REDIS_URL");
  },
  /** 32-byte key, base64, used to encrypt registry secrets at rest (AES-256-GCM). */
  get registryKey(): Buffer {
    const key = Buffer.from(required("STOREFRONT_REGISTRY_KEY"), "base64");
    if (key.length !== 32) {
      throw new Error("STOREFRONT_REGISTRY_KEY must be 32 bytes, base64-encoded");
    }
    return key;
  },
  /** Base domain under which every website answers as {subdomain}.{domain} (D30 §3). */
  get rootDomain(): string {
    return required("STOREFRONT_ROOT_DOMAIN").toLowerCase();
  },
  get secureCookies(): boolean {
    return process.env.STOREFRONT_INSECURE_COOKIES !== "true";
  },
  /** Public scheme the storefront is served on; https everywhere outside local development. */
  get publicScheme(): "https" | "http" {
    return process.env.STOREFRONT_PUBLIC_SCHEME === "http" && process.env.NODE_ENV !== "production"
      ? "http"
      : "https";
  },
  /** Extra public port, development only (e.g. 3000). Empty in production. */
  get publicPort(): string {
    return process.env.NODE_ENV === "production" ? "" : (process.env.STOREFRONT_PUBLIC_PORT ?? "");
  },
};
