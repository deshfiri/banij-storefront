import { hmacHex, sha256Hex } from "./crypto";

/**
 * Canonical request, mirroring the ERP's RequestSignature::canonical exactly (contract §3.2):
 * the query is the raw wire string split on `&`, empty pairs dropped, sorted byte-wise, never
 * re-encoded; the path is the full path including `/api/storefront/v1`.
 */
export function canonicalRequest(
  method: string,
  path: string,
  rawQuery: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  return [method.toUpperCase(), path + sortedQuery(rawQuery), timestamp, nonce, sha256Hex(body)].join("\n");
}

export function sortedQuery(rawQuery: string): string {
  const pairs = rawQuery.split("&").filter((pair) => pair !== "");
  if (pairs.length === 0) {
    return "";
  }
  // Byte-wise, like PHP sort(SORT_STRING); every pair is ASCII after percent-encoding.
  pairs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `?${pairs.join("&")}`;
}

export function authorizationHeader(keyId: string, secret: string, canonical: string): string {
  return `Feriwala-HMAC-SHA256 Credential=${keyId}, Signature=${hmacHex(secret, canonical)}`;
}

/** Percent-encodes a query the way the wire will carry it, so the signed string is the sent one. */
export function encodeQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}
