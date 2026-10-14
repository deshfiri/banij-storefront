#!/usr/bin/env bash
# DEVELOPMENT ONLY. Runs the live-ERP integration tests (places one order in the dev ERP).
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_EXTRA_CA_CERTS="$PWD/dev/tls/erp-dev.crt"
export RUN_ERP_INTEGRATION=1
# Serial: the files share the live registry and site cache.
exec npx vitest run tests/integration --no-file-parallelism "$@"
