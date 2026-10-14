import "server-only";
import type { Site } from "@/lib/types";
import { env } from "./env";
import { ErpError, ErpUnavailable, erpRequest } from "./erp";
import { normalizeHost } from "./host";
import { keys, redis } from "./redis";
import { type Credential, credentialOf, registryEntry, websiteKeyForHost } from "./registry";
import { installationCredential, singleSiteHosts, siteConfig, storefrontMode } from "./site-config";
import type { SiteConfig } from "@/config/site-schema";

export type Tenant = {
  /** The host the customer used. */
  requestHost: string;
  /** The host stated to the ERP, which verifies it belongs to the credential's website (D30 §2). */
  statedHost: string;
  websiteKey: string;
  credential: Credential;
  site: Site;
};

export type Resolution =
  | { kind: "ok"; tenant: Tenant }
  | { kind: "redirect"; location: string }
  | { kind: "not-found" }
  | { kind: "unavailable"; reason: UnavailableReason; message?: string | null };

/**
 * `identity`: the installation's credential, configured website id and configured domain do not
 * agree with what the ERP says (or the installation env is invalid). An operator must fix `.env` or
 * `site.config.json`; customers see only a generic "temporarily unavailable" page.
 */
export type UnavailableReason = "suspended" | "maintenance" | "preparing" | "erp" | "identity";

const SITE_TTL_SECONDS = 60;
const UNAVAILABLE_TTL_SECONDS = 20;

/**
 * DEVELOPMENT ONLY: `karimtraders.localhost` stands in for `karimtraders.{root domain}`, because a
 * browser resolves `*.localhost` to loopback with no hosts-file edits. Never active in production.
 */
export function canonicalHostFor(requestHost: string): string {
  const suffix = process.env.STOREFRONT_DEV_HOST_SUFFIX;
  if (process.env.NODE_ENV !== "production" && suffix && requestHost.endsWith(`.${suffix}`)) {
    return `${requestHost.slice(0, -(suffix.length + 1))}.${env.rootDomain}`;
  }
  return requestHost;
}

export async function resolveTenant(rawHost: string | null): Promise<Resolution> {
  const requestHost = normalizeHost(rawHost);
  if (!requestHost) {
    return { kind: "not-found" };
  }
  if (storefrontMode() === "single") {
    return resolveSingleSite(requestHost);
  }
  const statedHost = canonicalHostFor(requestHost);
  const websiteKey = await websiteKeyForHost(statedHost);
  if (!websiteKey) {
    return { kind: "not-found" };
  }
  const entry = await registryEntry(websiteKey);
  if (!entry || !entry.hosts.includes(statedHost)) {
    return { kind: "not-found" };
  }
  const credential = credentialOf(entry);

  const site = await loadSite(websiteKey, credential, statedHost);
  if ("unavailable" in site) {
    return { kind: "unavailable", reason: site.unavailable, message: site.message };
  }
  // The site's id must be the registry's website: a mis-provisioned entry serves nothing.
  if (site.id !== websiteKey) {
    console.error("[storefront] registry website does not match /site id", { websiteKey });
    return { kind: "not-found" };
  }
  if (site.status === "maintenance") {
    return { kind: "unavailable", reason: "maintenance", message: site.maintenance_message };
  }
  if (site.status !== "open") {
    return { kind: "unavailable", reason: site.status === "preparing" ? "preparing" : "suspended" };
  }

  // Aliases redirect to the primary (D30 §3). Dev-mapped hosts are left where they are.
  if (statedHost === requestHost && statedHost !== site.hosts.primary) {
    const known = [site.hosts.subdomain, ...site.hosts.aliases].includes(statedHost);
    if (known && entry.hosts.includes(site.hosts.primary)) {
      return { kind: "redirect", location: `https://${site.hosts.primary}` };
    }
  }

  return { kind: "ok", tenant: { requestHost, statedHost, websiteKey, credential, site } };
}

/**
 * Single independent installation (the production model, P3).
 *
 * Authentication is the credential alone: the ERP derives the website from it. The configured
 * `website.id` is only an expected-identity ASSERTION. Every request checks:
 *   1. the request host is one this installation declares (else 404);
 *   2. the ERP accepts the credential and the configured primary host (401 / host_mismatch → 503);
 *   3. the website the ERP returns is the configured website (else 503);
 *   4. the configured primary is one of the hosts the ERP has registered for that website (else 503);
 *   5. a configured alias is served (as a redirect) only while the ERP lists it (else 404).
 * Identity failures are never cached and never reveal which check failed.
 */
async function resolveSingleSite(requestHost: string): Promise<Resolution> {
  let config: SiteConfig;
  let credential: Credential;
  try {
    config = siteConfig();
    credential = installationCredential(config);
  } catch (error) {
    identityLog("installation_misconfigured", { reason: error instanceof Error ? error.message : "invalid" });
    return { kind: "unavailable", reason: "identity" };
  }
  if (!singleSiteHosts(config).includes(requestHost)) {
    return { kind: "not-found" };
  }
  const primary = config.domains.primary;

  const site = await loadSite(config.website.id, credential, primary);
  if ("unavailable" in site) {
    return { kind: "unavailable", reason: site.unavailable, message: site.message };
  }
  if (site.id !== config.website.id) {
    identityLog("identity_mismatch", { check: "website", expected: config.website.id, keyId: keyHint(credential) });
    return { kind: "unavailable", reason: "identity" };
  }
  const registered = registeredHosts(site);
  if (!registered.includes(primary)) {
    identityLog("identity_mismatch", { check: "primary_host", expected: config.website.id, host: primary });
    return { kind: "unavailable", reason: "identity" };
  }
  if (config.domains.aliases.includes(requestHost)) {
    if (!registered.includes(requestHost)) {
      identityLog("alias_not_registered", { expected: config.website.id, host: requestHost });
      return { kind: "not-found" };
    }
    return { kind: "redirect", location: `https://${primary}` };
  }
  if (site.status === "maintenance") {
    return { kind: "unavailable", reason: "maintenance", message: site.maintenance_message };
  }
  if (site.status !== "open") {
    return { kind: "unavailable", reason: site.status === "preparing" ? "preparing" : "suspended" };
  }
  return {
    kind: "ok",
    tenant: { requestHost, statedHost: primary, websiteKey: config.website.id, credential, site: withSiteOverrides(site, config) },
  };
}

/** The website's own presentation choices layered over the ERP's /site answer (never its rules). */
function withSiteOverrides(site: Site, config: SiteConfig): Site {
  const available = config.locale.available?.filter((l) => site.locale.available.includes(l));
  return {
    ...site,
    branding: {
      ...site.branding,
      theme: config.theme.preset ?? site.branding.theme,
      primary_color: config.theme.colors.primary ?? site.branding.primary_color,
      secondary_color: config.theme.colors.secondary ?? site.branding.secondary_color,
    },
    locale: {
      default: config.locale.default && (available ?? site.locale.available).includes(config.locale.default) ? config.locale.default : site.locale.default,
      available: available && available.length > 0 ? available : site.locale.available,
    },
  };
}

/** Every host the ERP has registered for the website it says the credential belongs to. */
function registeredHosts(site: Site): string[] {
  const hosts = [site.hosts?.primary, site.hosts?.subdomain, ...(site.hosts?.aliases ?? [])];
  return hosts.filter((host): host is string => typeof host === "string").map((host) => host.toLowerCase());
}

function keyHint(credential: Credential): string {
  return `${credential.keyId.slice(0, 8)}…`;
}

/** Structured, secret-free operator log line for identity problems. */
function identityLog(event: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ at: new Date().toISOString(), channel: "identity", event, ...fields }));
}

type SiteLoad = Site | { unavailable: "suspended" | "erp" | "identity"; message?: string | null };

/**
 * The website's /site answer, cached briefly. The cache key carries the credential's key id, so a
 * credential change (edit .env, restart) can never reuse identity cached under the previous one.
 */
export function siteCacheKey(websiteKey: string, keyId: string, statedHost: string): string {
  return `${keys.site(websiteKey)}:${keyId}:${statedHost}`;
}

async function loadSite(websiteKey: string, credential: Credential, statedHost: string): Promise<SiteLoad> {
  const client = await redis();
  const cacheKey = siteCacheKey(websiteKey, credential.keyId, statedHost);
  const cached = await client.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as SiteLoad;
  }
  let result: SiteLoad;
  let ttl = SITE_TTL_SECONDS;
  try {
    const response = await erpRequest<{ data: Site }>(credential, "GET", "/site", { statedHost });
    result = response.data.data;
  } catch (error) {
    ttl = UNAVAILABLE_TTL_SECONDS;
    if (error instanceof ErpError && error.body.code === "website_unavailable") {
      result = { unavailable: "suspended" };
    } else if (error instanceof ErpError && (error.body.code === "host_mismatch" || error.status === 401)) {
      // The credential is refused, or the configured host is not this credential's website. Not cached:
      // the operator's fix (edit .env or site.config.json, restart) must take effect immediately.
      identityLog("identity_mismatch", { check: error.status === 401 ? "credential" : "stated_host", host: statedHost, keyId: keyHint(credential) });
      return { unavailable: "identity" };
    } else if (error instanceof ErpUnavailable || error instanceof ErpError) {
      console.error("[storefront] /site failed", error.message);
      return { unavailable: "erp" }; // not cached: recover as soon as the ERP does
    } else {
      throw error;
    }
  }
  await client.set(cacheKey, JSON.stringify(result), { EX: ttl });
  return result;
}
