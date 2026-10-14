#!/usr/bin/env bash
# DEVELOPMENT ONLY. Checks the running :3000 dev storefront's image optimizer: the trusted ERP image
# returns 200 WebP; anything outside STOREFRONT_IMAGE_ORIGIN is refused. Read-only.
set -u
cd "$(dirname "$0")/.."
. dev/node-env.sh
MEDIA="${1:?media path under the origin}"
ORIGIN=$(grep '^STOREFRONT_IMAGE_ORIGIN=' .env.local | cut -d= -f2-)
fail=0
opt() {
  curl -s -o /tmp/bsf-live-img.bin -w "%{http_code} %{content_type} %{size_download}B" \
    -H "Accept: image/avif,image/webp,*/*" "http://127.0.0.1:3000/_next/image?url=$(node -p 'encodeURIComponent(process.argv[1])' "$1")&w=${2:-640}&q=75"
}
r=$(opt "${ORIGIN}${MEDIA}")
magic=$(head -c 4 /tmp/bsf-live-img.bin)
echo "trusted  ${ORIGIN}${MEDIA} → $r magic=$magic"
[[ "$r" == 200\ image/webp* && "$magic" == RIFF ]] && echo "ok   optimizer serves the trusted ERP image as WebP" || { echo "FAIL trusted image — body: $(head -c 300 /tmp/bsf-live-img.bin)"; fail=1; }
for url in \
  "http://127.0.0.1:8000/storage/$MEDIA" \
  "http://localhost/storage/$MEDIA" \
  "http://localhost:8001/storage/$MEDIA" \
  "https://localhost:8000/storage/$MEDIA" \
  "http://localhost:8000/other/x.webp" \
  "http://localhost:8000/.env" \
  "https://example.com/storage/x.webp" \
  "http://169.254.169.254/latest/meta-data/"; do
  r=$(opt "$url")
  if [[ "$r" == 400* ]]; then echo "ok   blocked $url → $r ($(head -c 40 /tmp/bsf-live-img.bin))"; else echo "FAIL not blocked: $url → $r"; fail=1; fi
done
exit $fail
