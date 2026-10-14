#!/usr/bin/env bash
# DEVELOPMENT ONLY. Proves the production boot guard (src/instrumentation.ts) on a real `next start`:
# a misconfigured installation refuses to start, and the error names the variable, never a value.
# Requires a production build in .next (npx next build). Uses port 3199. Places no orders.
set -uo pipefail
cd "$(dirname "$0")/.."
. dev/node-env.sh
fail=0
secret=$(grep '^BANIJ_CREDENTIAL_SECRET=' .env.local | cut -d= -f2-)

boot() { # label, expected (refuse|serve), env assignments...
  local label=$1 expected=$2; shift 2
  bash dev/free-port.sh 3199
  local log; log=$(mktemp)
  env "$@" NODE_ENV=production NODE_EXTRA_CA_CERTS="$PWD/dev/tls/erp-dev.crt" timeout 25 npx next start -p 3199 -H 127.0.0.1 > "$log" 2>&1 &
  local pid=$!
  local up=no
  for _ in $(seq 1 20); do
    sleep 1
    if curl -s -o /dev/null http://127.0.0.1:3199/api/health; then up=yes; break; fi
    kill -0 "$pid" 2>/dev/null || break
  done
  bash dev/free-port.sh 3199
  wait "$pid" 2>/dev/null
  if [ -n "$secret" ] && grep -qF -- "$secret" "$log"; then echo "FAIL $label: secret printed"; fail=1; fi
  if [ "$expected" = refuse ] && [ "$up" = no ]; then
    echo "ok   $label refused to boot: $(grep -oE '(Installation environment[^"]*|STOREFRONT_MODE=shared[^"]*|STOREFRONT_IMAGE_ORIGIN differs[^"]*)' "$log" | head -1)"
  elif [ "$expected" = serve ] && [ "$up" = yes ]; then
    echo "ok   $label boots and serves /api/health"
  else
    echo "FAIL $label (expected $expected, up=$up)"; tail -5 "$log"; fail=1
  fi
  rm -f "$log"
}

boot "valid installation"            serve
boot "missing credential secret"     refuse BANIJ_CREDENTIAL_SECRET=
boot "malformed key id"              refuse BANIJ_CREDENTIAL_KEY_ID=not-a-key
boot "plain-HTTP ERP"                refuse BANIJ_ERP_BASE_URL=http://127.0.0.1:8001
boot "shared mode in production"     refuse STOREFRONT_MODE=shared
boot "image origin not the built one" refuse STOREFRONT_IMAGE_ORIGIN=https://media.example.com/storage/
exit $fail
