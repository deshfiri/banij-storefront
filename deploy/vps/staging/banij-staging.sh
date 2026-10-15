#!/usr/bin/env bash
# Approval-gated installer for the Karim Traders STAGING storefront on the aaPanel VPS.
#
#   sudo bash banij-staging.sh <phase>          one phase at a time, each only after approval
#
# Read-only phases:  preflight  old-inspect  env-check  verify  nginx-check  exposure-check
# Write phases:      backup  user  redis  deploykey  env-init  build  activate  nginx-include
# Old deployment:    old-backup (verified archive)  old-quarantine (move out of the web root)
#                    old-restore <backup dir>  — nothing is deleted by this script
# Rollback:          rollback <service|release|redis|nginx|all> [--purge]
#
# Everything lives under /www/server/banij-storefront-staging (outside the web root). The only files
# written elsewhere are two systemd units (/etc/systemd/system/banij-*-staging.service), backups in
# /root/banij-staging-backups, and — only in `nginx-include`, the fallback to aaPanel's reverse-proxy
# UI — one include line in the staging site's vhost, with automatic restore if `nginx -t` fails.
# Never touched: aaPanel placeholder files and .user.ini, other sites, mail, databases, shared Redis.
# Secrets are never printed, never passed on a command line, never written outside 0600 files.
set -euo pipefail
umask 077

SITE=staging.deshfiri.com
BASE=/www/server/banij-storefront-staging
APP=$BASE/app
SHARED=$BASE/shared
REDIS_DIR=$BASE/redis
HOMEDIR=$BASE/home
NGINX_DIR=$BASE/nginx
BACKUPS=/root/banij-staging-backups
NODE_BIN=/www/server/nodejs/v24.14.0/bin
REPO=git@github.com:deshfiri/banij-storefront.git
BRANCH=staging/karimtraders
WEBSITE_ID=01M4MHJ7BA282X3QXV1Q256ZMP
APP_PORT=3100
REDIS_PORT=6380
SVC=banij-storefront-staging
REDIS_SVC=banij-redis-staging
VHOST=/www/server/panel/vhost/nginx/$SITE.conf
WEBROOT=/www/wwwroot/$SITE
NGINX=/www/server/nginx/sbin/nginx
NGINX_RELOAD=(/etc/init.d/nginx reload)
# aaPanel-managed entries of the site's web root: never moved, never changed.
KEEP=(.user.ini .htaccess .well-known 404.html 502.html index.html)
# GitHub's published SSH host key (https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints)
GITHUB_HOSTKEY='github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'

die() { echo "ERROR: $*" >&2; exit 1; }
ok() { echo "ok   $*"; }
note() { echo "--   $*"; }
need_root() { [ "$(id -u)" -eq 0 ] || die "run as root: sudo bash $0 $*"; }
listening() { ss -ltnH "sport = :$1" | grep -q .; }
as_banij() { runuser -u banij -- env HOME="$HOMEDIR" PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin" "$@"; }
env_value() { sed -n "s/^$1=//p" "$SHARED/.env" | tail -1; }   # used internally only, never echoed
# Newest COMPLETE vhost backup (plain timestamp directory); never an old-webroot, contain or partial one.
latest_backup() {
  local d
  for d in $({ ls -1d "$BACKUPS"/[0-9]*-[0-9]* 2>/dev/null || true; } | sort -r); do
    [[ "$(basename "$d")" =~ ^[0-9]{8}-[0-9]{6}$ ]] && [ -f "$d/COMPLETE" ] && [ -f "$d/vhost.conf" ] && { echo "$d"; return 0; }
  done
  return 0
}

redis_bin() {
  local bin
  bin=$(sed -n 's/^EXEC=//p' /etc/init.d/redis 2>/dev/null | tr -d "\"'" | head -1)
  [ -n "$bin" ] || bin=/www/server/redis/src/redis-server
  echo "$bin"
}

# ---- read-only ---------------------------------------------------------------------------------

preflight() {
  need_root preflight
  echo "== Node.js"; [ -x "$NODE_BIN/node" ] || die "no $NODE_BIN/node"
  case "$("$NODE_BIN/node" -v)" in v24.*) ok "node $("$NODE_BIN/node" -v)";; *) die "node is not 24.x";; esac
  echo "== Redis binary (shared instance is only read, never changed)"
  local rb; rb=$(redis_bin); [ -x "$rb" ] || die "redis-server not found at $rb"
  ok "$rb: $("$rb" --version | awk '{print $3}')"
  systemctl is-active --quiet redis && ok "shared redis.service active" || note "shared redis.service not active (unchanged either way)"
  echo "== Ports"
  for p in $APP_PORT $REDIS_PORT; do listening "$p" && die "port $p already in use" || ok "port $p free"; done
  echo "== Paths and names"
  [ -e "$BASE" ] && note "$BASE exists (already installed?)" || ok "$BASE free"
  for u in /etc/systemd/system/$SVC.service /etc/systemd/system/$REDIS_SVC.service; do [ -e "$u" ] && note "$u exists" || ok "$u free"; done
  id banij >/dev/null 2>&1 && note "user banij exists" || ok "user banij free"
  echo "== Web root (left exactly as it is)"; ls -la "$WEBROOT"
  echo "== aaPanel vhost: includes and locations"
  [ -f "$VHOST" ] || die "no vhost at $VHOST"
  grep -nE '^\s*(listen|server_name|root|include|location|if |error_page|rewrite)' "$VHOST" || true
  echo "== aaPanel proxy/extension includes for this site"
  ls -la /www/server/panel/vhost/nginx/proxy/$SITE /www/server/panel/vhost/nginx/extension/$SITE 2>/dev/null || note "none yet"
  echo "== nginx -t (baseline)"; "$NGINX" -t
  [ -x "${NGINX_RELOAD[0]}" ] && ok "reload via ${NGINX_RELOAD[*]}" || note "${NGINX_RELOAD[0]} missing: reload through the aaPanel UI instead"
  echo "== Memory"; free -h | sed -n 1,2p
  local avail; avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  [ "$avail" -ge 2500 ] && ok "${avail} MiB available for the build" || note "only ${avail} MiB available: add temporary swap before 'build'"
}

env_check() {
  need_root env-check
  local f=$SHARED/.env
  [ -f "$f" ] || die "no $f"
  [ "$(stat -c '%U %a' "$f")" = "banij 600" ] && ok "owner/mode banij 600" || die "$f must be banij-owned, mode 600"
  local fail=0
  check() { if grep -qE "$2" "$f"; then ok "$1"; else echo "FAIL $1"; fail=1; fi; }
  check "BANIJ_ERP_BASE_URL is https"              '^BANIJ_ERP_BASE_URL=https://[^/[:space:]]+/?$'
  check "BANIJ_CREDENTIAL_KEY_ID format"           '^BANIJ_CREDENTIAL_KEY_ID=wsk_[0-9A-Z]{26}$'
  check "BANIJ_CREDENTIAL_SECRET format"           '^BANIJ_CREDENTIAL_SECRET=[0-9a-f]{64}$'
  check "STOREFRONT_REDIS_URL -> 127.0.0.1:$REDIS_PORT" "^STOREFRONT_REDIS_URL=redis://default:[0-9a-f]{64}@127\\.0\\.0\\.1:$REDIS_PORT/0$"
  check "STOREFRONT_PREVIEW=true"                  '^STOREFRONT_PREVIEW=true$'
  if grep -qE '^STOREFRONT_IMAGE_ORIGIN=' "$f"; then
    check "STOREFRONT_IMAGE_ORIGIN is https"       '^STOREFRONT_IMAGE_ORIGIN=https://[^[:space:]]+/$'
  else
    note "STOREFRONT_IMAGE_ORIGIN not set: products show placeholders until it is (and the app is rebuilt)"
  fi
  if grep -qE '^(STOREFRONT_MODE|STOREFRONT_INSECURE_COOKIES|STOREFRONT_PUBLIC_SCHEME|STOREFRONT_PUBLIC_PORT|STOREFRONT_DEV_HOST_SUFFIX|ERP_BASE_URL|STOREFRONT_REGISTRY_KEY|STOREFRONT_PROVISIONING_[A-Z_]+|NODE_ENV|PORT|HOSTNAME)=' "$f"; then
    echo "FAIL a development, legacy or unit-owned variable is set"; fail=1
  fi
  echo "variables: $(cut -d= -f1 "$f" | grep -v '^#' | tr '\n' ' ')"
  [ $fail -eq 0 ] || die ".env needs fixing (values were not printed)"
}

verify() {
  need_root verify
  local fail=0
  t() { if eval "$2"; then ok "$1"; else echo "FAIL $1"; fail=1; fi; }
  t "storefront listens on 127.0.0.1:$APP_PORT only" "ss -ltnH 'sport = :$APP_PORT' | awk '{print \$4}' | grep -qx '127.0.0.1:$APP_PORT' && ! ss -ltnH 'sport = :$APP_PORT' | awk '{print \$4}' | grep -qvx '127.0.0.1:$APP_PORT'"
  t "redis listens on 127.0.0.1:$REDIS_PORT only" "ss -ltnH 'sport = :$REDIS_PORT' | awk '{print \$4}' | grep -qx '127.0.0.1:$REDIS_PORT' && ! ss -ltnH 'sport = :$REDIS_PORT' | awk '{print \$4}' | grep -qvx '127.0.0.1:$REDIS_PORT'"
  t "redis answers with its password" "runuser -u banij -- bash -c 'REDISCLI_AUTH=\$(cat $SHARED/redis.pass) $(dirname "$(redis_bin)")/redis-cli -p $REDIS_PORT ping' | grep -qx PONG"
  t "health 200" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$APP_PORT/api/health)\" = 200 ]"
  local code; code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $SITE" "http://127.0.0.1:$APP_PORT/en")
  if [ "$code" = 200 ]; then ok "$SITE /en 200"
  else
    echo "WAIT $SITE /en $code — reason from the journal (no values):"
    journalctl -u "$SVC" --since -10min --no-pager -o cat | grep -oE '"(event|check)":"[a-z_]+"|ERP (unreachable|[0-9]{3})' | sort | uniq -c | head -5
  fi
  t "preview: X-Robots-Tag noindex" "curl -s -D - -o /dev/null -H 'Host: $SITE' http://127.0.0.1:$APP_PORT/en | grep -qi '^x-robots-tag: noindex'"
  t "unknown host 404" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: not-this-shop.example' http://127.0.0.1:$APP_PORT/en)\" = 404 ]"
  t "checkout disabled (preview)" "! curl -s -H 'Host: $SITE' http://127.0.0.1:$APP_PORT/en/checkout | grep -q 'name=\"phone\"'"
  # Secrets must not appear in the journal (compared in place, never printed).
  local secret pass
  secret=$(env_value BANIJ_CREDENTIAL_SECRET); pass=$(cat "$SHARED/redis.pass")
  if [ -n "$secret" ] && [ -n "$pass" ]; then
    t "no secret in the journal" "! journalctl -u $SVC -u $REDIS_SVC --no-pager -o cat | grep -qF -e \"\$secret\" -e \"\$pass\""
  else
    echo "FAIL credential secret or redis password missing"; fail=1
  fi
  unset secret pass
  local bk; bk=$(latest_backup)
  if [ -n "$bk" ] && [ -s "$bk/webroot.sha256" ]; then t "aaPanel placeholder files unchanged" "sha256sum --quiet -c '$bk/webroot.sha256'"; fi
  t "shared redis untouched (still active)" "systemctl is-active --quiet redis"
  t "nginx -t" "'$NGINX' -t >/dev/null 2>&1"
  [ $fail -eq 0 ] || die "verification failed"
}

nginx_check() {
  need_root nginx-check
  local files=("$VHOST")
  shopt -s nullglob
  files+=(/www/server/panel/vhost/nginx/proxy/$SITE/*.conf /www/server/panel/vhost/nginx/extension/$SITE/*.conf)
  [ -f "$NGINX_DIR/storefront.conf" ] && files+=("$NGINX_DIR/storefront.conf")
  shopt -u nullglob
  echo "== files: ${files[*]}"
  local all; all=$(cat "${files[@]}")
  grep -qE 'location +\^~ +/ *\{' <<<"$all" && ok "a 'location ^~ /' proxies everything (regex static rules cannot intercept /_next/static)" \
    || echo "FAIL no 'location ^~ /' — aaPanel's regex rules for .js/.css would serve /_next/static from the web root"
  grep -qE "proxy_pass +http://127\.0\.0\.1:$APP_PORT" <<<"$all" && ok "proxy_pass 127.0.0.1:$APP_PORT" || echo "FAIL proxy_pass to 127.0.0.1:$APP_PORT missing"
  grep -qE 'proxy_set_header +Host +\$host *;' <<<"$all" && ok 'Host $host passed through' || echo 'FAIL "proxy_set_header Host $host" missing (set Send domain to $host)'
  grep -qE 'location +\^~ +/\.well-known/acme-challenge/' <<<"$all" && ok "ACME challenge has its own ^~ location (renewals keep working)" \
    || note "no '^~ /.well-known/acme-challenge/' location: certificate renewal would be proxied to the app"
  grep -nE 'proxy_cache +[a-z]|proxy_intercept_errors +on' <<<"$all" && note "caching / error interception is on — turn it off for this site" || ok "no proxy cache / error interception"
  note "$(grep -cE 'location +~' "$VHOST" || true) regex location(s) in the vhost (harmless only behind 'location ^~ /')"
  "$NGINX" -t
}

exposure_check() {
  # Status codes only; bodies are discarded. Run before and after the reverse proxy.
  local fail=0 code
  for scheme in http https; do
    for p in /package.json /package-lock.json /next.config.ts /.next/BUILD_ID /.next/required-server-files.json \
             /node_modules/next/package.json /.env /.env.production /.git/HEAD /.git/config /src/ /site/site.config.json; do
      code=$(curl -s -k -m 10 -o /dev/null -w '%{http_code}' "$scheme://$SITE$p" || true)
      case "$code" in 200|206|301|302) echo "EXPOSED $scheme $p -> $code"; fail=1 ;; *) echo "ok      $scheme $p -> $code" ;; esac
    done
  done
  [ $fail -eq 0 ] && ok "no project file is reachable over HTTP(S)" || echo "FAIL project files are reachable — see EXPOSED lines"
  return $fail
}

# ---- old deployment in the web root ---------------------------------------------------------------

is_kept() { local n=$1 k; for k in "${KEEP[@]}"; do [ "$n" = "$k" ] && return 0; done; return 1; }
old_entries() { find "$WEBROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort | while read -r n; do is_kept "$n" || echo "$n"; done; }
procs_in() {
  local p cwd
  for p in /proc/[0-9]*; do
    cwd=$(readlink "$p/cwd" 2>/dev/null) || continue
    case "$cwd" in "$1"|"$1"/*) echo "${p#/proc/}" ;; esac
  done
}
mask() { sed -E 's#(://)[^/@[:space:]]+@#\1***@#g; s#(gh[pousr]_|github_pat_)[A-Za-z0-9_]+#\1***#g'; }

old_inspect() {
  need_root old-inspect
  echo "== web root entries (KEEP = aaPanel-managed, OLD = would be quarantined)"
  find "$WEBROOT" -mindepth 1 -maxdepth 1 -printf '%f\t%M %u:%g %TY-%Tm-%Td %TH:%TM\n' | sort | while IFS=$'\t' read -r n meta; do
    is_kept "$n" && printf 'KEEP  %-22s %s\n' "$n" "$meta" || printf 'OLD   %-22s %s\n' "$n" "$meta"
  done
  echo "== git of the old project (credentials in URLs masked)"
  if [ -d "$WEBROOT/.git" ]; then
    local G=(git -c safe.directory="$WEBROOT" -C "$WEBROOT")
    { "${G[@]}" remote -v 2>&1 || true; } | mask
    echo "branch: $("${G[@]}" branch --show-current 2>&1 || true)   HEAD: $({ "${G[@]}" log -1 --format='%H %ad %s' --date=short 2>&1 || true; } | mask)"
    echo "uncommitted files: $({ "${G[@]}" status --porcelain 2>/dev/null || true; } | wc -l)"
  else note "no .git"; fi
  echo "== env files (names only)"
  for f in "$WEBROOT"/.env*; do [ -f "$f" ] && { echo "$(basename "$f") ($(stat -c '%U %a' "$f")): $(grep -vE '^\s*(#|$)' "$f" | cut -d= -f1 | tr '\n' ' ')"; }; done
  echo "== processes running from it"
  local pids; pids=$(procs_in "$WEBROOT")
  if [ -n "$pids" ]; then for p in $pids; do echo "PID $p user=$(stat -c %U /proc/$p) cmd=$(tr '\0' ' ' < /proc/$p/cmdline | cut -c1-100 | mask)"; done
  else ok "no process has its working directory there"; fi
  echo "== references in service managers / other vhosts"
  grep -rlF "$WEBROOT" /etc/systemd/system /etc/supervisor /www/server/nodejs/vhost /www/server/panel/vhost/nginx 2>/dev/null \
    | grep -vx "$VHOST" || ok "none besides the site's own vhost"
  echo "== size: $(du -sh "$WEBROOT" 2>/dev/null | cut -f1)   free on /: $(df -h / | awk 'NR==2{print $4}')"
}

old_backup() {
  need_root old-backup
  [ -d "$WEBROOT" ] || die "no $WEBROOT"
  local bk; bk=$BACKUPS/$(date +%Y%m%d-%H%M%S)-old-webroot
  PARTIAL=$bk.partial; local tmp=$PARTIAL
  # Built in $tmp; renamed to $bk (and marked VERIFIED) only after the test restore matches. Any failure
  # removes it, so old-quarantine can never act on an unverified archive.
  trap '[ -z "${PARTIAL:-}" ] || [ ! -e "$PARTIAL" ] || { rm -rf "$PARTIAL"; echo "ERROR: old-backup failed — partial archive removed, web root untouched" >&2; }' EXIT
  install -d -m 0700 "$tmp"
  echo "== archiving $WEBROOT (all files, hidden ones included)"
  find "$WEBROOT" -mindepth 1 -type f -printf '%P\0' | sort -z | (cd "$WEBROOT" && xargs -0 -r sha256sum --) > "$tmp/files.sha256"
  find "$WEBROOT" -mindepth 1 -printf '%M %u:%g %s %P\n' | sort -k4 > "$tmp/listing.txt"
  tar --xattrs --acls -C "$WEBROOT" -cpzf "$tmp/old-webroot.tgz" .
  chmod 0600 "$tmp"/*
  echo "== verifying"
  gzip -t "$tmp/old-webroot.tgz" || die "archive is corrupt"
  local want got
  want=$(wc -l < "$tmp/listing.txt"); got=$(tar -tzf "$tmp/old-webroot.tgz" | grep -vx './' | wc -l)
  [ "$want" = "$got" ] || die "archive holds $got entries, the web root has $want"
  install -d -m 0700 "$tmp/verify-extract"
  tar --xattrs --acls -C "$tmp/verify-extract" -xpzf "$tmp/old-webroot.tgz"
  (cd "$tmp/verify-extract" && sha256sum --quiet --strict -c "$tmp/files.sha256") || die "restored files do not match the originals"
  rm -rf "$tmp/verify-extract"
  (cd "$tmp" && sha256sum old-webroot.tgz) > "$tmp/archive.sha256"
  date -Is > "$tmp/VERIFIED"; chmod 0600 "$tmp"/*
  mv "$tmp" "$bk"
  trap - EXIT
  ok "backup verified: $want entries, every file's checksum matches after a test restore"
  echo "   $bk  ($(du -sh "$bk/old-webroot.tgz" | cut -f1))"
}

old_quarantine() {
  need_root old-quarantine
  local bk; bk=$({ ls -1d "$BACKUPS"/*-old-webroot 2>/dev/null || true; } | sort | tail -1)
  [ -n "$bk" ] && [ -f "$bk/VERIFIED" ] || die "no verified old-backup — run old-backup first"
  [ -z "$(procs_in "$WEBROOT")" ] || die "a process still runs from $WEBROOT — stop it first (see old-inspect)"
  local entries; entries=$(old_entries)
  [ -n "$entries" ] || { ok "nothing to move: only aaPanel entries remain"; return 0; }
  install -d -m 0700 "$bk/quarantine"
  echo "== moving out of the web root (aaPanel entries stay: ${KEEP[*]})"
  while read -r n; do
    [ -e "$bk/quarantine/$n" ] && die "$bk/quarantine/$n already exists"
    mv -- "$WEBROOT/$n" "$bk/quarantine/$n" && echo "moved  $n"
  done <<<"$entries"
  echo "== web root now:"; ls -la "$WEBROOT"
  ok "old deployment moved to $bk/quarantine (restore with: old-restore $bk)"
}

old_restore() {
  need_root old-restore
  local bk=${1:-}; [ -d "$bk/quarantine" ] || die "usage: old-restore $BACKUPS/<ts>-old-webroot"
  local n names
  names=$(find "$bk/quarantine" -mindepth 1 -maxdepth 1 -printf '%f\n')
  while read -r n; do [ -z "$n" ] || [ ! -e "$WEBROOT/$n" ] || die "$WEBROOT/$n exists — not overwriting"; done <<<"$names"
  while read -r n; do [ -z "$n" ] || { mv -- "$bk/quarantine/$n" "$WEBROOT/$n" && echo "restored $n"; }; done <<<"$names"
  rmdir "$bk/quarantine"; ok "old deployment restored into $WEBROOT"
}

# ---- write phases --------------------------------------------------------------------------------

backup() {
  need_root backup
  local bk; bk=$BACKUPS/$(date +%Y%m%d-%H%M%S)
  PARTIAL=$bk.partial; local tmp=$PARTIAL
  # Built in $tmp and renamed only when complete: a failed run never leaves a backup that looks valid.
  # (The EXIT trap runs after this function returns, so it uses the script-level PARTIAL.)
  trap '[ -z "${PARTIAL:-}" ] || [ ! -e "$PARTIAL" ] || { rm -rf "$PARTIAL"; echo "ERROR: backup failed — partial copy removed" >&2; }' EXIT
  install -d -m 0700 "$tmp"
  [ -f "$VHOST" ] || die "no vhost at $VHOST"
  cp -a "$VHOST" "$tmp/vhost.conf"
  local d
  for d in well-known proxy/$SITE extension/$SITE; do
    if [ -e "/www/server/panel/vhost/nginx/$d" ]; then cp -a "/www/server/panel/vhost/nginx/$d" "$tmp/$(tr / _ <<<"$d")"; fi
  done
  if [ -e "/www/server/panel/vhost/rewrite/$SITE.conf" ]; then cp -a "/www/server/panel/vhost/rewrite/$SITE.conf" "$tmp/rewrite.conf"; fi
  # aaPanel placeholder files: checksum the ones that exist (absolute paths), record the missing ones.
  : > "$tmp/webroot.sha256"; : > "$tmp/webroot-missing.txt"
  local f
  for f in .htaccess .user.ini 404.html 502.html index.html; do
    if [ -f "$WEBROOT/$f" ]; then sha256sum "$WEBROOT/$f" >> "$tmp/webroot.sha256"; else echo "$f" >> "$tmp/webroot-missing.txt"; fi
  done
  ss -ltn > "$tmp/ports.txt"
  systemctl list-units --type=service --state=running --no-legend --no-pager > "$tmp/services.txt"
  cmp -s "$VHOST" "$tmp/vhost.conf" || die "vhost copy does not match the original"
  date -Is > "$tmp/COMPLETE"
  chmod 0600 "$tmp"/* 2>/dev/null || true
  mv "$tmp" "$bk"
  trap - EXIT
  ok "backup in $bk"
  [ -s "$bk/webroot-missing.txt" ] && note "aaPanel placeholder files already absent from the web root: $(tr '\n' ' ' < "$bk/webroot-missing.txt")"
  return 0
}

user() {
  need_root user
  [ -e "$BASE" ] && die "$BASE already exists — not overwriting"
  id banij >/dev/null 2>&1 || adduser --system --group --no-create-home --home "$HOMEDIR" --shell /usr/sbin/nologin banij
  install -d -o root  -g banij -m 0750 "$BASE"
  install -d -o banij -g banij -m 0750 "$APP" "$APP/releases"
  install -d -o banij -g banij -m 0700 "$SHARED" "$REDIS_DIR" "$REDIS_DIR/data" "$HOMEDIR" "$HOMEDIR/.ssh"
  install -d -o root  -g root  -m 0755 "$NGINX_DIR"
  ok "user banij and $BASE created"
}

redis() {
  need_root redis
  local rb; rb=$(redis_bin)
  [ -x "$rb" ] || die "redis-server not found at $rb"
  runuser -u banij -- test -x "$rb" || die "banij cannot execute $rb"
  [ "$("$rb" --version | sed -E 's/.*v=([0-9]+).*/\1/')" -ge 6 ] || die "redis 6+ required"
  listening "$REDIS_PORT" && die "port $REDIS_PORT in use"
  [ -s "$SHARED/redis.pass" ] || runuser -u banij -- bash -c "umask 077; openssl rand -hex 32 > '$SHARED/redis.pass'"
  runuser -u banij -- bash -c "umask 077; printf 'requirepass %s\n' \"\$(cat '$SHARED/redis.pass')\" > '$REDIS_DIR/auth.conf'"
  runuser -u banij -- bash -c "umask 077; cat > '$REDIS_DIR/redis.conf'" <<EOF
bind 127.0.0.1
port $REDIS_PORT
protected-mode yes
daemonize no
dir $REDIS_DIR/data
appendonly yes
appendfsync everysec
save 900 1
maxmemory 128mb
maxmemory-policy noeviction
databases 1
logfile ""
include $REDIS_DIR/auth.conf
EOF
  cat > /etc/systemd/system/$REDIS_SVC.service <<EOF
[Unit]
Description=Redis for the Banij storefront (staging) - 127.0.0.1:$REDIS_PORT
After=network.target

[Service]
Type=simple
User=banij
Group=banij
ExecStart=$rb $REDIS_DIR/redis.conf
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$REDIS_DIR/data
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 /etc/systemd/system/$REDIS_SVC.service
  systemctl daemon-reload
  systemctl enable --now "$REDIS_SVC"
  sleep 1
  runuser -u banij -- bash -c "REDISCLI_AUTH=\$(cat '$SHARED/redis.pass') '$(dirname "$rb")/redis-cli' -p $REDIS_PORT ping" | grep -qx PONG || die "dedicated redis does not answer"
  ok "dedicated redis on 127.0.0.1:$REDIS_PORT"
}

deploykey() {
  need_root deploykey
  [ -f "$HOMEDIR/.ssh/id_ed25519" ] || runuser -u banij -- ssh-keygen -q -t ed25519 -N '' -C "banij-staging@$(hostname)" -f "$HOMEDIR/.ssh/id_ed25519"
  runuser -u banij -- bash -c "umask 077; echo '$GITHUB_HOSTKEY' > '$HOMEDIR/.ssh/known_hosts'"
  echo "== Add this as a READ-ONLY deploy key: GitHub → deshfiri/banij-storefront → Settings → Deploy keys"
  cat "$HOMEDIR/.ssh/id_ed25519.pub"
  echo "== Then test (expects 'successfully authenticated'):"
  echo "   sudo runuser -u banij -- env HOME=$HOMEDIR ssh -o StrictHostKeyChecking=yes -T git@github.com"
}

env_init() {
  need_root env-init
  [ -e "$SHARED/.env" ] && die "$SHARED/.env exists — edit it with: sudo runuser -u banij -- nano $SHARED/.env"
  [ -s "$SHARED/redis.pass" ] || die "run the redis phase first"
  runuser -u banij -- bash -c "umask 077; {
    printf 'BANIJ_ERP_BASE_URL=https://erp-staging.deshfiri.com\n'
    printf 'BANIJ_CREDENTIAL_KEY_ID=\nBANIJ_CREDENTIAL_SECRET=\n'
    printf 'STOREFRONT_REDIS_URL=redis://default:%s@127.0.0.1:$REDIS_PORT/0\n' \"\$(cat '$SHARED/redis.pass')\"
    printf '# STOREFRONT_IMAGE_ORIGIN=https://<media host>/<prefix>/\n'
    printf 'STOREFRONT_PREVIEW=true\n'
  } > '$SHARED/.env'"
  ok "$SHARED/.env created (0600). Fill in the credential from the Super Admin's one-time block with:"
  echo "   sudo runuser -u banij -- nano $SHARED/.env        then: sudo bash $0 env-check"
}

build() {
  need_root build
  env_check >/dev/null
  local rel; rel=$APP/releases/$(date +%Y%m%d%H%M%S)
  local origin; origin=$(env_value STOREFRONT_IMAGE_ORIGIN)
  as_banij git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$rel"
  local head; head=$(as_banij git -C "$rel" rev-parse HEAD)
  ok "cloned $BRANCH at $head"
  if [ -n "${EXPECTED_COMMIT:-}" ] && [ "$head" != "$EXPECTED_COMMIT" ]; then die "HEAD $head is not the approved $EXPECTED_COMMIT"; fi
  as_banij node -e "
    const c = require('$rel/site/site.config.json');
    const bad = [];
    if (c.website.id !== '$WEBSITE_ID') bad.push('website.id');
    if (c.domains.primary !== '$SITE') bad.push('domains.primary');
    if ((c.domains.development || []).length) bad.push('domains.development');
    if (c.deployment.environment !== 'staging') bad.push('deployment.environment');
    if (bad.length) { console.error('site.config.json: ' + bad.join(', ')); process.exit(1); }" || die "site config is not the approved staging config"
  ok "site.config.json: $WEBSITE_ID on $SITE, staging"
  as_banij bash -c "cd '$rel' && npm ci --no-audit --no-fund --loglevel=error"
  as_banij bash -c "cd '$rel' && NODE_OPTIONS=--max-old-space-size=2048 NEXT_TELEMETRY_DISABLED=1 STOREFRONT_PREVIEW=true STOREFRONT_IMAGE_ORIGIN='$origin' npm run build" > "$rel.build.log" 2>&1 \
    || { tail -20 "$rel.build.log"; die "build failed (release left in $rel, not activated)"; }
  as_banij bash -c "cd '$rel' && bash dev/bundle-scan.sh '$SHARED/.env'" | tail -1 | grep -qx 'BUNDLE CLEAN' || die "bundle scan failed"
  as_banij bash -c "cd '$rel' && cp -r .next/static .next/standalone/.next/static && { [ ! -d public ] || cp -r public .next/standalone/public; }"
  ok "release built: $rel   (activate with: sudo bash $0 activate $rel)"
}

write_unit() {
  cat > /etc/systemd/system/$SVC.service <<EOF
[Unit]
Description=Banij storefront - staging (Karim Traders) - 127.0.0.1:$APP_PORT
After=network-online.target $REDIS_SVC.service
Wants=network-online.target $REDIS_SVC.service
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
User=banij
Group=banij
WorkingDirectory=$APP/current/.next/standalone
EnvironmentFile=$SHARED/.env
Environment=NODE_ENV=production
Environment=PORT=$APP_PORT
Environment=HOSTNAME=127.0.0.1
Environment=NEXT_TELEMETRY_DISABLED=1
ExecStart=$NODE_BIN/node server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=$APP/releases
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 /etc/systemd/system/$SVC.service
}

activate() {
  need_root activate
  local rel=${1:-}; [ -n "$rel" ] && [ -f "$rel/.next/standalone/server.js" ] || die "usage: activate $APP/releases/<id> (a built release)"
  case "$rel" in "$APP"/releases/*) ;; *) die "not a release under $APP/releases";; esac
  listening "$APP_PORT" && ! systemctl is-active --quiet "$SVC" && die "port $APP_PORT used by something else"
  local previous=""; [ -L "$APP/current" ] && previous=$(readlink -f "$APP/current")
  runuser -u banij -- ln -sfn "$rel" "$APP/current"
  write_unit
  systemctl daemon-reload
  systemctl enable "$SVC" >/dev/null 2>&1
  systemctl restart "$SVC"
  for _ in $(seq 1 30); do sleep 1; [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT/api/health")" = 200 ] && { ok "$SVC running $rel"; return 0; }; done
  echo "health check failed — journal:"; journalctl -u "$SVC" -n 20 --no-pager -o cat
  if [ -n "$previous" ]; then
    runuser -u banij -- ln -sfn "$previous" "$APP/current"; systemctl restart "$SVC"; die "rolled back to $previous"
  fi
  systemctl stop "$SVC"; die "stopped (no previous release)"
}

nginx_include() {
  # Fallback only, when aaPanel's Reverse proxy UI cannot produce what nginx-check requires.
  need_root nginx-include
  local bk; bk=$(latest_backup); [ -n "$bk" ] && [ -f "$bk/vhost.conf" ] || die "run the backup phase first"
  cat > "$NGINX_DIR/storefront.conf" <<'EOF'
# Banij storefront (staging) — included in the staging.deshfiri.com server block.
location ^~ /.well-known/acme-challenge/ {
    root /www/wwwroot/staging.deshfiri.com;
    try_files $uri =404;
}
location ^~ / {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Connection "";
    proxy_read_timeout 60s;
    proxy_intercept_errors off;
}
EOF
  chmod 0644 "$NGINX_DIR/storefront.conf"
  if grep -qE 'location +\^~ +/\.well-known/acme-challenge/' "$VHOST" /www/server/panel/vhost/nginx/well-known/*.conf 2>/dev/null; then
    sed -i '/acme-challenge/,/^}/d' "$NGINX_DIR/storefront.conf"   # aaPanel already has one: avoid a duplicate location
    note "aaPanel's ACME location kept; ours removed"
  fi
  local line="    include $NGINX_DIR/storefront.conf;"
  grep -qF "$line" "$VHOST" && { ok "include already present"; "$NGINX" -t; return 0; }
  local tmp; tmp=$(mktemp)
  # Insert once, immediately before the FIRST location line of the vhost; nothing else changes.
  awk -v add="$line" '!done && /^[[:space:]]*location[[:space:]]/ { print add; done=1 } { print }' "$VHOST" > "$tmp"
  [ "$(diff "$VHOST" "$tmp" | grep -c '^>')" = 1 ] && [ "$(diff "$VHOST" "$tmp" | grep -c '^<')" = 0 ] || { rm -f "$tmp"; die "unexpected diff — vhost not changed"; }
  diff "$VHOST" "$tmp" || true
  cat "$tmp" > "$VHOST"; rm -f "$tmp"          # keeps the file's owner, mode and inode
  if "$NGINX" -t; then
    "${NGINX_RELOAD[@]}"; ok "nginx reloaded with the storefront include"
  else
    cp -a "$bk/vhost.conf" "$VHOST"; "$NGINX" -t; die "nginx -t failed — vhost restored from $bk"
  fi
}

# ---- rollback --------------------------------------------------------------------------------------

rollback() {
  need_root rollback
  local what=${1:-}; local purge=${2:-}
  case "$what" in
    service)
      systemctl disable --now "$SVC" 2>/dev/null || true
      rm -f /etc/systemd/system/$SVC.service; systemctl daemon-reload; ok "storefront service removed" ;;
    release)
      local current previous
      current=$(readlink -f "$APP/current")
      previous=$(ls -1d "$APP"/releases/*/ | sed 's#/$##' | grep -vx "$current" | sort | tail -1)
      [ -n "$previous" ] || die "no previous release"
      runuser -u banij -- ln -sfn "$previous" "$APP/current"; systemctl restart "$SVC"; ok "current -> $previous" ;;
    redis)
      systemctl disable --now "$REDIS_SVC" 2>/dev/null || true
      rm -f /etc/systemd/system/$REDIS_SVC.service; systemctl daemon-reload; ok "dedicated redis service removed (data kept in $REDIS_DIR)" ;;
    nginx)
      local bk; bk=$(latest_backup); [ -f "$bk/vhost.conf" ] || die "no vhost backup"
      cp -a "$bk/vhost.conf" "$VHOST"
      "$NGINX" -t && "${NGINX_RELOAD[@]}" && ok "vhost restored from $bk (remove any aaPanel reverse-proxy entry in the UI as well)" ;;
    all)
      ( rollback nginx ) || true; ( rollback service ) || true; ( rollback redis ) || true
      if [ "$purge" = "--purge" ]; then rm -rf "$BASE"; deluser --system banij >/dev/null 2>&1 || true; ok "$BASE and user banij removed"
      else note "files kept in $BASE (add --purge to remove them and the banij user)"; fi
      note "revoke the deploy key on GitHub and, if exposed, the staging credential in ERP Admin" ;;
    *) die "rollback <service|release|redis|nginx|all> [--purge]" ;;
  esac
}

case "${1:-}" in
  preflight) preflight ;;
  env-check) env_check ;;
  verify) verify ;;
  nginx-check) nginx_check ;;
  backup) backup ;;
  user) user ;;
  redis) redis ;;
  deploykey) deploykey ;;
  env-init) env_init ;;
  build) build ;;
  activate) activate "${2:-}" ;;
  nginx-include) nginx_include ;;
  exposure-check) exposure_check ;;
  old-inspect) old_inspect ;;
  old-backup) old_backup ;;
  old-quarantine) old_quarantine ;;
  old-restore) old_restore "${2:-}" ;;
  rollback) rollback "${2:-}" "${3:-}" ;;
  *) sed -n '2,18p' "$0"; exit 1 ;;
esac
