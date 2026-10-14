"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { placeOrderAction, quoteAction, type PlaceActionResult, type QuoteActionResult } from "@/app/actions";
import type { Dictionary } from "@/lib/i18n";
import type { DeliveryArea, Money, Quote } from "@/lib/types";

type Line = { sku: string; name: string; variantLabel: string | null; quantity: number };

const FIELDS = ["name", "phone", "email", "line1", "line2", "city", "postcode", "note"] as const;

async function fetchAreas(parent: string | null): Promise<DeliveryArea[]> {
  const response = await fetch(`/api/areas${parent ? `?parent=${encodeURIComponent(parent)}` : ""}`);
  if (!response.ok) {
    return [];
  }
  return ((await response.json()) as { data: DeliveryArea[] }).data;
}

export function CheckoutForm({
  lang,
  t,
  lines,
  codEnabled,
  codLimitText,
}: {
  lang: string;
  t: Dictionary;
  lines: Line[];
  codEnabled: boolean;
  codLimitText: string | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [divisions, setDivisions] = useState<DeliveryArea[]>([]);
  const [districts, setDistricts] = useState<DeliveryArea[]>([]);
  const [upazilas, setUpazilas] = useState<DeliveryArea[]>([]);
  const [division, setDivision] = useState("");
  const [district, setDistrict] = useState("");
  const [upazila, setUpazila] = useState("");
  const [quote, setQuote] = useState<{ id: string; quote: Quote } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: "error" | "warning"; text: string } | null>(null);
  const [revised, setRevised] = useState<Money | null>(null);
  const [pending, startTransition] = useTransition();
  const lang2 = lang === "bn" ? "bn" : "en";

  useEffect(() => {
    fetchAreas(null).then(setDivisions);
  }, []);

  const areaId = upazila || district || division;
  const districtName = districts.find((d) => d.id === district)?.name.en ?? "";

  const input = (): Record<string, string> => ({
    ...Object.fromEntries(FIELDS.map((field) => [field, values[field] ?? ""])),
    district: districtName,
    areaId,
    paymentMethod: "cod",
  });

  const set = (field: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  // Anything that changes the price — the area — needs a fresh quote before the order can be placed.
  const resetQuote = () => {
    setQuote(null);
    setRevised(null);
  };

  const handleQuote = (result: QuoteActionResult) => {
    setErrors({});
    if (result.kind === "ok") {
      setQuote({ id: result.quoteId, quote: result.quote });
      setNotice(
        result.quote.items.some((line) => !line.availability.reservable)
          ? { tone: "warning", text: t.checkout.stockChanged }
          : null,
      );
    } else if (result.kind === "placed") {
      router.push(`/${lang}/orders/${result.orderId}`);
    } else if (result.kind === "invalid") {
      setErrors(result.fields);
    } else if (result.kind === "empty") {
      router.push(`/${lang}/cart`);
    } else if (result.kind === "refused") {
      setNotice({ tone: "error", text: refusalText(result.code) });
    } else {
      setNotice({ tone: "error", text: t.states.errorText });
    }
  };

  const refusalText = (code: string): string => {
    switch (code) {
      case "insufficient_stock":
      case "product_unavailable":
      case "quantity_not_allowed":
        return t.checkout.stockChanged;
      case "website_not_accepting_orders":
        return t.checkout.notAccepting;
      case "cod_limit_exceeded":
        return t.checkout.codIneligible;
      case "invalid_mobile_number":
        return `${t.checkout.phone}: ✕`;
      default:
        return t.checkout.error;
    }
  };

  const requestQuote = () => startTransition(async () => handleQuote(await quoteAction(input())));

  const place = () =>
    startTransition(async () => {
      if (!quote) {
        return;
      }
      const result: PlaceActionResult | undefined = await placeOrderAction(lang, input(), quote.id);
      if (!result) {
        return; // redirected to the order page
      }
      if (result.kind === "price-changed") {
        // Never accept a new price on the customer's behalf: show it and require a new confirmation.
        setQuote(null);
        setRevised(result.authoritative.grand_total);
        setNotice({ tone: "warning", text: t.checkout.priceChanged });
      } else if (result.kind === "stale-quote") {
        setQuote(null);
        setNotice({ tone: "warning", text: t.checkout.priceChanged });
      } else if (result.kind === "invalid") {
        setErrors(result.fields);
      } else if (result.kind === "refused") {
        setQuote(null);
        setNotice({ tone: "error", text: refusalText(result.code) });
      } else {
        // busy / retry: the same request is safe to send again — it cannot create a second order.
        setNotice({ tone: "error", text: t.checkout.error });
      }
    });

  const field = (name: (typeof FIELDS)[number], label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        name={name}
        value={values[name] ?? ""}
        onChange={set(name)}
        aria-invalid={Boolean(errors[name])}
        className={`field ${errors[name] ? "border-danger" : ""}`}
        {...props}
      />
      {errors[name] ? <span className="text-xs text-danger">✕ {label}</span> : null}
    </label>
  );

  const q = quote?.quote;
  const codEligible = q ? q.payment.cod.enabled && q.payment.cod.eligible : true;

  return (
    <form
      className="grid gap-6 lg:grid-cols-[1fr_24rem]"
      onSubmit={(event) => {
        event.preventDefault();
        if (quote) {
          place();
        } else {
          requestQuote();
        }
      }}
      noValidate
    >
      <div className="space-y-6">
        <fieldset className="card space-y-4 p-5 sm:p-6">
          <legend className="px-1 text-lg font-bold">{t.checkout.contact}</legend>
          {field("name", t.checkout.name, { autoComplete: "name", required: true, maxLength: 160 })}
          {field("phone", t.checkout.phone, { autoComplete: "tel", inputMode: "tel", required: true, placeholder: "01XXXXXXXXX", maxLength: 32 })}
          {field("email", t.checkout.email, { type: "email", autoComplete: "email", maxLength: 254 })}
        </fieldset>

        <fieldset className="card space-y-4 p-5 sm:p-6">
          <legend className="px-1 text-lg font-bold">{t.checkout.address}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t.checkout.division}</span>
              <select
                className="field"
                value={division}
                onChange={(event) => {
                  setDivision(event.target.value);
                  setDistrict("");
                  setUpazila("");
                  setDistricts([]);
                  setUpazilas([]);
                  resetQuote();
                  if (event.target.value) fetchAreas(event.target.value).then(setDistricts);
                }}
              >
                <option value="">{t.checkout.select}</option>
                {divisions.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name[lang2] || area.name.en}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t.checkout.district}</span>
              <select
                className="field"
                value={district}
                disabled={districts.length === 0}
                onChange={(event) => {
                  setDistrict(event.target.value);
                  setUpazila("");
                  setUpazilas([]);
                  resetQuote();
                  const chosen = districts.find((d) => d.id === event.target.value);
                  if (chosen?.has_children) fetchAreas(chosen.id).then(setUpazilas);
                }}
              >
                <option value="">{t.checkout.select}</option>
                {districts.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name[lang2] || area.name.en}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t.checkout.upazila}</span>
              <select
                className="field"
                value={upazila}
                disabled={upazilas.length === 0}
                onChange={(event) => {
                  setUpazila(event.target.value);
                  resetQuote();
                }}
              >
                <option value="">{t.checkout.select}</option>
                {upazilas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name[lang2] || area.name.en}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {field("line1", t.checkout.line1, { autoComplete: "address-line1", required: true, maxLength: 255 })}
          {field("line2", t.checkout.line2, { autoComplete: "address-line2", maxLength: 255 })}
          <div className="grid gap-3 sm:grid-cols-2">
            {field("city", t.checkout.city, { autoComplete: "address-level2", required: true, maxLength: 120 })}
            {field("postcode", t.checkout.postcode, { autoComplete: "postal-code", maxLength: 20 })}
          </div>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t.checkout.note}</span>
            <textarea name="note" value={values.note ?? ""} onChange={set("note")} maxLength={1000} rows={2} className="field" />
          </label>
        </fieldset>

        <fieldset className="card space-y-3 p-5 sm:p-6">
          <legend className="px-1 text-lg font-bold">{t.checkout.payment}</legend>
          <label className="flex items-center gap-3 rounded-ctl border-2 border-brand bg-brand-soft p-3.5">
            <input type="radio" checked readOnly disabled={!codEnabled} className="size-4 accent-brand" />
            <span className="font-medium">{t.checkout.cod}</span>
          </label>
          {codLimitText ? <p className="text-sm text-muted">{codLimitText}</p> : null}
          <p className="text-sm text-muted">{t.checkout.onlineSoon}</p>
        </fieldset>
      </div>

      <aside className="card h-fit space-y-4 p-5 sm:p-6 lg:sticky lg:top-40">
        <h2 className="text-lg font-bold">{t.checkout.summary}</h2>
        <ul className="space-y-2 text-sm">
          {lines.map((line) => {
            const priced = q?.items.find((item) => item.sku.toUpperCase() === line.sku.toUpperCase());
            return (
              <li key={line.sku} className="flex justify-between gap-3">
                <span className="min-w-0">
                  {line.name}
                  {line.variantLabel ? <span className="text-muted"> · {line.variantLabel}</span> : null} × {line.quantity}
                  {priced && !priced.availability.reservable ? (
                    <span className="block text-xs text-warning">{t.checkout.notReservable}</span>
                  ) : null}
                </span>
                <span className="tabular shrink-0">{priced ? priced.line_total.formatted : "—"}</span>
              </li>
            );
          })}
        </ul>
        {q ? (
          <dl className="tabular space-y-1 border-t border-line pt-3 text-sm">
            <Row label={t.checkout.subtotal} value={q.subtotal} />
            {q.discount.amount !== "0.00" ? <Row label={t.checkout.discount} value={q.discount} /> : null}
            <Row label={t.checkout.shipping} value={q.shipping} />
            {q.tax.amount !== "0.00" ? <Row label={t.checkout.tax} value={q.tax} /> : null}
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
              <dt>{t.checkout.total}</dt>
              <dd>{q.grand_total.formatted}</dd>
            </div>
          </dl>
        ) : revised ? (
          <p className="tabular text-sm">
            {t.checkout.total}: <strong>{revised.formatted}</strong>
          </p>
        ) : null}

        {notice ? (
          <p role="alert" className={`text-sm ${notice.tone === "error" ? "text-danger" : "text-warning"}`}>
            {notice.text}
          </p>
        ) : null}
        {q && !codEligible ? <p className="text-sm text-danger">{t.checkout.codIneligible}</p> : null}

        {q ? (
          <button type="submit" className="btn btn-accent min-h-12 w-full" disabled={pending || !codEligible || !codEnabled}>
            {pending ? t.checkout.placing : `${t.checkout.placeOrder} · ${q.grand_total.formatted}`}
          </button>
        ) : (
          <button type="submit" className="btn btn-primary min-h-12 w-full" disabled={pending || !codEnabled}>
            {pending ? t.states.loading : revised ? t.checkout.reviewAgain : t.checkout.getQuote}
          </button>
        )}
        <p className="text-xs text-muted">{t.checkout.quoteNote}</p>
      </aside>
    </form>
  );
}

function Row({ label, value }: { label: string; value: Money }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd>{value.formatted}</dd>
    </div>
  );
}
