import Link from "next/link";
import type { ReactNode } from "react";
import { CloseIcon } from "@/components/icons";

/**
 * One look for empty, error and not-found states: an icon badge, a heading, a line of help and one
 * clear next step. Server-safe (no hooks), so client error boundaries can use it too.
 */
export function EmptyState({
  title,
  text,
  icon,
  action,
  tone = "neutral",
  role,
  headingLevel = 2,
  children,
}: {
  title: string;
  text?: string;
  icon?: ReactNode;
  action?: { href: string; label: string } | { onClick: () => void; label: string };
  tone?: "neutral" | "error";
  role?: "alert" | "status";
  headingLevel?: 1 | 2;
  children?: ReactNode;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div role={role} className="card mx-auto flex max-w-lg flex-col items-center px-6 py-12 text-center sm:px-10">
      <span className={`icon-badge mb-4 size-14 ${tone === "error" ? "bg-danger/10 text-danger" : ""}`}>{icon ?? <CloseIcon size={26} />}</span>
      <Heading className="text-xl font-bold">{title}</Heading>
      {text ? <p className="mt-2 text-muted">{text}</p> : null}
      {children}
      {action ? (
        "href" in action ? (
          <Link href={action.href} className="btn btn-accent mt-6">
            {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className="btn btn-accent mt-6">
            {action.label}
          </button>
        )
      ) : null}
    </div>
  );
}
