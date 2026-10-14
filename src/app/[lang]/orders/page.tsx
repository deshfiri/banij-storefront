import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ChevronRightIcon, ReceiptIcon } from "@/components/icons";
import { EmptyState } from "@/components/states";
import { dictionary, isLocale, statusLabel } from "@/lib/i18n";
import type { Order } from "@/lib/types";
import { rememberedOrders } from "@/server/cart";
import { readOrder } from "@/server/checkout";
import { currentTenant } from "@/server/current";
import { previewMode } from "@/server/site-config";

export const metadata: Metadata = { title: "Orders", robots: { index: false, follow: false } };

/**
 * "Your orders": the orders this browser placed on this website (there are no customer accounts).
 * Only ids the session itself recorded are read, one by one, through the same per-order read the
 * order page uses. A read-only preview reads no orders.
 */
export default async function OrdersPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  const lang = isLocale(raw) ? raw : "en";
  const t = dictionary(lang);
  if (previewMode()) {
    notFound();
  }
  const tenant = await currentTenant();
  const ids = await rememberedOrders(tenant);
  const orders = await Promise.all(
    ids.map(async (id) => ({ id, order: await readOrder(tenant, id).catch(() => null as Order | null) })),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Breadcrumbs items={[{ href: `/${lang}`, label: t.nav.home }, { label: t.orders.title }]} />
      {orders.length === 0 ? (
        <EmptyState
          headingLevel={1}
          icon={<ReceiptIcon size={26} />}
          title={t.orders.title}
          text={`${t.orders.empty} ${t.orders.hint}`}
          action={{ href: `/${lang}/products`, label: t.cart.continue }}
        />
      ) : (
        <>
          <h1 className="text-2xl font-bold sm:text-3xl">{t.orders.title}</h1>
          <p className="text-sm text-muted">{t.orders.hint}</p>
          <ul className="space-y-3">
            {orders.map(({ id, order }) => (
              <li key={id}>
                {order ? (
                  <Link href={`/${lang}/orders/${id}`} className="card flex items-center gap-4 p-4 transition hover:border-brand sm:p-5">
                    <span className="icon-badge">
                      <ReceiptIcon size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="tabular block font-semibold">{order.reference}</span>
                      <span className="mt-1 inline-flex chip">{statusLabel(t, order.status)}</span>
                    </span>
                    <span className="tabular shrink-0 text-right font-semibold">{order.totals.grand_total.formatted}</span>
                    <ChevronRightIcon size={18} className="shrink-0 text-muted" />
                    <span className="sr-only">{t.orders.view}</span>
                  </Link>
                ) : (
                  <p className="card p-4 text-sm text-muted">{t.orders.unavailable}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
