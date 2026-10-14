import { NextResponse } from "next/server";
import { redis } from "@/server/redis";
import { assertDeploymentMode, assertInstallationEnv, assertPreviewMode, siteConfig, storefrontMode } from "@/server/site-config";

/**
 * Liveness for Caddy's / the orchestrator's health check: answers on any host and reveals no website
 * and no data. Unhealthy (503) when this installation's configuration or server-side .env is invalid
 * or its Redis is unreachable — so a broken installation is never reported healthy.
 */
export async function GET(): Promise<NextResponse> {
  const headers = { "cache-control": "no-store" };
  try {
    assertDeploymentMode();
    if (storefrontMode() === "single") {
      siteConfig();
      assertInstallationEnv();
    }
    assertPreviewMode();
    await (await redis()).ping();
    return NextResponse.json({ status: "ok" }, { headers });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
  }
}
