import Link from "next/link";
import type { ReactNode } from "react";
import { type SiteContent, localized } from "@/config/content-schema";
import { BrandMark } from "@/components/brand-mark";
import { CashIcon, ChevronDownIcon, MailIcon, PhoneIcon, PinIcon, SocialIcon } from "@/components/icons";
import { LOCALES, languageName, type Dictionary } from "@/lib/i18n";
import type { Site } from "@/lib/types";
import type { NavCategory } from "@/server/catalog";

const SOCIAL_NAMES: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  x: "X",
};

type FooterLink = { href: string; label: string; external?: boolean };

/**
 * Footer: brand, Shop / Support / Help / Contact columns, payment methods, copyright.
 *
 * Every fact comes from the ERP (/site) or the installation's own content.json; a column without
 * content is not rendered. Payment shows only methods the ERP has enabled for this website. There
 * are no app-store badges: no app exists.
 */
export function SiteFooter({
  lang,
  site,
  categories,
  content,
  ordersEnabled,
  t,
  note,
}: {
  lang: string;
  site: Site;
  categories: NavCategory[];
  content: SiteContent;
  ordersEnabled: boolean;
  t: Dictionary;
  note?: ReactNode;
}) {
  const shopLinks: FooterLink[] = [
    { href: `/${lang}/products`, label: t.nav.allProducts },
    ...categories.slice(0, 6).map((c) => ({ href: `/${lang}${c.href}`, label: c.name })),
    { href: `/${lang}/products?sort=newest`, label: t.footer.newArrivals },
  ];
  const supportLinks: FooterLink[] = [
    { href: `/${lang}/cart`, label: t.nav.cart },
    ...(ordersEnabled ? [{ href: `/${lang}/orders`, label: t.nav.orders }] : []),
  ];
  const helpLinks: FooterLink[] = content.helpLinks.map((link) => ({
    href: link.href.startsWith("/") ? `/${lang}${link.href}` : link.href,
    label: localized(link.label, lang),
    external: !link.href.startsWith("/"),
  }));
  const { phone, email, address } = site.contact;
  const hasContact = Boolean(phone || email || address);
  const codEnabled = site.checkout.cod.enabled && site.checkout.payment_methods.includes("cod");
  const languages = LOCALES.filter((l) => site.locale.available.includes(l));

  const contactList = (
    <ul className="space-y-3 text-[0.9375rem] text-muted">
      {phone ? (
        <li>
          <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} className="inline-flex items-center gap-2 hover:text-ink hover:underline">
            <PhoneIcon size={16} /> <span className="tabular">{phone}</span>
          </a>
        </li>
      ) : null}
      {email ? (
        <li>
          <a href={`mailto:${email}`} className="inline-flex items-center gap-2 hover:text-ink hover:underline">
            <MailIcon size={16} /> {email}
          </a>
        </li>
      ) : null}
      {address ? (
        <li className="flex items-start gap-2">
          <PinIcon size={16} className="mt-0.5 shrink-0" /> <span>{address}</span>
        </li>
      ) : null}
    </ul>
  );

  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="page-container grid gap-x-10 gap-y-2 py-10 md:grid-cols-2 md:gap-y-8 lg:grid-cols-[1.6fr_repeat(4,1fr)] lg:py-14">
        <div className="space-y-4 pb-6 md:col-span-2 md:pb-0 lg:col-span-1">
          <Link href={`/${lang}`} className="inline-flex" aria-label={site.name}>
            <BrandMark site={site} size="lg" />
          </Link>
          {site.branding.about || site.branding.tagline ? (
            <p className="max-w-sm text-[0.9375rem] text-muted">{site.branding.about ?? site.branding.tagline}</p>
          ) : null}
          {content.social.length > 0 ? (
            <div>
              <p className="sr-only">{t.footer.follow}</p>
              <ul className="flex flex-wrap gap-2">
                {content.social.map((item) => (
                  <li key={item.url}>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="icon-btn"
                      aria-label={SOCIAL_NAMES[item.network] ?? item.network}
                    >
                      <SocialIcon network={item.network} size={18} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {languages.length > 1 ? (
            <ul className="flex flex-wrap gap-2 pt-1" aria-label={t.nav.language}>
              {languages.map((l) => (
                <li key={l}>
                  <Link
                    href={`/${l}`}
                    hrefLang={l}
                    lang={l}
                    aria-current={l === lang ? "true" : undefined}
                    className={`btn btn-sm ${l === lang ? "btn-accent" : "btn-ghost"}`}
                  >
                    {languageName(l)}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <FooterColumn title={t.footer.shop}>
          <LinkList links={shopLinks} />
        </FooterColumn>
        <FooterColumn title={t.footer.support}>
          <LinkList links={supportLinks} />
        </FooterColumn>
        {helpLinks.length > 0 ? (
          <FooterColumn title={t.footer.help}>
            <LinkList links={helpLinks} />
          </FooterColumn>
        ) : null}
        {hasContact ? <FooterColumn title={t.footer.contact}>{contactList}</FooterColumn> : null}
      </div>

      {note ? (
        <div className="page-container pb-4 text-sm" data-slot="footer-note">
          {note}
        </div>
      ) : null}
      <div className="border-t border-line">
        <div className="page-container flex flex-col items-center gap-3 py-5 text-sm text-muted sm:flex-row sm:justify-between">
          <p>
            © {new Date().getFullYear()} <span className="font-semibold text-ink">{site.name}</span>. {t.footer.rights}
          </p>
          {codEnabled ? (
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold tracking-[0.14em] uppercase">{t.footer.weAccept}</span>
              <span className="inline-flex items-center gap-2 rounded-ctl border border-line px-3 py-1.5 text-ink">
                <CashIcon size={18} /> {t.footer.cod}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

function LinkList({ links }: { links: FooterLink[] }) {
  return (
    <ul className="space-y-3 text-[0.9375rem]">
      {links.map((link) => (
        <li key={link.href}>
          {link.external ? (
            <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-ink hover:underline">
              {link.label}
            </a>
          ) : (
            <Link href={link.href} className="text-muted hover:text-ink hover:underline">
              {link.label}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A footer column: always open from tablet up; a native, no-JS accordion on phones. */
function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="hidden md:block">
        <p className="mb-5 text-xs font-bold tracking-[0.14em] text-ink uppercase">{title}</p>
        {children}
      </div>
      <details className="group border-b border-line md:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-xs font-bold tracking-[0.14em] uppercase [&::-webkit-details-marker]:hidden">
          {title}
          <ChevronDownIcon size={18} className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="pb-4">{children}</div>
      </details>
    </>
  );
}
