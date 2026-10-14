"use client";

import { useFormStatus } from "react-dom";
import { updateCartLineAction } from "@/app/actions";
import { MinusIcon, PlusIcon } from "@/components/icons";

/**
 * A cart line's quantity: [−] n [+] and Remove. Each button submits the new quantity to the server
 * action (works without JavaScript too); the server clamps it to the line's bounds and the page
 * re-renders with the ERP's fresh quote, so the totals shown are always the ERP's.
 */
export function CartQuantity({
  sku,
  name,
  quantity,
  minQuantity,
  maxQuantity,
  labels,
}: {
  sku: string;
  name: string;
  quantity: number;
  minQuantity: number;
  maxQuantity: number | null;
  labels: { quantity: string; decrease: string; increase: string; remove: string };
}) {
  const max = Math.min(maxQuantity ?? 10000, 10000);
  return (
    <form action={updateCartLineAction} className="flex flex-wrap items-center gap-3 pt-1.5">
      <input type="hidden" name="sku" value={sku} />
      <Controls quantity={quantity} min={minQuantity} max={max} name={name} labels={labels} />
    </form>
  );
}

function Controls({
  quantity,
  min,
  max,
  name,
  labels,
}: {
  quantity: number;
  min: number;
  max: number;
  name: string;
  labels: { quantity: string; decrease: string; increase: string; remove: string };
}) {
  const { pending } = useFormStatus();
  return (
    <>
      <div className="stepper h-10" role="group" aria-label={`${labels.quantity}: ${name}`} aria-busy={pending}>
        <button
          type="submit"
          name="quantity"
          value={quantity - 1}
          disabled={pending || quantity <= min}
          aria-label={`${labels.decrease} — ${name}`}
          className="!w-10"
        >
          <MinusIcon size={16} />
        </button>
        <output className="tabular inline-flex w-11 items-center justify-center border-x border-line font-semibold" aria-live="polite">
          {pending ? "…" : quantity}
        </output>
        <button
          type="submit"
          name="quantity"
          value={quantity + 1}
          disabled={pending || quantity >= max}
          aria-label={`${labels.increase} — ${name}`}
          className="!w-10"
        >
          <PlusIcon size={16} />
        </button>
      </div>
      <button type="submit" name="remove" value="1" disabled={pending} className="min-h-10 px-1 text-sm font-medium text-danger hover:underline">
        {labels.remove}
      </button>
    </>
  );
}
