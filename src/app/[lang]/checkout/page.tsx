import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CheckoutForm } from "@/components/checkout-form";
import { dictionary, fill, isLocale } from "@/lib/i18n";
import { readCart } from "@/server/cart";
import { currentTenant } from "@/server/current";
import { previewMode, siteFeatures } from "@/server/site-config";
import Link from "next/link";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  const lang = isLocale(raw) ? raw : "en";
  const t = dictionary(lang);
  const tenant = await currentTenant();
  const cart = await readCart(tenant);
  if (cart.lines.length === 0) {
    redirect(`/${lang}/cart`);
  }
  const { site } = tenant;
  if (previewMode()) {
    // Read-only preview: no checkout form, nothing to submit (actions and ERP client refuse as well).
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl">{t.checkout.title}</h1>
        <div role="alert" data-preview-checkout className="card space-y-3 p-6">
          <p className="font-medium">{t.preview.orderingDisabled}</p>
          <ul className="divide-y divide-line text-sm">
            {cart.lines.map((line) => (
              <li key={line.sku} className="flex justify-between gap-3 py-2">
                <span>
                  {line.name}
                  {line.variantLabel ? <span className="text-muted"> · {line.variantLabel}</span> : null}
                </span>
                <span className="tabular">× {line.quantity}</span>
              </li>
            ))}
          </ul>
          <Link href={`/${lang}/cart`} className="btn btn-ghost">
            {t.nav.cart}
          </Link>
        </div>
      </div>
    );
  }
  if (!site.accepting_orders) {
    return (
      <div role="alert" className="card mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl">{t.checkout.title}</h1>
        <p className="mt-2 text-muted">{t.checkout.notAccepting}</p>
      </div>
    );
  }
  const codEnabled = siteFeatures().cashOnDelivery && site.checkout.payment_methods.includes("cod") && site.checkout.cod.enabled;

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ href: `/${lang}`, label: t.nav.home }, { href: `/${lang}/cart`, label: t.nav.cart }, { label: t.checkout.title }]} />
      <h1 className="text-2xl font-bold sm:text-3xl">{t.checkout.title}</h1>
      <CheckoutForm
        lang={lang}
        t={t}
        lines={cart.lines.map((line) => ({ sku: line.sku, name: line.name, variantLabel: line.variantLabel, quantity: line.quantity }))}
        codEnabled={codEnabled}
        codLimitText={site.checkout.cod.maximum ? fill(t.checkout.codLimit, { max: site.checkout.cod.maximum.formatted }) : null}
      />
    </div>
  );
}
