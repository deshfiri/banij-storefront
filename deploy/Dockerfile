# Image for ONE storefront installation (P3). Build from that website's project, after filling
# site/site.config.json (public configuration, compiled into the image):
#   docker build -f deploy/Dockerfile -t banij-storefront-<slug>:<version> .
#     --build-arg STOREFRONT_IMAGE_ORIGIN=https://<media host>/<path>/
# No credential is ever in the image: .dockerignore keeps .env* out of the build context, and the
# installation's BANIJ_* credentials arrive at runtime from its own server-side .env.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The product-image allow-list is fixed at build time (next.config.ts). Public, not a secret; the
# runtime .env must carry the same value or the server refuses to boot.
ARG STOREFRONT_IMAGE_ORIGIN
RUN test -n "$STOREFRONT_IMAGE_ORIGIN" || { echo "build argument STOREFRONT_IMAGE_ORIGIN is required" >&2; exit 1; }
ENV STOREFRONT_IMAGE_ORIGIN=$STOREFRONT_IMAGE_ORIGIN
# Defence in depth: fail the build if any .env slipped into the context despite .dockerignore.
RUN ! ls -a | grep -E '^\.env($|\.)' | grep -v '^\.env\.example$' && npm run build && bash dev/bundle-scan.sh

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN useradd --system --uid 10001 storefront
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER storefront
EXPOSE 3000
CMD ["node", "server.js"]
