import { describe, expect, it } from "vitest";
import { compareDecimal, sanitizeProductQuery } from "@/server/catalog";
import { toE164 } from "@/server/checkout";
import { decryptSecret, encryptSecret, hmacHex } from "@/server/crypto";
import { normalizeHost, subdomainOf } from "@/server/host";
import { canonicalRequest, sortedQuery } from "@/server/signing";
import { safeColor, safeImage } from "@/lib/format";

describe("request host validation", () => {
  it("accepts a plain host and strips the port and case", () => {
    expect(normalizeHost("KarimTraders.Feriwala.Shop:443")).toBe("karimtraders.feriwala.shop");
    expect(normalizeHost("shop.example.com.")).toBe("shop.example.com");
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["single label", "localhost"],
    ["userinfo", "a.example.com@evil.com"],
    ["path", "a.example.com/x"],
    ["two values", "a.example.com, b.example.com"],
    ["IPv4", "127.0.0.1"],
    ["IPv6", "[::1]:3000"],
    ["bad label", "-a.example.com"],
    ["underscore", "a_b.example.com"],
    ["whitespace", "a .example.com"],
  ])("refuses a %s host", (_label, host) => {
    expect(normalizeHost(host)).toBeNull();
  });

  it("finds the website subdomain only directly under the root domain", () => {
    expect(subdomainOf("karimtraders.feriwala.shop", "feriwala.shop")).toBe("karimtraders");
    expect(subdomainOf("a.b.feriwala.shop", "feriwala.shop")).toBeNull();
    expect(subdomainOf("feriwala.shop.evil.com", "feriwala.shop")).toBeNull();
  });
});

describe("request signing", () => {
  it("sorts raw query pairs byte-wise without re-encoding and drops empty pairs", () => {
    expect(sortedQuery("")).toBe("");
    expect(sortedQuery("q=tea&limit=24&&cursor=abc")).toBe("?cursor=abc&limit=24&q=tea");
    expect(sortedQuery("q=%E0%A6%9A&a=1")).toBe("?a=1&q=%E0%A6%9A");
  });

  it("builds the canonical request in the contract's order", () => {
    const canonical = canonicalRequest("get", "/api/storefront/v1/products", "sort=name&q=tea", "1760000000", "n", "");
    expect(canonical.split("\n")).toEqual([
      "GET",
      "/api/storefront/v1/products?q=tea&sort=name",
      "1760000000",
      "n",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ]);
  });

  it("matches the ERP's PHP signature for the same request", () => {
    // Golden value from RequestSignature::sign(secret, RequestSignature::canonical(...)) in the ERP.
    const canonical = canonicalRequest(
      "POST",
      "/api/storefront/v1/checkout/quote",
      "",
      "1760000000",
      "3b2b8f2e-1d7a-4c1e-9a7b-2f1e0d9c8b7a",
      '{"items":[{"sku":"BSFTEA001","quantity":2}],"payment_method":"cod"}',
    );
    expect(hmacHex("0".repeat(64), canonical)).toBe("671a7f6020b612ffd5d70d0deedbaae5c013a4c784e207bff8afcc81f7f066a2");
  });
});

describe("registry secret encryption", () => {
  const key = Buffer.alloc(32, 7);

  it("round-trips a secret bound to its website", () => {
    const sealed = encryptSecret("s3cret", key, "website:A");
    expect(sealed).not.toContain("s3cret");
    expect(decryptSecret(sealed, key, "website:A")).toBe("s3cret");
  });

  it("refuses a ciphertext copied onto another website's entry", () => {
    const sealed = encryptSecret("s3cret", key, "website:A");
    expect(() => decryptSecret(sealed, key, "website:B")).toThrow();
  });

  it("refuses a tampered ciphertext", () => {
    const raw = Buffer.from(encryptSecret("s3cret", key, "website:A"), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret(raw.toString("base64"), key, "website:A")).toThrow();
  });
});

describe("customer input", () => {
  it.each([
    ["01712345678", "+8801712345678"],
    ["01712-345678", "+8801712345678"],
    ["+8801712345678", "+8801712345678"],
    ["8801712345678", "+8801712345678"],
  ])("normalises %s to E.164", (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it.each(["0171234567", "02123456789", "+447700900123", "abc"])("refuses %s", (input) => {
    expect(toE164(input)).toBeNull();
  });
});

describe("catalogue query", () => {
  it("compares decimal amounts exactly, without floats", () => {
    expect(compareDecimal("2500", "2500.00")).toBe(0);
    expect(compareDecimal("0.10", "0.09")).toBe(1);
    expect(compareDecimal("999999999999.99", "1000000000000")).toBe(-1);
  });

  it("drops anything the ERP would refuse instead of passing it on", () => {
    expect(
      sanitizeProductQuery({
        sort: "drop table",
        price_min: "1e5",
        price_max: "100.123",
        in_stock: "yes",
        category: "../x",
        q: "  tea  ",
        website_id: "1",
      }),
    ).toEqual({ q: "tea" });
    expect(sanitizeProductQuery({ price_min: "500", price_max: "100" })).toEqual({ price_min: "500" });
  });
});

describe("branding output", () => {
  it("lets only hex colours and http(s) images through", () => {
    expect(safeColor("#AbC", "#000")).toBe("#AbC");
    expect(safeColor("red;background:url(x)", "#000")).toBe("#000");
    expect(safeImage("javascript:alert(1)")).toBeNull();
    expect(safeImage("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
  });
});
