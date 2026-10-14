import { type ImageOrigin, isTrustedImageUrl } from "@/config/image-origin";
import type { Product } from "./types";

/** One displayable product image. */
export type ProductImageData = { url: string; alt: string; position: number };

/**
 * The images a product can actually show, from the ERP's `media[]`:
 *  - only `type: "image"` items whose URL lies under the one trusted image origin;
 *  - the item at **position 1** is the primary image (else the lowest position);
 *  - the rest, in position order, form the gallery.
 * Nothing is substituted: a product without a trusted image gets `primary: null` (placeholder).
 */
export function productImages(product: Pick<Product, "name" | "media">, origin: ImageOrigin | null): {
  primary: ProductImageData | null;
  gallery: ProductImageData[];
  rejected: number;
} {
  const all = (product.media ?? []).filter((item) => item.type === "image" && typeof item.url === "string");
  const trusted = all
    .filter((item) => isTrustedImageUrl(item.url, origin))
    .map((item) => ({ url: item.url, alt: item.alt?.trim() || product.name, position: Number(item.position) || 0 }))
    .sort((a, b) => a.position - b.position);
  const primary = trusted.find((item) => item.position === 1) ?? trusted[0] ?? null;
  return { primary, gallery: trusted.filter((item) => item !== primary), rejected: all.length - trusted.length };
}
