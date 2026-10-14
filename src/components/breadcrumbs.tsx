import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";

/** Breadcrumb trail; the last item is the current page. */
export function Breadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="hover:text-brand hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={`truncate ${last ? "font-medium text-ink" : ""}`}>
                  {item.label}
                </span>
              )}
              {last ? null : <ChevronRightIcon size={14} className="shrink-0 opacity-60" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
