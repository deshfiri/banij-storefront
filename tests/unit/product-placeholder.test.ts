import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductCard } from "@/components/product-card";
import { ProductGallery } from "@/components/product-gallery";
import { dictionary } from "@/lib/i18n";
import type { Product } from "@/lib/types";

/**
 * The image placeholder, against fixed fixtures rather than the dev ERP: whether a real product has
 * an image is data that changes (every Karim Traders product has one now), so the e2e suite cannot
 * be relied on to find one without. Renders the real card and gallery; only Next's Link and Image
 * are reduced to plain elements, since neither runs outside a Next render.
 */
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt, "data-next-image": "" }),
}));

const ORIGIN = "http://127.0.0.1:8000/storage/";

function productImageFixture(media: Product["media"]): Product {
  return {
    id: "01FIXTUREPRODUCT0000000000",
    slug: "fixture-product",
    sku: "FIXTURE-1",
    name: "Fixture Product",
    short_description: null,
    description: null,
    promo_title: null,
    promotion: null,
    brand: null,
    categories: [],
    media,
    variants: [
      {
        id: "01FIXTUREVARIANT0000000000",
        sku: "FIXTURE-1",
        attributes: {},
        price: { amount: "100.00", currency: "BDT", formatted: "৳100.00" },
        compare_at_price: null,
        availability: { in_stock: true, quantity: 10, backorderable: false },
      },
    ],
    min_order_quantity: 1,
    max_order_quantity: null,
    is_featured: false,
    seo: { title: null, description: null, canonical: null },
    published_at: null,
    updated_at: "2026-10-14T00:00:00+06:00",
  };
}

const card = (product: Product, lang: "en" | "bn" = "en") =>
  renderToStaticMarkup(createElement(ProductCard, { product, lang, t: dictionary(lang) }));

describe("image placeholder (fixtures)", () => {
  beforeEach(() => {
    vi.stubEnv("STOREFRONT_IMAGE_ORIGIN", ORIGIN);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("shows the placeholder on a card for a product without media, in both languages", () => {
    const html = card(productImageFixture([]));
    expect(html).toContain("data-image-placeholder");
    expect(html).toContain("Image not available");
    expect(html).not.toContain("<img");

    const bangla = card(productImageFixture([]), "bn");
    expect(bangla).toContain("data-image-placeholder");
    expect(bangla).toContain("ছবি নেই");
  });

  it("shows the placeholder rather than an untrusted or non-image file", () => {
    const html = card(
      productImageFixture([
        { url: "https://evil.example.com/storage/x.webp", alt: null, position: 1, type: "image" },
        { url: `${ORIGIN}catalog/products/P1/v.mp4`, alt: null, position: 2, type: "video" },
      ]),
    );
    expect(html).toContain("data-image-placeholder");
    expect(html).not.toContain("evil.example.com");
    expect(html).not.toContain("<img");
  });

  it("shows the image, not the placeholder, once the product has a trusted one", () => {
    const html = card(productImageFixture([{ url: `${ORIGIN}catalog/products/P1/a.webp`, alt: "Front", position: 1, type: "image" }]));
    expect(html).toContain(`src="${ORIGIN}catalog/products/P1/a.webp"`);
    expect(html).not.toContain("data-image-placeholder");
  });

  it("shows the placeholder as the product page's main image when there are no images", () => {
    const labels = { noImage: dictionary("en").product.noImage, gallery: "Gallery", show: "Show image {n}" };
    const html = renderToStaticMarkup(createElement(ProductGallery, { images: [], labels }));
    expect(html).toMatch(/data-gallery-main[^>]*>[\s\S]*data-image-placeholder/);
    expect(html).toContain("Image not available");
    expect(html).not.toContain("<ul");
  });
});
