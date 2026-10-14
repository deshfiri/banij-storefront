"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * A product image served through Next.js's optimizer (WebP), or a neutral placeholder when the
 * product has no trusted image. A failed load also shows the placeholder — and is reported in the
 * console with the image URL, so a broken ERP media URL is visible, not silently hidden.
 */
export function ProductImage({
  image,
  sizes,
  placeholderLabel,
  preload = false,
  className = "",
}: {
  image: { url: string; alt: string } | null;
  sizes: string;
  placeholderLabel: string;
  preload?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!image || failed) {
    return <ImagePlaceholder label={placeholderLabel} />;
  }
  return (
    <Image
      src={image.url}
      alt={image.alt}
      fill
      sizes={sizes}
      preload={preload}
      className={`object-contain ${className}`}
      onError={() => {
        console.error(`[storefront] product image failed to load: ${image.url}`);
        setFailed(true);
      }}
    />
  );
}

export function ImagePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-2 text-muted" data-image-placeholder>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <circle cx="9" cy="10" r="1.8" />
        <path d="m4 18 5-5 3.5 3.5L15 14l5 5" />
      </svg>
      <span className="text-xs">{label}</span>
    </div>
  );
}
