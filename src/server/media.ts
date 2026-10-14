import "server-only";
import { type ImageOrigin, parseImageOrigin } from "@/config/image-origin";
import { productImages } from "@/lib/media";
import type { Product } from "@/lib/types";

let cached: { raw: string | undefined; origin: ImageOrigin | null } | null = null;

/** The trusted image origin of this installation (server-side env, never sent to the browser as config). */
export function imageOrigin(): ImageOrigin | null {
  const raw = process.env.STOREFRONT_IMAGE_ORIGIN;
  if (!cached || cached.raw !== raw) {
    cached = { raw, origin: parseImageOrigin(raw) };
  }
  return cached.origin;
}

/**
 * Product images resolved against the trusted origin. ERP media under any other origin is not
 * rendered — and is logged once per product, so a misconfigured ERP URL is visible to operators
 * instead of silently showing placeholders.
 */
const reported = new Set<string>();
export function imagesFor(product: Product) {
  const result = productImages(product, imageOrigin());
  if (result.rejected > 0 && !reported.has(product.id)) {
    reported.add(product.id);
    const sample = product.media.find((item) => item.type === "image")?.url ?? "";
    let origin = "invalid URL";
    try {
      const url = new URL(sample);
      origin = `${url.protocol}//${url.host}`;
    } catch {}
    console.warn(
      JSON.stringify({
        channel: "images",
        event: "untrusted_media_origin",
        product: product.slug,
        rejected: result.rejected,
        mediaOrigin: origin,
        trustedOrigin: process.env.STOREFRONT_IMAGE_ORIGIN || "(not configured)",
      }),
    );
  }
  return result;
}
