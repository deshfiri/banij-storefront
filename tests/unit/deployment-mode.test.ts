import { afterEach, describe, expect, it, vi } from "vitest";
import { assertDeploymentMode, storefrontMode } from "@/server/site-config";
import { isProvisioningRequest, provisioningConfig } from "@/server/provisioning";

/** P3: one independent installation per website is the production default; shared is legacy dev only. */
describe("deployment mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [undefined, "development", "single"],
    [undefined, "production", "single"],
    ["single", "production", "single"],
    ["shared", "development", "shared"],
    ["shared", "test", "shared"],
    ["shared", "production", "single"],
    ["anything-else", "development", "single"],
  ])("STOREFRONT_MODE=%s with NODE_ENV=%s → %s", (mode, nodeEnv, expected) => {
    vi.stubEnv("STOREFRONT_MODE", mode);
    vi.stubEnv("NODE_ENV", nodeEnv);
    expect(storefrontMode()).toBe(expected);
  });

  it("refuses to boot production in shared mode, and allows everything else", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STOREFRONT_MODE", "shared");
    expect(() => assertDeploymentMode()).toThrow(/refused in production/);
    vi.stubEnv("STOREFRONT_MODE", undefined);
    expect(() => assertDeploymentMode()).not.toThrow();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("STOREFRONT_MODE", "shared");
    expect(() => assertDeploymentMode()).not.toThrow();
  });

  it("never exposes provisioning in single mode, even when fully configured", () => {
    vi.stubEnv("STOREFRONT_PROVISIONING_HOST", "registry.internal.example");
    vi.stubEnv("STOREFRONT_PROVISIONING_KEY_ID", "sfp_test");
    vi.stubEnv("STOREFRONT_PROVISIONING_SECRET", Buffer.alloc(32, 1).toString("base64"));
    vi.stubEnv("STOREFRONT_PROVISIONING_PRIVATE_KEY", "unused-in-this-test");
    vi.stubEnv("NODE_ENV", "development");

    vi.stubEnv("STOREFRONT_MODE", undefined);
    expect(provisioningConfig()).toBeNull();
    expect(isProvisioningRequest("registry.internal.example", "/api/internal/registry")).toBe(false);

    vi.stubEnv("STOREFRONT_MODE", "shared");
    expect(provisioningConfig()).not.toBeNull();

    vi.stubEnv("NODE_ENV", "production");
    expect(provisioningConfig()).toBeNull();
  });
});
