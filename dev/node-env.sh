#!/usr/bin/env bash
# DEVELOPMENT ONLY. Sourced by dev scripts: makes node/npx available from non-interactive shells
# (nvm is normally loaded by ~/.bashrc only in interactive shells).
if ! command -v npx > /dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi
command -v npx > /dev/null 2>&1 || { echo "node/npx not found (nvm?)" >&2; exit 1; }
