#!/usr/bin/env bash
# DEVELOPMENT ONLY. Proves (or disproves, with the real error) that Next.js's server-side image
# optimizer can fetch ERP media from WSL, using a THROWAWAY local instance on 127.0.0.1:3204 with a
# candidate STOREFRONT_IMAGE_ORIGIN. Does not touch the :3000 dev site or its configuration.
#   bash dev/image-pipeline-check.sh <candidate origin> <media path under it>
#   e.g. bash dev/image-pipeline-check.sh http://127.0.0.1:8000/storage/ catalog/products/…/x.webp
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/dev/node-env.sh"
ORIGIN="${1:?candidate origin}"; MEDIA="${2:?media path}"
OUT="$HOME/.cache/bsf-generated/image-test"; PORT=3204
fail=0
ok() { echo "ok   $*"; }
bad() { echo "FAIL $*"; fail=1; }

rm -rf "$OUT"; mkdir -p "$OUT"
(cd "$ROOT" && tar --exclude=./node_modules --exclude=./.next --exclude='./.env*' --exclude=./test-results \
  --exclude=./dev/tls --exclude=./.git -cf - .) | (cd "$OUT" && tar -xf -)
cp -al "$ROOT/node_modules" "$OUT/node_modules"
(cd "$ROOT" && node dev/dev-env.mjs --website 01M4MHJ7BA282X3QXV1Q256ZMP --erp https://127.0.0.1:8443 --file "$OUT/.env.local" > /dev/null)
bash "$ROOT/dev/free-port.sh" $PORT
(cd "$OUT" && env -u STOREFRONT_MODE STOREFRONT_IMAGE_ORIGIN="$ORIGIN" NODE_EXTRA_CA_CERTS="$ROOT/dev/tls/erp-dev.crt" \
  STOREFRONT_REDIS_URL=redis://127.0.0.1:6379/13 STOREFRONT_PUBLIC_SCHEME=http STOREFRONT_PUBLIC_PORT=$PORT STOREFRONT_INSECURE_COOKIES=true \
  setsid nohup npx next dev -p $PORT -H 127.0.0.1 > dev.log 2>&1 < /dev/null &)
for _ in $(seq 1 60); do sleep 1; curl -s -o /dev/null "http://127.0.0.1:$PORT/api/health" && break; done

opt() { # url → status content-type bytes, body kept for errors
  curl -s -o /tmp/bsf-img.bin -D /tmp/bsf-img.h -w "%{http_code} %{content_type} %{size_download}" \
    -H "Accept: image/avif,image/webp,*/*" "http://127.0.0.1:$PORT/_next/image?url=$(node -p 'encodeURIComponent(process.argv[1])' "$1")&w=640&q=75"
}
GOOD="${ORIGIN%/}/$MEDIA"
result=$(opt "$GOOD"); echo "optimizer ← $GOOD : $result"
if [[ "$result" == 200\ image/webp* ]] && [ "$(head -c 4 /tmp/bsf-img.bin)" = "RIFF" ]; then
  ok "Next.js fetched and served the ERP image as WebP ($(stat -c %s /tmp/bsf-img.bin) bytes)"
else
  bad "optimizer did not serve the image — body: $(head -c 300 /tmp/bsf-img.bin | tr -d '\0')"
fi
# Negative controls: anything outside the exact trusted origin must be refused.
for url in "http://localhost/storage/$MEDIA" "http://127.0.0.1:8001/storage/$MEDIA" "https://example.com/storage/x.webp" "http://127.0.0.1:8000/other/x.webp"; do
  r=$(opt "$url")
  if [[ "$r" == 400* ]]; then ok "refused untrusted $url → $r ($(head -c 80 /tmp/bsf-img.bin))"; else bad "untrusted $url → $r"; fi
done
grep -iE "upstream image|private|ECONNREFUSED|failed|error" "$OUT/dev.log" | grep -iv "home section failed" | tail -5 | sed 's/^/log: /'

bash "$ROOT/dev/free-port.sh" $PORT
shred -u "$OUT/.env.local" 2>/dev/null || rm -f "$OUT/.env.local"
redis-cli -n 13 flushdb > /dev/null
exit $fail
