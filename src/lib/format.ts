import type { Site } from "./types";

/** Only a #rgb / #rrggbb colour reaches a style attribute; anything else falls back to the default. */
export function safeColor(value: string | null | undefined, fallback: string): string {
  return value && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : fallback;
}

function rgb(hex: string): [number, number, number] {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  return [1, 3, 5].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio of a colour against white. */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

/** How colourful a colour is (0 for greys, up to 1). */
function chroma(hex: string): number {
  const channels = rgb(hex);
  return (Math.max(...channels) - Math.min(...channels)) / 255;
}

/**
 * The same hue, darkened only as far as needed for white text on it — and it as text on white — to
 * reach WCAG AA (4.5:1). A colour that already passes is returned unchanged.
 */
export function readableOnWhite(hex: string): string {
  let current = rgb(hex);
  for (let step = 0; step < 40 && contrastWithWhite(toHex(current)) < 4.5; step++) {
    current = current.map((c) => c * 0.95) as [number, number, number];
  }
  return toHex(current);
}

/**
 * The storefront's two brand roles from the website's two ERP colours, for any website:
 *   brand   — the accent (active tab, search button, quick-add, links): the primary colour, unless
 *             the primary is a neutral (black, grey) and the secondary is a real colour;
 *   brand2  — primary actions and strong ink: the other one.
 * Both are made readable with white text. So a website with one strong colour and one neutral gets
 * the strong colour as its accent whichever field it was entered in.
 */
export function brandColors(primary: string | null | undefined, secondary: string | null | undefined): { brand: string; brand2: string } {
  const first = safeColor(primary, "#c2410c");
  const second = safeColor(secondary, "#1c1917");
  const NEUTRAL = 0.2;
  const [accent, ink] = chroma(first) < NEUTRAL && chroma(second) >= NEUTRAL ? [second, first] : [first, second];
  return { brand: readableOnWhite(accent), brand2: readableOnWhite(ink) };
}

/**
 * The website's own theme. `previewTheme` exists only for visual review in development; the layout
 * never passes it when NODE_ENV is production.
 */
export function themeOf(site: Site, previewTheme?: string | null): "classic" | "modern" | "minimal" {
  switch (previewTheme ?? site.branding.theme) {
    case "modern":
      return "modern";
    case "minimal":
      return "minimal";
    default:
      return "classic";
  }
}

/** Only http(s) image URLs are rendered. */
export function safeImage(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export function formatDate(iso: string | null, locale: string): string {
  if (!iso) {
    return "";
  }
  return new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date(iso));
}
