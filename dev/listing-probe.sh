#!/usr/bin/env bash
# DEVELOPMENT ONLY. Shows which catalogue listing variants the dev ERP currently answers.
for q in "" "sort=newest" "sort=featured" "featured=true" "flash_deal=true" "sort=price_asc" "sort=best_selling" "in_stock=true"; do
  page=$(curl -s -H "Host: karimtraders.localhost:3000" "http://127.0.0.1:3000/en/products?$q")
  errors=$(grep -c "Something went wrong" <<< "$page")
  products=$(grep -o 'href="/en/products/[a-z0-9-]*"' <<< "$page" | sort -u | wc -l)
  echo "products?$q -> error=$errors products=$products"
done
echo "--- last ERP SQL error (if any)"
grep -o "SQLSTATE\[[^]]*\][^\\\\]\{0,140\}" ~/projects/feriwala/storage/logs/laravel.log | tail -2
