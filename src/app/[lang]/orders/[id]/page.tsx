import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CodConfirmation } from "@/components/cod-confirmation";
import { CheckIcon } from "@/components/icons";
import { dictionary, isLocale, statusLabel } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { canViewOrder } from "@/server/cart";
import { readOrder } from "@/server/checkout";
import { currentTenant } from "@/server/current";
import { previewMode } from "@/server/site-config";

export const metadata: Metadata = { title: "Order", robots: { index: false, follow: false } };

export default async function OrderPage({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang: raw, id } = await params;
  const lang = isLocale(raw) ? raw : "en";
  const t = dictionary(lang);
  const tenant = await currentTenant();

  // A read-only preview reads no orders at all. Otherwise only the browser that placed the order may
  // see it; anyone else gets the same 404 as an unknown id.
  if (previewMode() || !/^[0-9A-Z]{26}$/.test(id) || !(await canViewOrder(tenant, id))) {
    notFound();
  }
  const order = await readOrder(tenant, id);
  if (!order) {
    notFound();
  }
  const awaiting = order.status === "customer_verification_pending" && order.confirmation?.state === "pending";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <section className="card flex flex-col items-center space-y-3 p-6 text-center sm:p-8">
        <span className="icon-badge size-14">
          <CheckIcon size={28} />
        </span>
        <h1 className="text-2xl font-bold">{t.order.thanks}</h1>
        <p className="text-muted">
          {t.order.reference}: <strong className="tabular text-ink">{order.reference}</strong>
        </p>
        <p>
          <span className="chip font-medium">
            {t.order.status}: {statusLabel(t, order.status)}
          </span>
        </p>
      </section>

      {awaiting ? (
        <CodConfirmation
          orderId={order.id}
          t={t}
          deadline={order.confirmation?.expires_at ? formatDate(order.confirmation.expires_at, lang) : null}
          resendAvailableIn={order.confirmation?.resend_available_in ?? 0}
        />
      ) : order.status === "confirmed" || order.confirmation?.state === "confirmed" ? (
        <p role="status" className="card p-4 text-center text-success">
          {t.order.confirmed}
        </p>
      ) : order.status === "cancelled" ? (
        <p role="status" className="card p-4 text-center text-danger">
          {t.order.expired}
        </p>
      ) : null}

      <section className="card p-5 sm:p-7">
        <h2 className="mb-3 text-lg font-bold">{t.order.items}</h2>
        <ul className="divide-y divide-line text-sm">
          {order.items.map((item) => (
            <li key={item.sku} className="flex justify-between gap-3 py-2">
              <span>
                {item.name}
                {item.variant ? <span className="text-muted"> · {item.variant}</span> : null} × {item.quantity}
              </span>
              <span className="tabular">{item.line_total.formatted}</span>
            </li>
          ))}
        </ul>
        <dl className="tabular mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{t.checkout.subtotal}</dt>
            <dd>{order.totals.subtotal.formatted}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{t.checkout.shipping}</dt>
            <dd>{order.totals.shipping.formatted}</dd>
          </div>
          <div className="flex justify-between text-base font-semibold">
            <dt>{t.checkout.total}</dt>
            <dd>{order.totals.grand_total.formatted}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted">
          {t.checkout.payment}: {order.payment.method === "cod" ? t.checkout.cod : t.checkout.online}
        </p>
      </section>
    </div>
  );
}
