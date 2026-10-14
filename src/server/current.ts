import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { type Tenant, resolveTenant } from "./tenant";

/**
 * The tenant for this request, resolved from the `Host` header only. The proxy has already turned
 * unknown hosts into 404s and unavailable websites into 503s; this re-resolution is a cheap Redis
 * read and guarantees a page never renders for a host the proxy did not accept.
 */
export const currentTenant = cache(async (): Promise<Tenant> => {
  const resolution = await resolveTenant((await headers()).get("host"));
  if (resolution.kind !== "ok") {
    notFound();
  }
  return resolution.tenant;
});
