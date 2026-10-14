import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contentSchema, localized, parseSiteContent } from "@/config/content-schema";

const template = JSON.parse(readFileSync("site/content.json", "utf8"));

describe("site content (site/content.json)", () => {
  it("accepts the template's own content: no slides, no claims, no links", () => {
    expect(parseSiteContent(template)).toEqual({ schemaVersion: 1, hero: { slides: [] }, trust: [], social: [], helpLinks: [] });
  });

  it("accepts a full, valid installation content", () => {
    const content = parseSiteContent({
      schemaVersion: 1,
      hero: {
        slides: [
          {
            image: "/hero/eid.webp",
            alt: { en: "Eid collection", bn: "ঈদ কালেকশন" },
            headline: { en: "Eid collection" },
            cta: { label: { en: "Shop now" }, href: "/products?category=mens-clothing" },
          },
        ],
      },
      trust: [{ icon: "cash", title: { en: "Cash on delivery", bn: "ক্যাশ অন ডেলিভারি" } }],
      social: [{ network: "facebook", url: "https://facebook.com/karimtraders" }],
      helpLinks: [{ label: { en: "Contact" }, href: "/contact" }],
    });
    expect(content.hero.slides).toHaveLength(1);
  });

  it.each([
    ["an http link", { social: [{ network: "facebook", url: "http://facebook.com/x" }] }],
    ["an unknown network", { social: [{ network: "myspace", url: "https://myspace.com/x" }] }],
    ["a javascript: link", { helpLinks: [{ label: { en: "x" }, href: "javascript:alert(1)" }] }],
    ["a protocol-relative internal path", { helpLinks: [{ label: { en: "x" }, href: "//evil.example" }] }],
    ["more than four trust cards", { trust: Array.from({ length: 5 }, () => ({ icon: "cash", title: { en: "x" } })) }],
    ["an unknown key", { banner: "x" }],
    ["a secret-looking value", { helpLinks: [{ label: { en: "a".repeat(64).replace(/a/g, "f") }, href: "/x" }] }],
    ["a credential key id", { helpLinks: [{ label: { en: "wsk_01M4SZJK0000000000000000AA" }, href: "/x" }] }],
    ["an off-site hero image over http", { hero: { slides: [{ image: "http://cdn.example.com/a.jpg", alt: { en: "x" } }] } }],
  ])("refuses %s", (_label, patch) => {
    expect(contentSchema.safeParse({ ...template, ...patch }).success).toBe(false);
  });

  it("localizes with an English fallback", () => {
    expect(localized({ en: "Contact", bn: "যোগাযোগ" }, "bn")).toBe("যোগাযোগ");
    expect(localized({ en: "Contact" }, "bn")).toBe("Contact");
    expect(localized(undefined, "en")).toBe("");
  });
});
