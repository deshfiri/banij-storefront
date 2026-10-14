#!/usr/bin/env bash
# DEVELOPMENT ONLY. Asserts HTTP status codes of security- and SEO-relevant routes on the dev server.
set -u
HOST="${HOST:-karimtraders.localhost:3000}"
BASE="http://127.0.0.1:3000"
fail=0
check() {
  local expected="$1" path="$2" host="${3:-$HOST}"
  local got
  got=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: $host" "$BASE$path")
  if [ "$got" = "$expected" ]; then echo "ok   $expected $host$path"; else echo "FAIL $got (want $expected) $host$path"; fail=1; fi
}
check 200 /en
check 200 /bn
check 200 /en/products
check 200 /en/products/sylhet-premium-black-tea-400g
check 404 /en/products/does-not-exist
check 404 "/en/products/..%2f..%2fsite"
check 404 /en/categories/does-not-exist
check 404 /en/orders/01M4T0960T4XYMZ2T4PM0DBYR4
check 404 /en/orders/not-an-id
check 307 /xx/products
check 307 /
check 200 /en/cart
check 307 /en/checkout
check 200 /robots.txt
check 200 /sitemap.xml
check 404 /en evil.localhost:3000
check 404 /en 127.0.0.1:3000
check 404 /en "karimtraders.localhost:3000@evil.com"
check 404 /api/areas evil.localhost:3000
check 404 /api/internal/registry
check 404 /en registry.localhost
check 404 /api/internal/registry registry.localhost
exit $fail
