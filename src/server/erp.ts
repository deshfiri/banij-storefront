import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "./env";
import { previewMode, previewQuoteEnabled } from "./site-config";
import type { Credential } from "./registry";
import { authorizationHeader, canonicalRequest, encodeQuery } from "./signing";

const API_PREFIX = "/api/storefront/v1";

export type ErpErrorBody = {
  code: string;
  message: string;
  details: Record<string, unknown>;
  request_id?: string;
};

/** A refusal the ERP answered with its error envelope (contract §4.5). */
export class ErpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ErpErrorBody,
  ) {
    super(`ERP ${status} ${body.code}`);
  }
}

/** The ERP could not be reached, or answered with something that is not the contract. */
export class ErpUnavailable extends Error {}

/** A call refused locally because this installation runs as a read-only preview. Never sent. */
export class PreviewRefused extends Error {
  constructor(method: string, path: string) {
    super(`Preview: ${method} ${path.replace(/\/[0-9A-Z]{26}(?=\/|$)/g, "/{id}")} is disabled`);
  }
}

/**
 * The only ERP operations a preview may perform: catalogue and site reads, and — only when
 * explicitly enabled — the advisory quote. Everything else (order creation, every order read,
 * confirmation, code resend, cancellation, payment session, returns, inventory, customers) is
 * refused here, before a request is signed or sent.
 */
const PREVIEW_READS = [/^\/site$/, /^\/products(?:\/[A-Za-z0-9_-]+|\/facets)?$/, /^\/categories(?:\/[A-Za-z0-9_-]+)?$/, /^\/delivery\/areas$/];

export function previewAllows(method: "GET" | "POST", path: string): boolean {
  if (method === "GET") {
    return PREVIEW_READS.some((pattern) => pattern.test(path));
  }
  return path === "/checkout/quote" && previewQuoteEnabled();
}

type RequestOptions = {
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  /** The host this request is served for; the ERP refuses it unless it is the credential's website. */
  statedHost: string;
};

/**
 * A signed call to the Storefront API with one website's own credential (D30 §2).
 *
 * GETs and the advisory quote retry 429/5xx with backoff and jitter (contract §8.4). Writes retry
 * only with the same Idempotency-Key, so a retry can never become a second order (§4.7).
 */
export async function erpRequest<T>(
  credential: Credential,
  method: "GET" | "POST",
  path: string,
  options: RequestOptions,
): Promise<{ status: number; data: T }> {
  if (previewMode() && !previewAllows(method, path)) {
    throw new PreviewRefused(method, path);
  }
  const rawQuery = options.query ? encodeQuery(options.query) : "";
  const fullPath = `${API_PREFIX}${path}`;
  const body = options.body === undefined ? "" : JSON.stringify(options.body);
  const url = `${env.erpBaseUrl}${fullPath}${rawQuery ? `?${rawQuery}` : ""}`;

  if (!url.startsWith("https://")) {
    throw new ErpUnavailable("The ERP must be reached over HTTPS (contract §3.3)");
  }

  const attempts = method === "GET" || options.idempotencyKey || path === "/checkout/quote" ? 3 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Each attempt is a fresh signature: a new nonce and timestamp, same body and key.
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomUUID();
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Feriwala-Timestamp": timestamp,
      "X-Feriwala-Nonce": nonce,
      "X-Feriwala-Storefront-Host": options.statedHost,
      Authorization: authorizationHeader(
        credential.keyId,
        credential.secret,
        canonicalRequest(method, fullPath, rawQuery, timestamp, nonce, body),
      ),
    };
    if (body !== "") {
      headers["Content-Type"] = "application/json";
    }
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body === "" ? undefined : body,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(method === "GET" ? 8000 : 20000),
      });
      const text = await response.text();
      const parsed = safeJson(text);

      if (response.ok) {
        if (parsed === undefined) {
          throw new ErpUnavailable(`ERP returned non-JSON for ${method} ${path}`);
        }
        return { status: response.status, data: parsed as T };
      }

      const envelope = (parsed as { error?: ErpErrorBody } | undefined)?.error;
      if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
        await backoff(attempt, response.headers.get("Retry-After"));
        continue;
      }
      if (envelope && typeof envelope.code === "string") {
        throw new ErpError(response.status, { ...envelope, details: envelope.details ?? {} });
      }
      throw new ErpUnavailable(`ERP ${response.status} for ${method} ${path}`);
    } catch (error) {
      if (error instanceof ErpError) {
        throw error;
      }
      lastError = error;
      if (attempt < attempts) {
        await backoff(attempt, null);
        continue;
      }
    }
  }

  throw lastError instanceof ErpUnavailable
    ? lastError
    : new ErpUnavailable(`ERP unreachable for ${method} ${path}: ${String(lastError)}`);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function backoff(attempt: number, retryAfter: string | null): Promise<void> {
  const hinted = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : 0;
  const delay = Math.min(4000, Math.max(hinted, 250 * 2 ** attempt) + Math.random() * 200);
  await new Promise((resolve) => setTimeout(resolve, delay));
}
