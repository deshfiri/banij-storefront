#!/usr/bin/env bash
# Fails if anything server-side appears in the browser bundle. Run after `next build`.
#   bash dev/bundle-scan.sh [env file whose secret VALUES must not appear]   (default: ./.env.local)
set -uo pipefail
ENV_FILE="$(realpath "${1:-.env.local}" 2>/dev/null || echo "${1:-.env.local}")"
cd "$(dirname "$0")/.."
status=0
for needle in "wsk_" "encryptedSecret" "Feriwala-HMAC" "X-Feriwala-Nonce" "STOREFRONT_REGISTRY_KEY" "STOREFRONT_REDIS_URL" "ERP_BASE_URL" "bsf:registry" "createCipheriv" "/api/storefront/v1" \
  "STOREFRONT_PROVISIONING" "x-banij-signature" "sealed_secret" "banij-storefront-provisioning" \
  "BANIJ_CREDENTIAL" "BANIJ_ERP_BASE_URL"; do
  hits=$(grep -rlF -- "$needle" .next/static 2>/dev/null | wc -l)
  echo "$needle: $hits file(s)"
  [ "$hits" -eq 0 ] || status=1
done
if [ -f "$ENV_FILE" ]; then
  for name in BANIJ_CREDENTIAL_SECRET BANIJ_CREDENTIAL_KEY_ID BANIJ_ERP_BASE_URL STOREFRONT_REGISTRY_KEY STOREFRONT_PROVISIONING_SECRET STOREFRONT_PROVISIONING_PRIVATE_KEY; do
    value=$(grep "^$name=" "$ENV_FILE" | cut -d= -f2-)
    [ -n "$value" ] || continue
    hits=$(grep -rlF -- "$value" .next/static 2>/dev/null | wc -l)
    echo "$name value: $hits file(s)"
    [ "$hits" -eq 0 ] || status=1
  done
fi
[ "$status" -eq 0 ] && echo "BUNDLE CLEAN" || echo "BUNDLE LEAK"
exit $status
