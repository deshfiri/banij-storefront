#!/usr/bin/env bash
# Builds a new release of the PRIVATE PREVIEW installation from this development repository and
# makes it `current` — without touching the development repo, the :3000 dev server, the ERP, DNS,
# Cloudflare or any service. See docs/private-preview-plan.md (steps 1–2).
#
#   bash dev/preview-deploy.sh            # build + verify + switch `current`
#   PREVIEW_ROOT=/path bash dev/preview-deploy.sh
#
# Layout (dirs 0700):
#   $PREVIEW_ROOT/shared/site.config.json   public config of the preview installation (no secrets)
#   $PREVIEW_ROOT/shared/.env               server-side credentials — NOT created here (needs approval)
#   $PREVIEW_ROOT/releases/<timestamp>/     self-contained build (own node_modules, own .next)
#   $PREVIEW_ROOT/current -> releases/<timestamp>
#
# Never copied: .env*, dev/tls, .git, node_modules, .next, test results. The release is verified to
# contain no credential value of the development .env.local before it becomes `current`.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
. "$SRC/dev/node-env.sh"
PREVIEW_ROOT="${PREVIEW_ROOT:-$HOME/preview/banij-storefront}"
KEEP_RELEASES=3
STAMP="$(date +%Y%m%d%H%M%S)"
RELEASE="$PREVIEW_ROOT/releases/$STAMP"
log() { printf '[preview-deploy] %s\n' "$*"; }
die() { printf '[preview-deploy] FAIL %s\n' "$*" >&2; rm -rf "$RELEASE"; exit 1; }

umask 077
mkdir -p "$PREVIEW_ROOT/releases" "$PREVIEW_ROOT/shared"
chmod 700 "$PREVIEW_ROOT" "$PREVIEW_ROOT/releases" "$PREVIEW_ROOT/shared"

# Public configuration of the preview installation (created once; edited by hand afterwards).
if [ ! -f "$PREVIEW_ROOT/shared/site.config.json" ]; then
  cat > "$PREVIEW_ROOT/shared/site.config.json" <<'EOF'
{
  "schemaVersion": 2,
  "template": { "name": "banij-storefront", "version": "0.2.0" },
  "website": { "id": "01M4MHJ7BA282X3QXV1Q256ZMP", "slug": "karimtraders" },
  "domains": { "primary": "karimtraders-preview.deshfiri.com", "aliases": [], "development": [] },
  "theme": { "colors": {} },
  "locale": {},
  "features": {},
  "deployment": { "environment": "staging" }
}
EOF
  log "created shared/site.config.json (public config, no secrets)"
fi

log "release $STAMP: copying sources (no .env*, no dev/tls, no .git)"
mkdir -p "$RELEASE"
(cd "$SRC" && tar --exclude=./node_modules --exclude=./.next --exclude='./.env*' --exclude=./dev/tls \
  --exclude=./.git --exclude=./test-results --exclude=./playwright-report -cf - .) | (cd "$RELEASE" && tar -xf -)
# .env.example is documentation only and harmless, but the release needs none of it.
rm -f "$RELEASE/.env.example"
if find "$RELEASE" -name '.env*' -print -quit | grep -q .; then die "an .env file reached the release"; fi
[ ! -e "$RELEASE/dev/tls" ] || die "dev TLS material reached the release"

log "installing dependencies (own node_modules)"
(cd "$RELEASE" && npm ci --no-audit --no-fund --prefer-offline > "$RELEASE/.npm-ci.log" 2>&1) || die "npm ci (see $RELEASE/.npm-ci.log)"

log "unit tests (template config)"
(cd "$RELEASE" && npx vitest run tests/unit > "$RELEASE/.unit.log" 2>&1) || die "unit tests (see $RELEASE/.unit.log)"

log "applying preview public config and building (STOREFRONT_PREVIEW=true)"
cp "$PREVIEW_ROOT/shared/site.config.json" "$RELEASE/site/site.config.json"
(cd "$RELEASE" && env -u BANIJ_ERP_BASE_URL -u BANIJ_CREDENTIAL_KEY_ID -u BANIJ_CREDENTIAL_SECRET \
  STOREFRONT_PREVIEW=true NEXT_TELEMETRY_DISABLED=1 npx next build > "$RELEASE/.build.log" 2>&1) || die "build (see $RELEASE/.build.log)"

log "verifying the release holds no credential"
(cd "$RELEASE" && bash dev/bundle-scan.sh "$SRC/.env.local" > "$RELEASE/.bundle-scan.log" 2>&1) || die "bundle scan (see $RELEASE/.bundle-scan.log)"
for name in BANIJ_CREDENTIAL_SECRET BANIJ_CREDENTIAL_KEY_ID STOREFRONT_REGISTRY_KEY STOREFRONT_PROVISIONING_SECRET STOREFRONT_PROVISIONING_PRIVATE_KEY; do
  value=$(grep "^$name=" "$SRC/.env.local" 2>/dev/null | cut -d= -f2- || true)
  [ -n "$value" ] || continue
  if grep -rqF --exclude-dir=node_modules -- "$value" "$RELEASE"; then die "$name value found in the release"; fi
done
grep -q '"primary": "karimtraders-preview.deshfiri.com"' "$RELEASE/site/site.config.json" || die "preview config not applied"

log "switching current -> releases/$STAMP"
ln -sfn "releases/$STAMP" "$PREVIEW_ROOT/current.tmp"
mv -Tf "$PREVIEW_ROOT/current.tmp" "$PREVIEW_ROOT/current"

# Keep the newest releases for rollback.
ls -1d "$PREVIEW_ROOT"/releases/*/ 2>/dev/null | sort | head -n -"$KEEP_RELEASES" | xargs -r rm -rf

log "done. Not started: running the preview needs shared/.env (approved credential) and a service — see docs/private-preview-plan.md steps 3–9."
