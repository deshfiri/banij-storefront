import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Bengali } from "next/font/google";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import "../globals.css";
// Website customization layer: token overrides, loaded after the template's styles.
import "@site/theme.css";
import { customizations } from "@site/customizations";
import { SiteHeader } from "@/components/header/site-header";
import { SiteFooter } from "@/components/site-footer";
import { dictionary, isLocale } from "@/lib/i18n";
import { brandColors, themeOf } from "@/lib/format";
import { readCart } from "@/server/cart";
import { navigationCategories } from "@/server/catalog";
import { currentTenant } from "@/server/current";
import { siteContent } from "@/server/site-content";
import { previewMode } from "@/server/site-config";
import { publicOrigin } from "@/server/urls";

/**
 * Bengali script and the Taka sign (U+09F3) must render on every device, including ones with no
 * Bengali system font. Self-hosted at build time by next/font — no request to Google at runtime.
 */
const bengali = Noto_Sans_Bengali({ subsets: ["bengali", "latin"], variable: "--font-bengali", display: "swap" });
/** Latin text (UI redesign S0): Inter, self-hosted the same way; Bangla glyphs fall through to Noto. */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const { site, requestHost } = await currentTenant();
  const origin = publicOrigin(site.hosts.primary, requestHost);
  return {
    metadataBase: new URL(origin),
    title: { default: site.name, template: `%s · ${site.name}` },
    description: site.branding.tagline ?? site.branding.about ?? undefined,
    alternates: {
      canonical: `/${lang}`,
      languages: Object.fromEntries(site.locale.available.filter(isLocale).map((l) => [l, `/${l}`])),
    },
    openGraph: { siteName: site.name, type: "website", locale: lang === "bn" ? "bn_BD" : "en_US" },
    // A preview is never indexed (also enforced by X-Robots-Tag and robots.txt).
    robots: previewMode() ? { index: false, follow: false, nocache: true } : undefined,
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function LangLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) {
    notFound();
  }
  const tenant = await currentTenant();
  const { site } = tenant;
  const t = dictionary(lang);
  const [cart, categories] = await Promise.all([readCart(tenant), navigationCategories(tenant)]);
  const count = cart.lines.reduce((sum, line) => sum + line.quantity, 0);
  const colors = brandColors(site.branding.primary_color, site.branding.secondary_color);
  const style = { "--brand": colors.brand, "--brand-2": colors.brand2 } as CSSProperties;

  const themePreview = process.env.NODE_ENV !== "production" ? (await cookies()).get("bsf_theme_preview")?.value : null;
  const isPreview = previewMode();

  return (
    <html lang={lang} data-theme={themeOf(site, themePreview)} style={style} className={`${inter.variable} ${bengali.variable}`}>
      <body className="flex min-h-screen flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-ctl focus:bg-surface focus:px-4 focus:py-2 focus:shadow-pop"
        >
          {lang === "bn" ? "মূল বিষয়বস্তুতে যান" : "Skip to content"}
        </a>
        {isPreview ? (
          // Not dismissible, not themeable: a preview must never be mistaken for a live shop.
          <div
            role="status"
            data-preview-banner
            className="bg-[#7c2d12] px-4 py-2 text-center text-sm font-semibold text-white"
          >
            <span className="tracking-wide">{t.preview.banner}</span>
            <span className="ml-2 font-normal opacity-90">{t.preview.bannerDetail}</span>
          </div>
        ) : null}
        <SiteHeader lang={lang} site={site} categories={categories} cartCount={count} ordersEnabled={!isPreview} t={t} />

        <main id="main" tabIndex={-1} className="page-container flex-1 py-5 focus:outline-none sm:py-6">
          {children}
        </main>

        <SiteFooter
          lang={lang}
          site={site}
          categories={categories}
          content={siteContent()}
          ordersEnabled={!isPreview}
          t={t}
          note={customizations.FooterNote ? customizations.FooterNote({ name: site.name, lang }) : undefined}
        />
      </body>
    </html>
  );
}
