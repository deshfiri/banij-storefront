"use client";

import { useActionState } from "react";
import { addToCartAction, type CartActionState } from "@/app/actions";
import { CheckIcon, PlusIcon } from "@/components/icons";

/**
 * The compact "+" on a product card: adds one of the product's single purchasable variant. The server
 * action re-reads the product and price from the ERP; nothing here is trusted. The header count
 * refreshes with the action's revalidation.
 */
export function QuickAdd({
  slug,
  sku,
  label,
  addedLabel,
  errorLabel,
}: {
  slug: string;
  sku: string;
  label: string;
  addedLabel: string;
  errorLabel: string;
}) {
  const [state, action, pending] = useActionState<CartActionState, FormData>(addToCartAction, { status: "idle" });
  const added = state.status === "added";
  return (
    <form action={action}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="sku" value={sku} />
      <input type="hidden" name="quantity" value="1" />
      <button
        type="submit"
        disabled={pending}
        aria-label={label}
        title={label}
        className="inline-flex size-10 items-center justify-center rounded-ctl bg-brand text-white shadow-sm transition hover:opacity-90 active:translate-y-px disabled:opacity-60 sm:size-11"
      >
        {added ? <CheckIcon size={20} /> : <PlusIcon size={20} />}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {added ? addedLabel : state.status === "error" ? errorLabel : ""}
      </span>
    </form>
  );
}
