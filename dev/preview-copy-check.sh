#!/usr/bin/env bash
# DEVELOPMENT ONLY. Proves the preview copy ($PREVIEW_ROOT/current) carries no credential: started
# with nothing but its own files, the production boot guard must refuse to start. Uses local port
# 3202 briefly; leaves nothing running.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/dev/node-env.sh"
PREVIEW_ROOT="${PREVIEW_ROOT:-$HOME/preview/banij-storefront}"
CURRENT="$PREVIEW_ROOT/current"
fail=0
ok() { echo "ok   $*"; }
bad() { echo "FAIL $*"; fail=1; }

[ -d "$CURRENT/.next" ] || { echo "FAIL no preview build at $CURRENT"; exit 1; }
[ "$(stat -c %a "$PREVIEW_ROOT")" = 700 ] && ok "preview root is 0700" || bad "preview root permissions"
[ ! -e "$PREVIEW_ROOT/shared/.env" ] && ok "no shared/.env (credential not yet approved)" || bad "shared/.env exists"
find -L "$CURRENT" -path "$CURRENT/node_modules" -prune -o -name '.env*' -print | grep -q . && bad ".env file in release" || ok "no .env* in the release"
[ ! -e "$CURRENT/dev/tls" ] && ok "no dev TLS material in the release" || bad "dev/tls in release"
[ -z "$(git -C "$CURRENT" rev-parse --git-dir 2>/dev/null)" ] && ok "release is not a git checkout of the dev repo" || bad "release is a git tree"
grep -q '"primary": "karimtraders-preview.deshfiri.com"' "$CURRENT/site/site.config.json" && ok "preview public config compiled in" || bad "preview config"
grep -rqF "noindex, nofollow, noarchive" "$CURRENT/.next/routes-manifest.json" "$CURRENT/.next/required-server-files.json" 2>/dev/null \
  && ok "build carries the static-asset X-Robots-Tag header" || bad "X-Robots-Tag not in build headers"

bash "$ROOT/dev/free-port.sh" 3202
log=$(mktemp)
# A clean environment: no BANIJ_* inherited from this shell; only what the copy itself holds.
(cd "$CURRENT" && env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production STOREFRONT_PREVIEW=true \
  timeout 25 npx next start -p 3202 -H 127.0.0.1 > "$log" 2>&1 &)
up=no
for _ in $(seq 1 15); do
  sleep 1
  curl -s -o /dev/null http://127.0.0.1:3202/api/health && { up=yes; break; }
done
bash "$ROOT/dev/free-port.sh" 3202
if [ "$up" = no ] && grep -q "refusing to start: Installation environment missing or malformed" "$log"; then
  ok "preview copy refuses to start without a credential: $(grep -o 'Installation environment[^"]*' "$log" | head -1)"
else
  bad "preview copy started or failed differently (up=$up)"; tail -5 "$log"
fi
rm -f "$log"
exit $fail
