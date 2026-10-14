"use client";

/* eslint-disable @next/next/no-img-element -- slides come from the installation's own content (https or /public) */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

export type HeroSlide = {
  image: string;
  alt: string;
  headline: string | null;
  subline: string | null;
  cta: { href: string; label: string } | null;
};

/**
 * The homepage slides from site/content.json, as a scroll-snap carousel (APG carousel pattern):
 * swipe or scroll natively, or use the previous / next buttons and the dots. No autoplay — nothing
 * moves unless the visitor moves it — and no animation under prefers-reduced-motion. With one slide
 * there are no controls at all.
 */
export function HeroCarousel({
  slides,
  labels,
}: {
  slides: HeroSlide[];
  labels: { region: string; slide: string; previous: string; next: string; show: string };
}) {
  const track = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  const many = slides.length > 1;

  useEffect(() => {
    const element = track.current;
    if (!element || !many) {
      return;
    }
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(Math.round(element.scrollLeft / Math.max(1, element.clientWidth))));
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("scroll", onScroll);
    };
  }, [many]);

  const goTo = useCallback(
    (index: number) => {
      const element = track.current;
      if (!element) {
        return;
      }
      const target = (index + slides.length) % slides.length;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      element.scrollTo({ left: target * element.clientWidth, behavior: reduce ? "auto" : "smooth" });
      setActive(target);
    },
    [slides.length],
  );

  const fill = (template: string, values: Record<string, number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

  return (
    <section aria-roledescription="carousel" aria-label={labels.region} data-slot="hero" data-hero-carousel>
      <div className="relative">
        <ul ref={track} className="scroll-x flex snap-x snap-mandatory overflow-hidden rounded-card border border-line">
          {slides.map((slide, index) => {
            const image = (
              <img
                src={slide.image}
                alt={slide.alt}
                width={1600}
                height={600}
                loading={index === 0 ? "eager" : "lazy"}
                fetchPriority={index === 0 ? "high" : "auto"}
                className="aspect-[16/9] h-auto w-full object-cover sm:aspect-[8/3]"
              />
            );
            return (
              <li
                key={`${slide.image}-${index}`}
                role="group"
                aria-roledescription="slide"
                aria-label={fill(labels.slide, { n: index + 1, total: slides.length })}
                className="relative w-full shrink-0 snap-start"
              >
                {slide.cta ? (
                  <Link href={slide.cta.href} tabIndex={many && index !== active ? -1 : undefined}>
                    {image}
                  </Link>
                ) : (
                  image
                )}
                {slide.headline ? (
                  <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/55 to-transparent p-5 text-white sm:p-10">
                    <p className="max-w-2xl text-2xl font-bold sm:text-4xl">{slide.headline}</p>
                    {slide.subline ? <p className="mt-2 max-w-xl text-white/90 sm:text-lg">{slide.subline}</p> : null}
                    {slide.cta ? <span className="btn btn-accent mt-4 w-fit">{slide.cta.label}</span> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {many ? (
          <>
            <button
              type="button"
              onClick={() => goTo(active - 1)}
              aria-label={labels.previous}
              className="icon-btn absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-surface/90 shadow-card"
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              onClick={() => goTo(active + 1)}
              aria-label={labels.next}
              className="icon-btn absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-surface/90 shadow-card"
            >
              <ChevronRightIcon />
            </button>
          </>
        ) : null}
      </div>
      {many ? (
        <ol className="mt-3 flex justify-center gap-1">
          {slides.map((slide, index) => (
            <li key={`${slide.image}-dot-${index}`}>
              <button
                type="button"
                onClick={() => goTo(index)}
                aria-label={fill(labels.show, { n: index + 1 })}
                aria-current={index === active ? "true" : undefined}
                className="group inline-flex size-6 items-center justify-center"
              >
                <span
                  className={`block h-2 rounded-full transition-all motion-reduce:transition-none ${
                    index === active ? "w-6 bg-brand" : "w-2 bg-line group-hover:bg-muted"
                  }`}
                />
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
