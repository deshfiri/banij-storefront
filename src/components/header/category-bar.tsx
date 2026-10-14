"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { NavCategory } from "@/server/catalog";

/**
 * Category tabs under the header: "All" plus the website's categories from the ERP, scrolling
 * horizontally on small screens. "All" is current on the homepage and the unfiltered catalogue.
 */
export function CategoryBar({
  lang,
  categories,
  labels,
}: {
  lang: string;
  categories: NavCategory[];
  labels: { all: string; allProducts: string; navigation: string; empty: string };
}) {
  const pathname = usePathname();
  const category = useSearchParams().get("category");
  const allHref = `/${lang}/products`;
  const isActive = (href: string) => {
    const [path, query] = href.split("?");
    if (query) {
      return pathname === path && category === new URLSearchParams(query).get("category");
    }
    if (path === allHref) {
      return (pathname === allHref && !category) || pathname === `/${lang}`;
    }
    return pathname === path;
  };
  const items = [
    { slug: "", name: labels.all, label: labels.allProducts, href: allHref },
    ...categories.map((c) => ({ ...c, label: c.name, href: `/${lang}${c.href}` })),
  ];

  return (
    <nav aria-label={labels.navigation} className="border-t border-line">
      <div className="page-container flex items-center gap-4">
        <ul className="scroll-x -mb-px flex min-w-0 gap-1 text-[0.9375rem] sm:gap-3">
          {items.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className={`inline-flex min-h-12 items-center border-b-[3px] px-2.5 whitespace-nowrap transition-colors ${
                    active ? "border-brand font-semibold text-brand" : "border-transparent font-medium text-muted hover:text-ink"
                  }`}
                >
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
        {categories.length === 0 ? <p className="hidden shrink-0 text-xs text-muted md:block">{labels.empty}</p> : null}
      </div>
    </nav>
  );
}
