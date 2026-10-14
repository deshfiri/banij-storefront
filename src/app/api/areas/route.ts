import { type NextRequest, NextResponse } from "next/server";
import { deliveryAreas } from "@/server/catalog";
import { resolveTenant } from "@/server/tenant";

/** Delivery areas for the checkout form, fetched with this website's own credential. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolution = await resolveTenant(request.headers.get("host"));
  if (resolution.kind !== "ok") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const parent = request.nextUrl.searchParams.get("parent");
  try {
    const areas = await deliveryAreas(resolution.tenant, parent && parent.length > 0 ? parent : null);
    return NextResponse.json({ data: areas }, { headers: { "cache-control": "private, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
