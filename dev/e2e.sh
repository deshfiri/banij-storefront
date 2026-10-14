#!/usr/bin/env bash
# DEVELOPMENT ONLY. Runs the Playwright E2E suite against the running dev storefront.
# WSL lacks Chromium's NSS/ALSA libraries; they are extracted (no sudo) to ~/.cache/bsf-chromium-libs.
set -euo pipefail
cd "$(dirname "$0")/.."
export LD_LIBRARY_PATH="$HOME/.cache/bsf-chromium-libs/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec npx playwright test "$@"
