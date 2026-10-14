#!/usr/bin/env bash
# DEVELOPMENT ONLY. Proves the master template produces independent websites:
#   - two projects generated from the template, each with its own site/ config and customizations
#   - each builds on its own; neither build contains the other's identity or customization
#   - neither client bundle contains a secret
#   - at runtime each answers only its own hosts; a credential used for another website serves nothing
# Generated projects go to /tmp/bsf-generated (deleted and recreated). Places no orders.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/dev/node-env.sh"
# Same filesystem as the template, so node_modules can be hard-linked (cp -al) rather than copied.
OUT="$HOME/.cache/bsf-generated"
A_ID=01M4MHJ7BA282X3QXV1Q256ZMP      # Karim Traders Shop (dev website 2)
B_ID=01M4MH9Z0JXPDX8300NHCKERGP      # Legacy Bazaar Shop (dev website 1, suspended) — identity only
fail=0
pass() { echo "ok   $*"; }
bad() { echo "FAIL $*"; fail=1; }
expect() { if eval "$2"; then pass "$1"; else bad "$1"; fi; }

TEMPLATE_HASH_BEFORE=$(cd "$ROOT" && find site -type f -exec sha256sum {} + | sort | sha256sum)

generate() {
  local name=$1
  mkdir -p "$OUT/$name"
  (cd "$ROOT" && tar --exclude=./node_modules --exclude=./.next --exclude='./.env*' --exclude=./test-results \
    --exclude=./dev/tls --exclude=./.git -cf - .) | (cd "$OUT/$name" && tar -xf -)
  cp -al "$ROOT/node_modules" "$OUT/$name/node_modules" || { echo "FAIL cannot link node_modules"; exit 1; }
}

rm -rf "$OUT"
generate site-a
generate site-b

# --- Site A: the template's own config (Karim Traders) + a footer customization -------------------
cat > "$OUT/site-a/site/customizations.tsx" <<'EOF'
import type { ReactNode } from "react";
export type HeroSlotProps = { name: string; tagline: string | null; shopHref: string; shopLabel: string };
export type FooterSlotProps = { name: string; lang: string };
export const customizations: {
  Hero?: (props: HeroSlotProps) => ReactNode;
  FooterNote?: (props: FooterSlotProps) => ReactNode;
  homeSections?: ("flashDeals" | "bestSellers" | "featured" | "newArrivals")[];
} = {
  FooterNote: () => "SITE-A-FOOTER-MARKER",
};
EOF

# --- Site B: another website's identity, its own host, theme and Hero; deliberately holding
#     site A's credential in its .env (a misuse the ERP must refuse) --------------------------------
# Public config only (schema v2): no credential, no ERP endpoint.
A_KEY=$(grep '^BANIJ_CREDENTIAL_KEY_ID=' "$ROOT/.env.local" | cut -d= -f2-)
[ -n "$A_KEY" ] || { echo "FAIL template .env.local lacks BANIJ_CREDENTIAL_KEY_ID (run dev/dev-env.mjs)"; exit 1; }
cat > "$OUT/site-b/site/site.config.json" <<EOF
{
  "schemaVersion": 2,
  "template": { "name": "banij-storefront", "version": "0.2.0" },
  "website": { "id": "$B_ID", "slug": "legacybazaar" },
  "domains": { "primary": "rb35vhxhcf.feriwala.shop", "aliases": [], "development": ["legacybazaar.localhost"] },
  "theme": { "preset": "minimal", "colors": { "primary": "#0f766e" } },
  "locale": { "default": "bn" },
  "features": { "flashDeals": false },
  "deployment": { "environment": "staging" }
}
EOF
cat > "$OUT/site-b/site/theme.css" <<'EOF'
:root { --radius: 0px; --site-b-token-marker: 1; }
EOF
cat > "$OUT/site-b/site/customizations.tsx" <<'EOF'
import type { ReactNode } from "react";
export type HeroSlotProps = { name: string; tagline: string | null; shopHref: string; shopLabel: string };
export type FooterSlotProps = { name: string; lang: string };
export const customizations: {
  Hero?: (props: HeroSlotProps) => ReactNode;
  FooterNote?: (props: FooterSlotProps) => ReactNode;
  homeSections?: ("flashDeals" | "bestSellers" | "featured" | "newArrivals")[];
} = {
  Hero: ({ name }) => <section data-slot="hero">SITE-B-HERO-MARKER {name}</section>,
  homeSections: ["newArrivals", "featured"],
};
EOF

echo "== building site-a and site-b independently"
for site in site-a site-b; do
  # Built with NO credential present: the image/build of an installation never contains one.
  if (cd "$OUT/$site" && env -u BANIJ_CREDENTIAL_KEY_ID -u BANIJ_CREDENTIAL_SECRET NEXT_TELEMETRY_DISABLED=1 npx next build > build.log 2>&1); then
    pass "$site builds on its own"
  else
    bad "$site build"; tail -20 "$OUT/$site/build.log"
    # Every later check depends on real build output; negative checks would pass vacuously.
    exit 1
  fi
done

echo "== build isolation"
in_build() { grep -rqF -- "$2" "$OUT/$1/.next/server" "$OUT/$1/.next/static" 2>/dev/null; }
expect "site-a build has its own customization" 'in_build site-a SITE-A-FOOTER-MARKER'
expect "site-a build has none of site-b's" '! in_build site-a SITE-B-HERO-MARKER && ! in_build site-a site-b-token-marker'
expect "site-b build has its own Hero and tokens" 'in_build site-b SITE-B-HERO-MARKER && in_build site-b site-b-token-marker'
expect "site-b build has none of site-a's" '! in_build site-b SITE-A-FOOTER-MARKER'
expect "site-a build carries only site-a's identity" 'in_build site-a $A_ID && ! in_build site-a $B_ID'
expect "site-b build carries only site-b's identity" 'in_build site-b $B_ID && ! in_build site-b $A_ID'
expect "template site/ untouched by generation" '[ "$(cd "$ROOT" && find site -type f -exec sha256sum {} + | sort | sha256sum)" = "$TEMPLATE_HASH_BEFORE" ]'
for site in site-a site-b; do
  expect "$site client bundle clean" '(cd "$OUT/$site" && bash dev/bundle-scan.sh > /dev/null)'
  expect "$site credential secret absent from build" '! grep -rqE "\b[0-9a-f]{64}\b" "$OUT/$site/.next/static"'
  expect "$site credential key id absent from build" '! in_build $site "$A_KEY"'
done

echo "== runtime (production builds, single-installation default mode)"
# Each installation gets its own server-side .env (0600), as an admin would type it in by hand.
# Site B deliberately receives site A's credential: the ERP must refuse it for B's host.
for site in site-a site-b; do
  (cd "$ROOT" && node dev/dev-env.mjs --website "$A_ID" --erp https://127.0.0.1:8443 --file "$OUT/$site/.env.local" > /dev/null)
done
expect "installation .env files are 0600" '[ "$(stat -c %a "$OUT/site-a/.env.local")" = 600 ] && [ "$(stat -c %a "$OUT/site-b/.env.local")" = 600 ]'
start() { # site port redis-db
  (cd "$OUT/$1" && env -u STOREFRONT_MODE NODE_ENV=production PORT=$2 HOSTNAME=127.0.0.1 \
    NODE_EXTRA_CA_CERTS="$ROOT/dev/tls/erp-dev.crt" STOREFRONT_REDIS_URL="redis://127.0.0.1:6379/$3" \
    setsid nohup npx next start -p "$2" -H 127.0.0.1 > "run.log" 2>&1 < /dev/null &)
}
bash "$ROOT/dev/free-port.sh" 3101 3102
start site-a 3101 9
start site-b 3102 10
for _ in $(seq 1 30); do sleep 1; curl -s -o /dev/null http://127.0.0.1:3101/api/health && curl -s -o /dev/null http://127.0.0.1:3102/api/health && break; done

code() { curl -s -o /tmp/bsf-body.html -w "%{http_code}" -H "Host: $2" "http://127.0.0.1:$1$3"; }
expect "A serves its own primary host"            '[ "$(code 3101 karimtraders.feriwala.shop /en)" = 200 ] && grep -q "Karim Traders Shop" /tmp/bsf-body.html'
expect "A renders its own customization"          'grep -q SITE-A-FOOTER-MARKER /tmp/bsf-body.html'
expect "A serves real ERP products"               '[ "$(code 3101 karimtraders.feriwala.shop /en/products/sylhet-premium-black-tea-400g)" = 200 ]'
expect "A: unknown product is 404"                '[ "$(code 3101 karimtraders.feriwala.shop /en/products/nope)" = 404 ]'
expect "A refuses site B's host"                  '[ "$(code 3101 rb35vhxhcf.feriwala.shop /en)" = 404 ]'
expect "A ignores dev hosts in production"        '[ "$(code 3101 karimtraders.localhost /en)" = 404 ]'
expect "A has no provisioning route"              '[ "$(code 3101 karimtraders.feriwala.shop /api/internal/registry)" = 404 ]'
expect "B holding A's credential serves nothing (ERP host_mismatch → 503)" \
  '[ "$(code 3102 rb35vhxhcf.feriwala.shop /en)" = 503 ] && ! grep -q "Karim Traders" /tmp/bsf-body.html'
expect "B refuses site A's host"                  '[ "$(code 3102 karimtraders.feriwala.shop /en)" = 404 ] && ! grep -q "Karim Traders" /tmp/bsf-body.html'
expect "A and B use separate Redis databases"     '[ "$(redis-cli -n 10 --scan --pattern "bsf:t:01M4MHJ7BA282X3QXV1Q256ZMP:*" | wc -l)" = 0 ]'

bash "$ROOT/dev/free-port.sh" 3101 3102
for site in site-a site-b; do shred -u "$OUT/$site/.env.local" 2>/dev/null || rm -f "$OUT/$site/.env.local"; done
redis-cli -n 9 flushdb > /dev/null; redis-cli -n 10 flushdb > /dev/null
echo "== done (generated projects kept in $OUT for inspection)"
exit $fail
