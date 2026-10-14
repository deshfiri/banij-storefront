#!/usr/bin/env bash
# DEVELOPMENT ONLY. Reports, without hiding errors, whether an ERP media URL is reachable from WSL —
# by curl and by Node's fetch (what the Next.js image optimizer uses). Read-only (GET/HEAD only).
#   bash dev/image-reachability.sh <media path, e.g. /storage/catalog/products/…/x.webp>
set -u
cd "$(dirname "$0")/.."
. dev/node-env.sh
PATH_PART="${1:?media path required}"
for origin in "http://localhost" "http://127.0.0.1" "http://localhost:8000" "http://127.0.0.1:8000" "http://127.0.0.1:8001"; do
  url="$origin$PATH_PART"
  printf '%-30s curl: %s\n' "$origin" "$(curl -sS -o /dev/null -w '%{http_code} %{content_type} %{size_download}B' --max-time 8 "$url" 2>&1)"
  node -e '
    const url = process.argv[1];
    fetch(url, { signal: AbortSignal.timeout(8000) })
      .then(async (r) => { const b = Buffer.from(await r.arrayBuffer()); console.log(`${" ".repeat(31)}node: ${r.status} ${r.headers.get("content-type")} ${b.length}B magic=${b.subarray(0, 4).toString("latin1")}${b.subarray(8, 12).toString("latin1")}`); })
      .catch((e) => console.log(`${" ".repeat(31)}node: ERROR ${e.cause?.code ?? ""} ${e.cause?.message ?? e.message}`));
  ' "$url"
done
echo "--- name resolution in WSL"
getent ahosts localhost | awk '{print $1}' | sort -u | tr '\n' ' '; echo
echo "--- port 80 listener"
ss -ltnp 2>/dev/null | grep -E ':80 ' || echo "(process not visible to this user)"
