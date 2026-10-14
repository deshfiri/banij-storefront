import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocalHostname, isTrustedImageUrl, parseImageOrigin } from "@/config/image-origin";
import { productImages } from "@/lib/media";

const ORIGIN = parseImageOrigin("http://127.0.0.1:8000/storage/");
const url = (path: string, host = "http://127.0.0.1:8000") => `${host}/storage/catalog/products/P1/${path}`;
const media = (items: { url: string; position: number; type?: string; alt?: string | null }[]) =>
  items.map((m) => ({ type: "image", alt: null, ...m }));

describe("trusted image origin", () => {
  it("parses one exact origin with a path prefix", () => {
    expect(ORIGIN).toEqual({ protocol: "http", hostname: "127.0.0.1", port: "8000", pathPrefix: "/storage/", isLocal: true });
    expect(parseImageOrigin("https://media.example.com/catalog")).toMatchObject({ protocol: "https", port: "", pathPrefix: "/catalog/", isLocal: false });
    expect(parseImageOrigin(undefined)).toBeNull();
    expect(parseImageOrigin("")).toBeNull();
  });

  it.each([
    ["credentials", "http://user:pw@127.0.0.1:8000/storage/"],
    ["a query", "http://127.0.0.1:8000/storage/?x=1"],
    ["a wildcard", "https://*.example.com/"],
    ["plain http to a public host", "http://media.example.com/storage/"],
    ["another scheme", "ftp://127.0.0.1/storage/"],
    ["garbage", "not a url"],
  ])("refuses %s", (_label, value) => {
    expect(() => parseImageOrigin(value)).toThrow();
  });

  it("accepts only URLs under the exact scheme, host, port and path prefix", () => {
    expect(isTrustedImageUrl(url("a.webp"), ORIGIN)).toBe(true);
    expect(isTrustedImageUrl(url("a.webp", "http://localhost"), ORIGIN)).toBe(false); // what the ERP emits today
    expect(isTrustedImageUrl(url("a.webp", "http://localhost:8000"), ORIGIN)).toBe(false); // different hostname
    expect(isTrustedImageUrl(url("a.webp", "http://127.0.0.1:8001"), ORIGIN)).toBe(false);
    expect(isTrustedImageUrl(url("a.webp", "https://127.0.0.1:8000"), ORIGIN)).toBe(false);
    expect(isTrustedImageUrl("http://127.0.0.1:8000/private/a.webp", ORIGIN)).toBe(false);
    expect(isTrustedImageUrl("http://127.0.0.1:8000/storage/../.env", ORIGIN)).toBe(false);
    expect(isTrustedImageUrl(url("a.webp"), null)).toBe(false);
  });

  it("recognises local development addresses", () => {
    for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.5", "172.20.1.1", "shop.localhost", "[::1]"]) {
      expect(isLocalHostname(host), host).toBe(true);
    }
    for (const host of ["media.example.com", "172.32.0.1", "8.8.8.8"]) {
      expect(isLocalHostname(host), host).toBe(false);
    }
  });
});

describe("product images from ERP media[]", () => {
  const product = (items: ReturnType<typeof media>) => ({ name: "Checked Cotton Lungi", media: items });

  it("uses position 1 as the primary image and the rest, in order, as the gallery", () => {
    const result = productImages(
      product(media([{ url: url("c.webp"), position: 3 }, { url: url("a.webp"), position: 1, alt: "Front" }, { url: url("b.webp"), position: 2 }])),
      ORIGIN,
    );
    expect(result.primary).toEqual({ url: url("a.webp"), alt: "Front", position: 1 });
    expect(result.gallery.map((g) => g.url)).toEqual([url("b.webp"), url("c.webp")]);
  });

  it("falls back to the lowest position when no image is at position 1, and to the product name for alt", () => {
    const result = productImages(product(media([{ url: url("b.webp"), position: 4 }, { url: url("a.webp"), position: 2 }])), ORIGIN);
    expect(result.primary).toEqual({ url: url("a.webp"), alt: "Checked Cotton Lungi", position: 2 });
  });

  it("never substitutes: untrusted origins and non-image media are dropped and counted", () => {
    const result = productImages(
      product(
        media([
          { url: url("a.webp", "http://localhost"), position: 1 },
          { url: url("v.mp4"), position: 2, type: "video" },
          { url: "https://evil.example.com/storage/x.webp", position: 3 },
        ]),
      ),
      ORIGIN,
    );
    expect(result).toEqual({ primary: null, gallery: [], rejected: 2 });
  });

  it("has no image without any media, or without a configured origin", () => {
    expect(productImages(product([]), ORIGIN).primary).toBeNull();
    expect(productImages(product(media([{ url: url("a.webp"), position: 1 }])), null).primary).toBeNull();
  });
});

describe("image origin boot rule", () => {
  const template = JSON.parse(readFileSync("site/site.config.json", "utf8"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@site/site.config.json");
  });

  it("allows a local origin on a development or staging site", async () => {
    vi.stubEnv("STOREFRONT_IMAGE_ORIGIN", "http://127.0.0.1:8000/storage/");
    vi.resetModules();
    const { assertImageOrigin } = await import("@/server/site-config");
    expect(() => assertImageOrigin()).not.toThrow();
  });

  it("refuses a local origin on a production-configured site, and an invalid origin anywhere", async () => {
    vi.stubEnv("STOREFRONT_IMAGE_ORIGIN", "http://127.0.0.1:8000/storage/");
    vi.resetModules();
    vi.doMock("@site/site.config.json", () => ({
      default: { ...template, domains: { ...template.domains, development: [] }, deployment: { environment: "production" } },
    }));
    const { assertImageOrigin } = await import("@/server/site-config");
    expect(() => assertImageOrigin()).toThrow(/production/);
    vi.stubEnv("STOREFRONT_IMAGE_ORIGIN", "http://user:pw@127.0.0.1/");
    expect(() => assertImageOrigin()).toThrow();
  });

  it("refuses a runtime origin that differs from the one the build allows", async () => {
    vi.stubEnv("STOREFRONT_BUILD_IMAGE_ORIGIN", "https://media.example.com/storage/");
    vi.stubEnv("STOREFRONT_IMAGE_ORIGIN", "https://media.example.com/storage");
    vi.resetModules();
    const { assertImageOrigin } = await import("@/server/site-config");
    // The same origin, written with or without the trailing slash, is the same origin.
    expect(() => assertImageOrigin()).not.toThrow();
    vi.stubEnv("STOREFRONT_IMAGE_ORIGIN", "https://other.example.com/storage/");
    expect(() => assertImageOrigin()).toThrow(/differs from the image origin this build allows/);
    vi.stubEnv("STOREFRONT_IMAGE_ORIGIN", "");
    expect(() => assertImageOrigin()).toThrow(/differs/);
    // A build without an origin refuses a runtime one it cannot serve.
    vi.stubEnv("STOREFRONT_BUILD_IMAGE_ORIGIN", "");
    vi.stubEnv("STOREFRONT_IMAGE_ORIGIN", "https://media.example.com/storage/");
    expect(() => assertImageOrigin()).toThrow(/differs/);
  });
});
