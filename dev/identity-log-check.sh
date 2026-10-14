#!/usr/bin/env bash
# DEVELOPMENT ONLY. Runs the identity tests and proves their operator log lines carry no secret:
# neither the credential secret, nor the full key id, nor the wrong secret the tests inject.
set -uo pipefail
cd "$(dirname "$0")/.."
. dev/node-env.sh
out=$(mktemp)
RUN_ERP_INTEGRATION=1 NODE_EXTRA_CA_CERTS="$PWD/dev/tls/erp-dev.crt" \
  npx vitest run tests/integration/identity.test.ts --silent=false > "$out" 2>&1
grep -o '{"at":[^}]*"channel":"identity"[^}]*}' "$out" | sed -E 's/"at":"[^"]*",//' | sort | uniq -c
secret=$(grep '^BANIJ_CREDENTIAL_SECRET=' .env.local | cut -d= -f2-)
key=$(grep '^BANIJ_CREDENTIAL_KEY_ID=' .env.local | cut -d= -f2-)
[ ${#secret} -eq 64 ] && [ ${#key} -eq 30 ] || { echo "FAIL could not read dev credential for the check"; exit 1; }
leaks=0
grep -qF -- "$secret" "$out" && { echo "FAIL secret in output"; leaks=1; }
grep -qF -- "$key" "$out" && { echo "FAIL full key id in output"; leaks=1; }
grep -qF -- "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" "$out" && { echo "FAIL injected secret in output"; leaks=1; }
grep -E "Tests +[0-9]" "$out"
rm -f "$out"
[ $leaks -eq 0 ] && echo "LOGS CLEAN (no secret, no full key id)"
exit $leaks
