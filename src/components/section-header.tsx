import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";

/** A section heading with the accent bar, and an optional "See all" link on the right. */
export function SectionHeader({ title, href, linkLabel, id }: { title: string; href?: string; linkLabel?: string; id?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4 sm:mb-5">
      <h2 id={id} className="section-title">
        {title}
      </h2>
      {href && linkLabel ? (
        <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-[0.9375rem] font-medium text-brand hover:underline">
          {linkLabel}
          <ChevronRightIcon size={18} />
        </Link>
      ) : null}
    </div>
  );
}
