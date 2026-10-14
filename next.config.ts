import type { NextConfig } from "next";
import { parseImageOrigin } from "./src/config/image-origin";

/**
 * Product images: Next.js's server-side optimizer fetches ONLY from the one trusted ERP media origin
 * (STOREFRONT_IMAGE_ORIGIN) and serves WebP to the browser — so the browser never needs to reach the
 * ERP, and no other host can be fetched. A loopback/private origin (local development ERP) also needs
 * `dangerouslyAllowLocalIP`, which Next 16 refuses by default; the exact remotePattern still limits it
 * to that origin and path, and boot validation refuses a local origin on a production-configured site.
 * Without an origin, images stay unoptimized and the storefront renders placeholders.
 */
const imageOrigin = parseImageOrigin(process.env.STOREFRONT_IMAGE_ORIGIN);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The image allow-list above is fixed when the app is built. The build records which origin it
  // allowed (public, not a secret) so the boot check can refuse a runtime value that differs from it —
  // a mismatch would otherwise turn every product image into a placeholder without an error.
  env: { STOREFRONT_BUILD_IMAGE_ORIGIN: process.env.STOREFRONT_IMAGE_ORIGIN ?? "" },
  // Self-contained server for the container image (deploy/Dockerfile).
  output: "standalone",
  images: imageOrigin
    ? {
        remotePatterns: [
          {
            protocol: imageOrigin.protocol,
            hostname: imageOrigin.hostname,
            port: imageOrigin.port,
            pathname: `${imageOrigin.pathPrefix}**`,
            search: "",
          },
        ],
        dangerouslyAllowLocalIP: imageOrigin.isLocal,
        formats: ["image/webp"],
        maximumRedirects: 0,
      }
    : { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // A preview build (STOREFRONT_PREVIEW=true at build time) marks static assets too; pages are
          // also marked at runtime by the proxy.
          ...(process.env.STOREFRONT_PREVIEW === "true"
            ? [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
