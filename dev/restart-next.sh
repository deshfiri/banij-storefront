#!/usr/bin/env bash
# DEVELOPMENT ONLY. Restarts the Next dev server on 127.0.0.1:3000 with the dev ERP TLS root.
set -u
cd "$(dirname "$0")/.."
. dev/node-env.sh
pkill -f "next dev -p 3000" 2>/dev/null
sleep 1
NODE_EXTRA_CA_CERTS="$PWD/dev/tls/erp-dev.crt" setsid nohup npx next dev -p 3000 -H 127.0.0.1 > /tmp/bsf-next.log 2>&1 < /dev/null &
disown
for _ in $(seq 1 30); do
  sleep 1
  curl -s -o /dev/null -H "Host: karimtraders.localhost:3000" http://127.0.0.1:3000/en && break
done
echo "next dev restarted"
