import { z } from "zod";

/**
 * Configuration of ONE website built from the Banij master storefront template.
 *
 * Lives in `site/site.config.json` of that website's own project. It is non-secret by construction:
 * the credential is only *referenced* (key id + the name of the environment variable or file that
 * holds the secret at runtime). The schema refuses anything that looks like a secret value.
 *
 * Pure module: no server-only imports, so the generator and tests can validate configs directly.
 */
export const SITE_CONFIG_SCHEMA_VERSION = 2;

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const HOST = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const host = z.string().toLowerCase().regex(HOST, "must be a lowercase host name without scheme or port");

export const siteConfigSchema = z
  .object({
    schemaVersion: z.literal(SITE_CONFIG_SCHEMA_VERSION),
    /** Which template release this website was generated from; the generator's upgrade anchor. */
    template: z.object({
      name: z.literal("banij-storefront"),
      version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    }),
    /**
     * EXPECTED identity: the ERP public id of the website this installation is meant to be. It is an
     * assertion checked against what the ERP says the credential belongs to — never authentication,
     * and never sent to the ERP. The ERP derives the website from the credential alone.
     */
    website: z.object({
      id: z.string().regex(ULID),
      slug: z.string().regex(/^[a-z0-9-]{2,63}$/),
    }),
    domains: z.object({
      /** The host the ERP knows and verifies (`X-Feriwala-Storefront-Host`). */
      primary: host,
      /** Verified aliases; requests to them are redirected to the primary. */
      aliases: z.array(host).max(20).default([]),
      /** Local hosts honoured only when NODE_ENV is not production (e.g. `shop.localhost`). */
      development: z.array(host).max(5).default([]),
    }),
    // No `erp` and no `credential` here (schema v2, P3): the ERP endpoint and the website-scoped
    // credential live only in the installation's server-side .env. `.strict()` refuses them.
    /** Presentation. The ERP's branding (/site) is the default; these are this website's choices. */
    theme: z
      .object({
        preset: z.enum(["classic", "modern", "minimal"]).optional(),
        colors: z.object({ primary: z.string().regex(HEX_COLOR).optional(), secondary: z.string().regex(HEX_COLOR).optional() }).default({}),
      })
      .default({ colors: {} }),
    locale: z
      .object({
        default: z.enum(["en", "bn"]).optional(),
        available: z.array(z.enum(["en", "bn"])).min(1).optional(),
      })
      .default({}),
    features: z
      .object({
        flashDeals: z.boolean().default(true),
        bestSellers: z.boolean().default(true),
        featured: z.boolean().default(true),
        newArrivals: z.boolean().default(true),
        cashOnDelivery: z.boolean().default(true),
        /** Off until online payment is integrated and live mode is separately approved. */
        onlinePayment: z.literal(false).default(false),
      })
      .default({
        flashDeals: true,
        bestSellers: true,
        featured: true,
        newArrivals: true,
        cashOnDelivery: true,
        onlinePayment: false,
      }),
    deployment: z.object({
      environment: z.enum(["development", "staging", "production"]),
    }),
  })
  .strict()
  .superRefine((config, context) => {
    const all = [config.domains.primary, ...config.domains.aliases];
    if (new Set(all).size !== all.length) {
      context.addIssue({ code: "custom", path: ["domains"], message: "hosts must be unique" });
    }
    if (config.deployment.environment === "production" && config.domains.development.length > 0) {
      context.addIssue({ code: "custom", path: ["domains", "development"], message: "development hosts are not allowed in production" });
    }
    if (looksSecret(JSON.stringify(config))) {
      context.addIssue({ code: "custom", path: [], message: "site config must not contain secret values" });
    }
  });

export type SiteConfig = z.infer<typeof siteConfigSchema>;

/**
 * A 64-hex credential secret, a credential key id, a PEM block or a base64 key-sized blob does not
 * belong in public config: credentials live in the installation's .env only.
 */
export function looksSecret(text: string): boolean {
  return (
    /\b[0-9a-f]{64}\b/i.test(text) ||
    /wsk_[0-9A-Z]{26}/.test(text) ||
    /-----BEGIN [A-Z ]+-----/.test(text) ||
    /"[A-Za-z0-9+/]{43}="/.test(text)
  );
}

export function parseSiteConfig(input: unknown): SiteConfig {
  return siteConfigSchema.parse(input);
}
