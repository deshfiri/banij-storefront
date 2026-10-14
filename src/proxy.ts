import { type NextRequest, NextResponse } from "next/server";
import { LOCALES } from "@/lib/i18n";
import { normalizeHost } from "@/server/host";
import { isProvisioningRequest, provisioningConfig } from "@/server/provisioning";
import { previewMode } from "@/server/site-config";
import { resolveTenant } from "@/server/tenant";

/**
 * Runs before every page: the host decides the website, or nothing is served.
 *
 * - malformed or unregistered host → 404, no website content and no redirect
 * - website suspended, preparing, in maintenance, or ERP unreachable → 503 with Retry-After
 * - verified alias → 308 to the primary host (D30 §3)
 * - a path with no locale prefix → the website's default locale
 * - read-only preview: every response carries `X-Robots-Tag: noindex, nofollow, noarchive`
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = await route(request);
  if (previewMode()) {
    response.headers.set("X-Robots-Tag", PREVIEW_ROBOTS);
  }
  return response;
}

const PREVIEW_ROBOTS = "noindex, nofollow, noarchive";

async function route(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (pathname === "/api/health") {
    return NextResponse.next();
  }
  // The internal provisioning route never belongs to a website; it is served only on its own host.
  if (pathname.startsWith("/api/internal/")) {
    return isProvisioningRequest(request.headers.get("host"), pathname)
      ? NextResponse.next()
      : new NextResponse(null, { status: 404 });
  }
  if (normalizeHost(request.headers.get("host")) === provisioningConfig()?.host) {
    return new NextResponse(null, { status: 404 });
  }

  const resolution = await resolveTenant(request.headers.get("host"));

  if (resolution.kind === "not-found") {
    return new NextResponse(page("Not found", "There is no shop at this address."), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (resolution.kind === "unavailable") {
    const message =
      resolution.reason === "maintenance"
        ? resolution.message || "This shop is undergoing maintenance. Please check back soon."
        : resolution.reason === "erp" || resolution.reason === "identity"
          ? // Identity problems look exactly like an outage to customers; operators read the log.
            "This shop is temporarily unavailable. Please try again in a moment."
          : "This shop is not available right now.";
    return new NextResponse(page("Temporarily unavailable", message), {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "retry-after": resolution.reason === "erp" ? "30" : "300",
      },
    });
  }
  if (resolution.kind === "redirect") {
    const target = new URL(request.nextUrl.pathname + request.nextUrl.search, resolution.location);
    return NextResponse.redirect(target, 308);
  }

  if (pathname === "/robots.txt" || pathname === "/sitemap.xml" || pathname.startsWith("/api/")) {
    return NextResponse.next();
  }
  const first = pathname.split("/")[1] ?? "";
  if (!(LOCALES as readonly string[]).includes(first)) {
    const site = resolution.tenant.site;
    const preferred = request.cookies.get("bsf_lang")?.value;
    const locale =
      preferred && site.locale.available.includes(preferred) && (LOCALES as readonly string[]).includes(preferred)
        ? preferred
        : (LOCALES as readonly string[]).includes(site.locale.default)
          ? site.locale.default
          : "en";
    // Built from the validated request host, never the server's bind address.
    const host = request.headers.get("host") ?? resolution.tenant.requestHost;
    const scheme = request.nextUrl.protocol === "http:" && process.env.NODE_ENV !== "production" ? "http" : "https";
    const target = new URL(`/${locale}${pathname === "/" ? "" : pathname}${request.nextUrl.search}`, `${scheme}://${host}`);
    return NextResponse.redirect(target, 307);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

function page(title: string, message: string): string {
  const escape = (text: string) =>
    text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title><style>body{font-family:system-ui,sans-serif;background:#f6f5f3;color:#1c1917;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{max-width:28rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .5rem}p{color:#57534e;line-height:1.5}</style></head><body><main><h1>${escape(title)}</h1><p>${escape(message)}</p></main></body></html>`;
}
