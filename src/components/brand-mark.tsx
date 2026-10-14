/* eslint-disable @next/next/no-img-element -- logos come from the ERP's media host */
import { safeImage } from "@/lib/format";
import type { Site } from "@/lib/types";

/** Up to two initials from the shop's own name ("Karim Traders Shop" → "KT"). */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? [words[0], words[1]] : [words[0] ?? "?"])
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();
}

/**
 * The website's identity: its ERP logo when one is set, otherwise a monogram in the website's own
 * accent colour next to its name. Never another brand's artwork.
 */
export function BrandMark({ site, size = "md", showName = true }: { site: Site; size?: "md" | "lg"; showName?: boolean }) {
  const logo = safeImage(site.branding.logo_url);
  const box = size === "lg" ? "size-11 text-base" : "size-9 text-[0.8125rem] sm:size-10 sm:text-sm";
  return (
    <span className="flex min-w-0 items-center gap-2 sm:gap-2.5">
      {logo ? (
        <img
          src={logo}
          alt=""
          className={`${size === "lg" ? "h-11 max-w-[10rem]" : "h-9 max-w-[7.5rem] sm:h-10 sm:max-w-[10rem]"} w-auto object-contain`}
        />
      ) : (
        <span
          aria-hidden="true"
          className={`${box} inline-flex shrink-0 items-center justify-center rounded-ctl bg-brand font-bold tracking-tight text-white`}
        >
          {monogram(site.name)}
        </span>
      )}
      {showName ? (
        <span
          data-brand-name
          className={`font-bold tracking-tight ${
            size === "lg" ? "truncate text-xl" : "line-clamp-2 text-[0.9375rem] leading-tight sm:line-clamp-1 sm:text-lg"
          } ${logo ? "sr-only sm:not-sr-only" : ""}`}
        >
          {site.name}
        </span>
      ) : null}
    </span>
  );
}
