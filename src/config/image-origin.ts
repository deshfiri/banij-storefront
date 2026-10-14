/**
 * The ONE trusted origin product images may come from (ERP media), e.g.
 *   STOREFRONT_IMAGE_ORIGIN=http://127.0.0.1:8000/storage/     (local development ERP)
 *   STOREFRONT_IMAGE_ORIGIN=https://media.example.com/catalog/  (production object storage / CDN)
 *
 * Pure (no server-only imports): used by next.config.ts to build `images.remotePatterns` and by the
 * server to decide which `media[]` URLs to render. Anything else is refused — no wildcards, no
 * credentials, no query or fragment.
 */
export type ImageOrigin = {
  protocol: "http" | "https";
  hostname: string;
  port: string;
  /** Path prefix, always ending in "/", e.g. "/storage/". */
  pathPrefix: string;
  /** Loopback or private address: Next.js only fetches these with `dangerouslyAllowLocalIP`. */
  isLocal: boolean;
};

export function parseImageOrigin(raw: string | undefined | null): ImageOrigin | null {
  if (!raw || raw.trim() === "") {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("STOREFRONT_IMAGE_ORIGIN is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("STOREFRONT_IMAGE_ORIGIN must be http(s)");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("STOREFRONT_IMAGE_ORIGIN must not contain credentials, a query or a fragment");
  }
  if (url.hostname.includes("*")) {
    throw new Error("STOREFRONT_IMAGE_ORIGIN must be one exact host (no wildcards)");
  }
  const hostname = url.hostname.toLowerCase();
  const isLocal = isLocalHostname(hostname);
  if (url.protocol === "http:" && !isLocal) {
    throw new Error("STOREFRONT_IMAGE_ORIGIN must use https unless it is a local development address");
  }
  const pathPrefix = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return { protocol: url.protocol === "https:" ? "https" : "http", hostname, port: url.port, pathPrefix, isLocal };
}

export function isLocalHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/** True when `url` lies exactly under the trusted origin (same scheme, host, port and path prefix). */
export function isTrustedImageUrl(url: string, origin: ImageOrigin | null): boolean {
  if (!origin) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === `${origin.protocol}:` &&
    parsed.hostname.toLowerCase() === origin.hostname &&
    parsed.port === origin.port &&
    parsed.pathname.startsWith(origin.pathPrefix) &&
    !parsed.username &&
    !parsed.password &&
    !parsed.pathname.includes("..")
  );
}
