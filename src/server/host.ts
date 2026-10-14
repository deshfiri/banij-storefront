/**
 * Strict request-host validation. Pure, so it is unit-tested directly.
 *
 * The only input is the `Host` header the server received. `X-Forwarded-Host` is never consulted:
 * in production Caddy sets `Host` itself and only for names the ERP authorised (D30 §4), and
 * trusting a forwarded header would let a client choose the tenant.
 */
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const value = raw.trim().toLowerCase();
  if (value.length === 0 || value.length > 260) {
    return null;
  }
  // Reject IPv6 literals, userinfo, paths and anything with whitespace or a comma (multi-value).
  if (/[\s,@/\\[\]]/.test(value)) {
    return null;
  }
  const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(value);
  if (!match) {
    return null;
  }
  const name = match[1].replace(/\.$/, "");
  if (name.length > 253) {
    return null;
  }
  const labels = name.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) {
    return null;
  }
  // A bare IPv4 address is never a website.
  if (labels.every((label) => /^\d+$/.test(label))) {
    return null;
  }
  return name;
}

/** The website subdomain under the storefront root domain, if the host is one. */
export function subdomainOf(host: string, rootDomain: string): string | null {
  const suffix = `.${rootDomain}`;
  if (!host.endsWith(suffix)) {
    return null;
  }
  const label = host.slice(0, -suffix.length);
  return LABEL.test(label) ? label : null;
}
