#!/usr/bin/env bash
# DEVELOPMENT ONLY. Shows which mode the :3000 dev server is in, without reading any secret:
# in single-installation mode the legacy registry is not consulted, so a host that exists ONLY in
# the registry (karimtraders.feriwala.shop is both registry and config primary; a registry-only alias
# is simulated with a temporary key) must be a 404.
set -u
probe_host="registry-only-probe.feriwala.shop"
redis-cli -n 8 set "bsf:registry:host:$probe_host" 01M4MHJ7BA282X3QXV1Q256ZMP EX 60 > /dev/null
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: $probe_host" http://127.0.0.1:3000/en)
redis-cli -n 8 del "bsf:registry:host:$probe_host" > /dev/null
if [ "$code" = "404" ]; then echo "single-installation mode (registry ignored: $code)"; else echo "registry consulted ($code) — legacy shared mode"; fi
