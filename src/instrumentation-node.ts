/**
 * Boot-time validation (Node.js runtime only; loaded by src/instrumentation.ts). A misconfigured
 * installation fails to start instead of failing on its first customer. Errors name the variable or
 * field at fault, never a value.
 *
 * Next.js only LOGS an error thrown from `register()` and keeps serving, so a failed check exits the
 * process explicitly: a supervisor (compose `restart`, systemd) then shows a stopped service with the
 * reason in its log, instead of a "healthy" server that answers every page with 503.
 */
import { assertDeploymentMode, assertImageOrigin, assertInstallationEnv, assertPreviewMode, siteConfig, storefrontMode } from "@/server/site-config";
import { siteContent } from "@/server/site-content";

try {
  assertDeploymentMode();
  if (storefrontMode() === "single") {
    siteConfig(); // public config: schema v2, no credentials, no secrets
    assertInstallationEnv(); // BANIJ_ERP_BASE_URL, BANIJ_CREDENTIAL_KEY_ID, BANIJ_CREDENTIAL_SECRET
  }
  siteContent(); // public content.json: schema, no secrets
  assertPreviewMode(); // STOREFRONT_PREVIEW only on a single, non-production-configured site
  assertImageOrigin(); // one exact image origin; a local one only off production
} catch (error) {
  console.error(`[storefront] refusing to start: ${error instanceof Error ? error.message : "invalid configuration"}`);
  process.exit(1);
}
