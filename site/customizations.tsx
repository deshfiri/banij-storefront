import type { ReactNode } from "react";

/**
 * Website customization layer — component slots.
 *
 * The template renders its default for every slot left undefined. A website overrides a slot by
 * exporting a component here; it never edits the template's core, SDK, cart or checkout.
 * Slots receive display data only — no credential, no ERP client.
 */
export type HeroSlotProps = { name: string; tagline: string | null; shopHref: string; shopLabel: string };
export type FooterSlotProps = { name: string; lang: string };

export const customizations: {
  Hero?: (props: HeroSlotProps) => ReactNode;
  FooterNote?: (props: FooterSlotProps) => ReactNode;
  /** Order of homepage sections; omit to use the template's order. */
  homeSections?: ("flashDeals" | "bestSellers" | "featured" | "newArrivals")[];
} = {};
