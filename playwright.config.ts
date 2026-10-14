import { defineConfig } from "@playwright/test";

/**
 * End-to-end against the running dev storefront and the dev ERP (see README). Not part of `npm test`:
 * it places real orders in the ERP development database.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://karimtraders.localhost:3000",
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
