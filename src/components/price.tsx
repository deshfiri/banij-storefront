import type { Money } from "@/lib/types";

/**
 * Renders the ERP's own formatted amount. The storefront never parses, rounds or computes money.
 */
export function Price({
  value,
  compareAt,
  className = "",
}: {
  value: Money | null;
  compareAt?: Money | null;
  className?: string;
}) {
  if (!value) {
    return null;
  }
  return (
    <span className={`tabular inline-flex flex-wrap items-baseline gap-x-2 ${className}`}>
      <span className="font-semibold">{value.formatted}</span>
      {compareAt ? (
        <s className="text-sm text-muted" aria-label={`Regular price ${compareAt.formatted}`}>
          {compareAt.formatted}
        </s>
      ) : null}
    </span>
  );
}
