import { localized } from "@/config/content-schema";
import { BenefitIcon } from "@/components/icons";
import { type Dictionary, fill } from "@/lib/i18n";
import { deliveryAreas } from "@/server/catalog";
import type { Tenant } from "@/server/tenant";
import { siteContent } from "@/server/site-content";
import { siteFeatures } from "@/server/site-config";

export type Benefit = { icon: string; title: string; text: string | null };

/**
 * What a customer can rely on, from facts only:
 *   - cash on delivery — when the ERP has it enabled for this website (with its own limit);
 *   - home delivery — when the ERP returns delivery areas for this website;
 *   - the shop's own trust cards from site/content.json (claims the business itself confirms).
 * Nothing is assumed: no "free delivery", no return window, no authenticity promise unless the shop
 * states it. Fewer facts means fewer cards, never invented ones.
 */
export async function shopBenefits(tenant: Tenant, lang: string, t: Dictionary): Promise<Benefit[]> {
  const { site } = tenant;
  const benefits: Benefit[] = [];
  const cod = siteFeatures().cashOnDelivery && site.checkout.cod.enabled && site.checkout.payment_methods.includes("cod");
  if (cod) {
    benefits.push({
      icon: "cash",
      title: t.benefits.codTitle,
      text: site.checkout.cod.maximum ? fill(t.benefits.codLimit, { max: site.checkout.cod.maximum.formatted }) : t.benefits.codText,
    });
  }
  const areas = await deliveryAreas(tenant, null).catch(() => []);
  if (areas.length > 0) {
    benefits.push({ icon: "truck", title: t.benefits.deliveryTitle, text: t.benefits.deliveryText });
  }
  for (const card of siteContent().trust) {
    benefits.push({ icon: card.icon, title: localized(card.title, lang), text: card.text ? localized(card.text, lang) : null });
  }
  return benefits.slice(0, 4);
}

/** The benefits as a strip of cards (homepage) or a compact grid (product page). */
export function Benefits({ items, title, compact = false }: { items: Benefit[]; title: string; compact?: boolean }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section aria-label={title}>
      <ul
        className={
          compact
            ? "grid gap-2.5 sm:grid-cols-2"
            : "grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] lg:gap-4"
        }
      >
        {items.map((item) => (
          <li
            key={item.title}
            className={`flex items-center gap-3.5 rounded-card border border-line bg-surface ${compact ? "p-3" : "p-4 sm:p-5"}`}
          >
            <span className={`icon-badge ${compact ? "size-10" : "sm:size-14"}`}>
              <BenefitIcon name={item.icon} size={compact ? 20 : 26} />
            </span>
            <span className="min-w-0">
              <span className={`block font-semibold ${compact ? "text-sm" : ""}`}>{item.title}</span>
              {item.text ? <span className="block text-sm text-muted">{item.text}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
