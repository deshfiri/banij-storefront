#!/usr/bin/env bash
# DEVELOPMENT ONLY. Shows whether the running dev server serves the current globals.css.
html=$(curl -s -H "Host: karimtraders.localhost:3000" http://127.0.0.1:3000/en)
for href in $(grep -oE '/_next/static/[^"]+\.css' <<< "$html" | sort -u); do
  css=$(curl -s -H "Host: karimtraders.localhost:3000" "http://127.0.0.1:3000$href")
  printf '%s  bytes=%s page-container=%s icon-btn=%s font-inter=%s surface-2=%s\n' "$href" "${#css}" \
    "$(grep -c 'page-container' <<< "$css")" "$(grep -c 'icon-btn' <<< "$css")" "$(grep -c 'font-inter' <<< "$css")" "$(grep -c 'surface-2' <<< "$css")"
done
echo "--- recent CSS-related log lines"
grep -iE 'css|tailwind|postcss|parse error|syntax' /tmp/bsf-next.log | tail -8 | cut -c1-200
