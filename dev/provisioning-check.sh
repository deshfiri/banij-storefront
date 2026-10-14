#!/usr/bin/env bash
# DEVELOPMENT ONLY. Exercises the ERP → storefront provisioning channel against the dev server,
# using the reference sender in place of the ERP. Never prints a secret.
set -u
cd "$(dirname "$0")/.."
W=01M4MHJ7BA282X3QXV1Q256ZMP
OTHER=01M4MH9Z0JXPDX8300NHCKERGP
H=karimtraders.feriwala.shop
send() { node scripts/provision-send.mjs "$@"; }

echo "== 1. move website 2 onto the channel (revision 10, credential checked against the ERP)"
send upsert --website $W --revision 10 --primary $H --subdomain $H --from-registry
echo "== 2. same revision again → unchanged"
send upsert --website $W --revision 10 --primary $H --subdomain $H --from-registry
echo "== 3. older revision → stale, nothing changes"
send upsert --website $W --revision 9 --primary $H --subdomain $H --from-registry
echo "== 4. identical signed request sent twice → second refused as replay"
send upsert --website $W --revision 11 --primary $H --subdomain $H --from-registry --twice
echo "== 5. website 2's credential presented as website 1's → refused (ERP host_mismatch), registry untouched"
send upsert --website $OTHER --revision 1 --primary rb35vhxhcf.feriwala.shop --subdomain rb35vhxhcf.feriwala.shop --from-registry-of $W 2>&1 | tail -1
echo "== 6. through a public shop host → 404"
# A website id that does not exist, so even a wrongly accepted request could not remove a real shop.
NOBODY=01M4ZZZZZZZZZZZZZZZZZZZZZZ
send remove --website $NOBODY --revision 99 --host karimtraders.localhost
echo "== 7. wrong HMAC secret → 401"
STOREFRONT_PROVISIONING_SECRET=$(head -c 32 /dev/urandom | base64) send remove --website $NOBODY --revision 99
echo "== registry now"
node scripts/registry.mjs show --website $W
