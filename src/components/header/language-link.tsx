"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** Switches language and stays on the same page (and query). */
export function LanguageLink({ to, label, className }: { to: string; label: string; className?: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const rest = pathname.replace(/^\/(en|bn)(?=\/|$)/, "");
  const href = `/${to}${rest}${search ? `?${search}` : ""}`;
  return (
    <Link href={href} hrefLang={to} lang={to} className={className}>
      {label}
    </Link>
  );
}
