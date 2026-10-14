import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HeroCarousel, type HeroSlide } from "@/components/hero-carousel";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

const LABELS = { region: "Promotions", slide: "Slide {n} of {total}", previous: "Previous slide", next: "Next slide", show: "Show slide {n}" };
const heroSlideFixture = (n: number): HeroSlide => ({
  image: `/hero/${n}.webp`,
  alt: `Slide image ${n}`,
  headline: null,
  subline: null,
  cta: null,
});
const render = (slides: HeroSlide[]) => renderToStaticMarkup(createElement(HeroCarousel, { slides, labels: LABELS }));

describe("hero carousel", () => {
  it("labels the carousel and every slide (APG carousel pattern)", () => {
    const html = render([heroSlideFixture(1), heroSlideFixture(2), heroSlideFixture(3)]);
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('aria-label="Promotions"');
    expect(html).toContain('aria-label="Slide 1 of 3"');
    expect(html).toContain('aria-label="Slide 3 of 3"');
    expect(html.match(/aria-roledescription="slide"/g)).toHaveLength(3);
  });

  it("gives several slides previous / next buttons and one dot per slide, the first current", () => {
    const html = render([heroSlideFixture(1), heroSlideFixture(2), heroSlideFixture(3)]);
    expect(html).toContain('aria-label="Previous slide"');
    expect(html).toContain('aria-label="Next slide"');
    expect(html.match(/aria-label="Show slide \d"/g)).toHaveLength(3);
    expect(html).toMatch(/aria-label="Show slide 1" aria-current="true"/);
    expect(html).not.toMatch(/aria-label="Show slide 2" aria-current/);
  });

  it("has no controls for a single slide, and only the first image loads eagerly", () => {
    const one = render([heroSlideFixture(1)]);
    expect(one).not.toContain("Previous slide");
    expect(one).not.toContain("Show slide");
    const many = render([heroSlideFixture(1), heroSlideFixture(2)]);
    expect(many.match(/loading="eager"/g)).toHaveLength(1);
    expect(many.match(/loading="lazy"/g)).toHaveLength(1);
  });
});
