#!/usr/bin/env bash
# DEVELOPMENT ONLY. The complete no-order regression. Never writes ERP data:
#   - ALLOW_ERP_ORDERS is forced off, so order-placing tests skip or stop at the quote.
# Requires: dev ERP TLS shim on :8443/:8001 and the dev server on :3000 (dev/restart-next.sh).
set -uo pipefail
cd "$(dirname "$0")/.."
. dev/node-env.sh
unset ALLOW_ERP_ORDERS
export E2E_NO_ORDER=1
results=()
run() { # name, command...
  local name=$1; shift
  local log="/tmp/bsf-regression-${name// /-}.log"
  if "$@" > "$log" 2>&1; then results+=("PASS  $name"); else results+=("FAIL  $name   (log: $log)"); fi
  echo "--- $name"; grep -E "Tests +[0-9]|passed|failed|skipped|^ok|^FAIL|BUNDLE|Compiled|error TS|problem" "$log" | grep -v "^ok " | tail -6
}

run "typecheck"            npx tsc --noEmit
run "lint"                 npx eslint src site
run "unit"                 npx vitest run tests/unit
run "integration"          bash dev/integration.sh
run "identity logs clean"  bash dev/identity-log-check.sh
run "mode probe"           bash -c 'bash dev/mode-probe.sh | grep -q "^single-installation"'
run "status codes"         bash dev/status-codes.sh
run "e2e (no order)"       bash dev/e2e.sh
run "independent builds"   bash dev/independent-builds.sh
run "single-site e2e"      bash dev/single-site-e2e.sh
run "preview runtime + ERP unchanged" bash dev/preview-runtime-check.sh
run "preview copy has no credential"  bash dev/preview-copy-check.sh
run "production build"     npx next build
run "production boot guard" bash dev/boot-check.sh
run "bundle scan"          bash dev/bundle-scan.sh

echo
echo "===== regression summary"
printf '%s\n' "${results[@]}"
printf '%s\n' "${results[@]}" | grep -q '^FAIL' && exit 1 || exit 0
