import { type NextRequest, NextResponse } from "next/server";
import { handleProvisioning, isProvisioningRequest } from "@/server/provisioning";

const MAX_BODY_BYTES = 16 * 1024;

/**
 * ERP → storefront credential provisioning (docs/provisioning-protocol.md). Answers only on the
 * internal provisioning host; everywhere else it is indistinguishable from a missing route.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const headers = { "cache-control": "no-store" };
  if (!isProvisioningRequest(request.headers.get("host"), request.nextUrl.pathname)) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  }
  // In production the internal listener is TLS-terminated by Caddy, which sets this header itself.
  if (process.env.NODE_ENV === "production" && request.headers.get("x-forwarded-proto") !== "https") {
    return NextResponse.json({ error: "https_required" }, { status: 400, headers });
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413, headers });
  }
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413, headers });
  }
  const outcome = await handleProvisioning(request.headers, body);
  return NextResponse.json(outcome.body, { status: outcome.status, headers });
}

export function GET(): NextResponse {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
