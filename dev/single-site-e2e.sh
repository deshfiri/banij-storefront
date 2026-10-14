#!/usr/bin/env bash
# DEVELOPMENT ONLY. Runs the browser checkout (up to the authoritative quote; no order) against the
# generated site-a as an independent installation (default mode), on http://karimtraders.localhost:3101.
# Requires dev/independent-builds.sh to have generated ~/.cache/bsf-generated/site-a.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/dev/node-env.sh"
SITE="$HOME/.cache/bsf-generated/site-a"
[ -d "$SITE" ] || { echo "run dev/independent-builds.sh first"; exit 1; }
# The installation's own server-side .env (0600), as an admin would enter it.
(cd "$ROOT" && node dev/dev-env.mjs --website 01M4MHJ7BA282X3QXV1Q256ZMP --erp https://127.0.0.1:8443 --file "$SITE/.env.local" > /dev/null)
bash "$ROOT/dev/free-port.sh" 3101

(cd "$SITE" && env -u STOREFRONT_MODE NODE_EXTRA_CA_CERTS="$ROOT/dev/tls/erp-dev.crt" \
  STOREFRONT_REDIS_URL=redis://127.0.0.1:6379/9 \
  STOREFRONT_PUBLIC_SCHEME=http STOREFRONT_PUBLIC_PORT=3101 STOREFRONT_INSECURE_COOKIES=true \
  setsid nohup npx next dev -p 3101 -H 127.0.0.1 > dev.log 2>&1 < /dev/null &)
for _ in $(seq 1 40); do sleep 1; curl -s -o /dev/null -H "Host: karimtraders.localhost:3101" http://127.0.0.1:3101/en && break; done

cd "$ROOT"
E2E_BASE_URL=http://karimtraders.localhost:3101 E2E_NO_ORDER=1 bash dev/e2e.sh tests/e2e/checkout.spec.ts --project=desktop
status=$?
bash "$ROOT/dev/free-port.sh" 3101
shred -u "$SITE/.env.local" 2>/dev/null || rm -f "$SITE/.env.local"
redis-cli -n 9 flushdb > /dev/null
exit $status
