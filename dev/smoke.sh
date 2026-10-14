#!/usr/bin/env bash
# DEVELOPMENT ONLY. Smoke-tests the running dev storefront against the dev ERP.
# Usage: dev/smoke.sh [host]   (default karimtraders.localhost:3000)
set -u
HOST="${1:-karimtraders.localhost:3000}"
BASE="http://127.0.0.1:3000"

for path in / /en /bn /en/products "/en/products?sort=price_asc" "/en/products?q=tea" "/en/products?flash_deal=true" \
  /en/products/BSFTEA001 /en/products/does-not-exist /en/cart /robots.txt /sitemap.xml; do
  code=$(curl -s -o /tmp/bsf-smoke.html -w "%{http_code} %{redirect_url}" -H "Host: $HOST" "$BASE$path")
  echo "$path -> $code"
done

echo "--- unknown host"
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: evil.localhost:3000" "$BASE/en"
echo "--- malformed host"
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: karimtraders.localhost:3000@evil.com" "$BASE/en"
echo "--- forged X-Forwarded-Host is ignored (unknown Host still 404)"
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: evil.localhost:3000" -H "X-Forwarded-Host: karimtraders.localhost:3000" "$BASE/en"
