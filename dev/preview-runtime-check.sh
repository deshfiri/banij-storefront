#!/usr/bin/env bash
# DEVELOPMENT ONLY. Proves the read-only preview at runtime, end to end, LOCALLY:
#   - generates a throwaway preview TEST instance (~/.cache/bsf-generated/preview-test), built with
#     STOREFRONT_PREVIEW=true, served in production mode on 127.0.0.1:3201 (never public);
#   - it uses the existing DEV credential only so catalogue reads work; the preview guard refuses
#     every order operation before any request is sent;
#   - checks pages, headers, robots, blocked routes; drives a real browser through browse → cart →
#     disabled checkout;
#   - proves from the ERP's own tables that nothing was written (read-only counts before/after).
# Leaves nothing running; the test instance's .env.local is shredded afterwards.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/dev/node-env.sh"
OUT="$HOME/.cache/bsf-generated/preview-test"
ERP_DIR="$HOME/projects/feriwala"
PORT=3201
HOST=karimtraders.feriwala.shop
fail=0
ok() { echo "ok   $*"; }
bad() { echo "FAIL $*"; fail=1; }
expect() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
erp_counts() { (cd "$ERP_DIR" && php artisan tinker < "$ROOT/dev/erp-readonly-counts.tinker" 2>/dev/null | grep '^ERP_COUNTS=' | cut -d= -f2-); }

BEFORE=$(erp_counts)
[ -n "$BEFORE" ] || { echo "FAIL cannot read ERP counts"; exit 1; }
echo "ERP before: $BEFORE"

echo "== generating and building the preview test instance"
rm -rf "$OUT"; mkdir -p "$OUT"
(cd "$ROOT" && tar --exclude=./node_modules --exclude=./.next --exclude='./.env*' --exclude=./test-results \
  --exclude=./dev/tls --exclude=./.git -cf - .) | (cd "$OUT" && tar -xf -)
cp -al "$ROOT/node_modules" "$OUT/node_modules"
# Staging config whose primary is the ERP-known subdomain (the real preview host is not registered).
cat > "$OUT/site/site.config.json" <<'EOF'
{
  "schemaVersion": 2,
  "template": { "name": "banij-storefront", "version": "0.2.0" },
  "website": { "id": "01M4MHJ7BA282X3QXV1Q256ZMP", "slug": "karimtraders" },
  "domains": { "primary": "karimtraders.feriwala.shop", "aliases": [], "development": [] },
  "theme": { "colors": {} },
  "locale": {},
  "features": {},
  "deployment": { "environment": "staging" }
}
EOF
if (cd "$OUT" && env -u BANIJ_CREDENTIAL_KEY_ID -u BANIJ_CREDENTIAL_SECRET STOREFRONT_PREVIEW=true NEXT_TELEMETRY_DISABLED=1 npx next build > build.log 2>&1); then
  ok "preview test build"
else
  bad "preview test build"; tail -20 "$OUT/build.log"; exit 1
fi
(cd "$ROOT" && node dev/dev-env.mjs --website 01M4MHJ7BA282X3QXV1Q256ZMP --erp https://127.0.0.1:8443 --file "$OUT/.env.local" > /dev/null)

bash "$ROOT/dev/free-port.sh" $PORT
redis-cli -n 12 flushdb > /dev/null
(cd "$OUT" && env -u STOREFRONT_MODE NODE_ENV=production STOREFRONT_PREVIEW=true STOREFRONT_INSECURE_COOKIES=true \
  NODE_EXTRA_CA_CERTS="$ROOT/dev/tls/erp-dev.crt" STOREFRONT_REDIS_URL=redis://127.0.0.1:6379/12 \
  setsid nohup npx next start -p $PORT -H 127.0.0.1 > run.log 2>&1 < /dev/null &)
for _ in $(seq 1 30); do sleep 1; curl -s -o /dev/null http://127.0.0.1:$PORT/api/health && break; done

echo "== HTTP checks (Host: $HOST)"
req() { curl -s -D /tmp/bsf-pv-headers.txt -o /tmp/bsf-pv-body.html -w "%{http_code}" -H "Host: ${2:-$HOST}" "http://127.0.0.1:$PORT$1"; }
robots_header() { grep -qi '^x-robots-tag: noindex, nofollow, noarchive' /tmp/bsf-pv-headers.txt; }
expect "listens on 127.0.0.1:$PORT only" '[ "$(ss -ltnH "sport = :$PORT" | awk "{print \$4}" | sort -u)" = "127.0.0.1:$PORT" ]'
expect "/en 200 with English banner"                  '[ "$(req /en)" = 200 ] && grep -q "PREVIEW — UNDER DEVELOPMENT" /tmp/bsf-pv-body.html'
expect "/en carries X-Robots-Tag"                     'robots_header'
expect "/en has meta robots noindex"                  'grep -qE "<meta name=\"robots\" content=\"noindex" /tmp/bsf-pv-body.html'
expect "/bn 200 with Bangla banner"                   '[ "$(req /bn)" = 200 ] && grep -q "প্রিভিউ — নির্মাণাধীন" /tmp/bsf-pv-body.html'
expect "catalogue renders real ERP products"          '[ "$(req /en/products)" = 200 ] && grep -q "Sylhet Premium Black Tea" /tmp/bsf-pv-body.html'
expect "product page renders"                         '[ "$(req /en/products/sylhet-premium-black-tea-400g)" = 200 ] && grep -q "Add to cart" /tmp/bsf-pv-body.html'
expect "order page is 404 (no order reads)"           '[ "$(req /en/orders/01M4T0960T4XYMZ2T4PM0DBYR4)" = 404 ] && robots_header'
expect "checkout without cart → cart"                 '[ "$(req /en/checkout)" = 307 ]'
expect "robots.txt disallows everything, no sitemap"  '[ "$(req /robots.txt)" = 200 ] && grep -q "Disallow: /" /tmp/bsf-pv-body.html && ! grep -qi "sitemap" /tmp/bsf-pv-body.html && robots_header'
expect "sitemap.xml lists nothing"                    '[ "$(req /sitemap.xml)" = 200 ] && ! grep -q "<loc>" /tmp/bsf-pv-body.html'
expect "internal registry route 404"                  '[ "$(req /api/internal/registry)" = 404 ]'
expect "other host 404, also noindex"                 '[ "$(req /en other.example.com)" = 404 ] && robots_header'
expect "health 200"                                   '[ "$(req /api/health)" = 200 ]'
asset=$(grep -oE '/_next/static/[^"]+\.js' /tmp/bsf-pv-body.html | head -1)
req /en > /dev/null; asset=$(grep -oE '/_next/static/[^"]+\.(js|css)' /tmp/bsf-pv-body.html | head -1)
expect "static assets carry X-Robots-Tag ($asset)"   '[ -n "$asset" ] && [ "$(req "$asset")" = 200 ] && robots_header'
expect "no credential value in any page"              '! grep -qF "$(grep "^BANIJ_CREDENTIAL_SECRET=" "$OUT/.env.local" | cut -d= -f2-)" /tmp/bsf-pv-body.html'

echo "== browser (Playwright)"
if (cd "$ROOT" && E2E_PREVIEW=1 bash dev/e2e.sh tests/e2e/preview.spec.ts > /tmp/bsf-pv-e2e.log 2>&1); then
  ok "preview E2E: $(grep -E '[0-9]+ passed' /tmp/bsf-pv-e2e.log | tail -1 | xargs)"
else
  bad "preview E2E"; grep -vE '^\s+at ' /tmp/bsf-pv-e2e.log | tail -25
fi

bash "$ROOT/dev/free-port.sh" $PORT
grep -q "PreviewRefused\|Preview: " "$OUT/run.log" && echo "note: preview refusals logged by the server" || true
shred -u "$OUT/.env.local" 2>/dev/null || rm -f "$OUT/.env.local"
redis-cli -n 12 flushdb > /dev/null

AFTER=$(erp_counts)
echo "ERP after:  $AFTER"
expect "ERP unchanged: no order, reservation, write request, credential or domain created" '[ "$AFTER" = "$BEFORE" ]'
exit $fail
