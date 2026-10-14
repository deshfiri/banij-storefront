"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { confirmCodAction, resendCodeAction, type ConfirmationResult } from "@/app/actions";
import { type Dictionary, fill } from "@/lib/i18n";

export function CodConfirmation({
  orderId,
  t,
  deadline,
  resendAvailableIn,
}: {
  orderId: string;
  t: Dictionary;
  deadline: string | null;
  resendAvailableIn: number;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [wait, setWait] = useState(resendAvailableIn);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const explain = (result: ConfirmationResult): string => {
    if (result.kind !== "refused") return t.states.errorText;
    switch (result.code) {
      case "confirmation_refused":
        return t.order.refused;
      case "confirmation_expired":
        return t.order.expired;
      case "confirmation_code_too_soon":
        return t.order.tooSoon;
      case "confirmation_code_limit_reached":
        return t.order.limit;
      default:
        return t.states.errorText;
    }
  };

  return (
    <section className="card space-y-4 p-5 sm:p-7" aria-labelledby="verify-title">
      <h2 id="verify-title" className="text-lg font-bold">
        {t.order.verifyTitle}
      </h2>
      <p className="text-sm text-muted">{t.order.verifyText}</p>
      {deadline ? (
        <p className="text-sm">
          {t.order.deadline}: <strong>{deadline}</strong>
        </p>
      ) : null}
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await confirmCodAction(orderId, code);
            if (result.kind === "ok") {
              setMessage({ tone: "ok", text: t.order.confirmed });
              router.refresh();
            } else {
              setMessage({ tone: "error", text: explain(result) });
            }
          });
        }}
      >
        <label className="flex-1">
          <span className="sr-only">{t.order.code}</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="••••••"
            className="field tabular text-center text-lg tracking-[0.4em]"
            aria-label={t.order.code}
          />
        </label>
        <button className="btn btn-accent" disabled={pending || code.length < 4}>
          {t.order.confirm}
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          className="underline disabled:no-underline disabled:opacity-50"
          disabled={pending || wait > 0}
          onClick={() =>
            startTransition(async () => {
              const result = await resendCodeAction(orderId);
              if (result.kind === "ok") {
                setMessage({ tone: "ok", text: t.order.sent });
                setWait(result.order.confirmation?.resend_available_in ?? 60);
              } else {
                setMessage({ tone: "error", text: explain(result) });
                const retry = result.kind === "refused" ? Number(result.details.retry_after ?? 0) : 0;
                if (retry > 0) setWait(retry);
              }
            })
          }
        >
          {t.order.resend}
        </button>
        {wait > 0 ? <span className="text-muted">{fill(t.order.resendIn, { n: wait })}</span> : null}
      </div>
      {message ? (
        <p role="status" className={`text-sm ${message.tone === "ok" ? "text-success" : "text-danger"}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
