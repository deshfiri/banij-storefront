"use client";

import { useState } from "react";
import type { ProductImageData } from "@/lib/media";
import { ProductImage } from "./product-image";

/**
 * Product page gallery: the primary image (ERP position 1) large, the remaining images as
 * thumbnails. Thumbnails are buttons; the selected one is marked with aria-pressed.
 */
export function ProductGallery({
  images,
  labels,
}: {
  images: ProductImageData[];
  labels: { noImage: string; gallery: string; show: string };
}) {
  const [index, setIndex] = useState(0);
  const current = images[index] ?? null;

  return (
    <div className="space-y-3">
      <div className="card relative aspect-square overflow-hidden bg-surface" data-gallery-main>
        <ProductImage
          key={current?.url ?? "none"}
          image={current}
          sizes="(min-width: 768px) 50vw, 100vw"
          placeholderLabel={labels.noImage}
          preload
        />
      </div>
      {images.length > 1 ? (
        <ul className="grid grid-cols-5 gap-2" aria-label={labels.gallery}>
          {images.map((image, i) => (
            <li key={image.url}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-pressed={i === index}
                aria-label={labels.show.replace("{n}", String(i + 1))}
                className={`relative block aspect-square w-full overflow-hidden rounded-ctl border bg-surface ${
                  i === index ? "border-ink ring-2 ring-ink/20" : "border-line hover:border-muted"
                }`}
              >
                <ProductImage image={image} sizes="96px" placeholderLabel={labels.noImage} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
