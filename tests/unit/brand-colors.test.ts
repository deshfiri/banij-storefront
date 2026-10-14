import { describe, expect, it } from "vitest";
import { brandColors, contrastWithWhite, readableOnWhite } from "@/lib/format";

/**
 * The storefront's accent and primary-action colours come from the website's two ERP colours, for
 * any website: the more colourful one is the accent, and both stay readable with white text.
 */
describe("brand colours from ERP branding", () => {
  it("uses the colourful colour as the accent, whichever field it was entered in", () => {
    // Karim Traders: primary #111111 (near-black), secondary #f97316 (orange).
    const karim = brandColors("#111111", "#f97316");
    expect(karim.brand).not.toBe("#111111");
    expect(karim.brand2).toBe("#111111");
    // The same pair the other way round gives the same roles.
    expect(brandColors("#f97316", "#111111")).toEqual(karim);
  });

  it("keeps the primary as the accent when both are colourful (or both neutral)", () => {
    expect(brandColors("#15803d", "#1d4ed8").brand).toBe("#15803d");
    expect(brandColors("#222222", "#555555").brand).toBe("#222222");
  });

  it("darkens a light accent only as far as AA needs, keeping its hue", () => {
    const orange = readableOnWhite("#f97316");
    expect(contrastWithWhite("#f97316")).toBeLessThan(4.5);
    expect(contrastWithWhite(orange)).toBeGreaterThanOrEqual(4.5);
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(orange.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    // A colour that already passes is unchanged.
    expect(readableOnWhite("#15803d")).toBe("#15803d");
  });

  it("falls back to the template defaults for missing or invalid colours", () => {
    expect(brandColors(null, undefined)).toEqual({ brand: "#c2410c", brand2: "#1c1917" });
    expect(brandColors("red; background:url(x)", "#12")).toEqual({ brand: "#c2410c", brand2: "#1c1917" });
  });
});
