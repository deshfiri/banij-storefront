# VPS runbook — one Banij storefront on Ubuntu (Nginx + systemd)

For the operator who installs one storefront on an Ubuntu VPS. Domain-agnostic: wherever you see
`shop.example.com`, use the website's real primary host once it is known. Container deployment is in
[installation.md](installation.md); the ERP-side prerequisites are in
[production-runbook.md](production-runbook.md) §1.1 and apply here unchanged.

| Item | Value in this runbook |
|---|---|
| Installation directory | `/var/www/banij-storefront` (`APP`) |
| Releases / live symlink / secrets | `$APP/releases/<id>/`, `$APP/current`, `$APP/shared/.env` |
| Service user | `banij` (system user, no shell) |
| Node.js | 24.x (`package.json` → `engines.node: ">=24 <25"`; Next.js 16.4) |
| App server | Next.js standalone `server.js` on `127.0.0.1:3000`, under systemd |
| Front | Nginx on 80 (and 443 after Certbot) |
| Redis | local `redis-server`, ACL user `storefront`, never shared with another website or the ERP |

---

## 0. What must be decided before the first build

The storefront serves **only** the hosts compiled into its `site/site.config.json`, and the ERP must
list the same host for this website. So the domain is not needed to prepare the server, but it **is**
needed before the build that goes live:

- `website.id` — the website's public id in the ERP (Karim Traders: `01M4MHJ7BA282X3QXV1Q256ZMP`).
- `domains.primary` — the final host (e.g. `shop.example.com`); `domains.aliases` — other verified hosts;
  `domains.development` — `[]` in production.
- `deployment.environment` — `"production"`.
- `STOREFRONT_IMAGE_ORIGIN` — the one public HTTPS origin and path the ERP serves product media from.

Keep each installation's `site/site.config.json` (and `content.json`, `theme.css`) committed on its own
branch or repository fork; build exactly what is committed.

---

## 1. Prepare the server (once)

```bash
sudo apt update && sudo apt install -y nginx redis-server git curl ca-certificates
# Node.js 24 from NodeSource (the version package.json requires)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v                                   # v24.x

sudo adduser --system --group --home /var/www/banij-storefront --shell /usr/sbin/nologin banij
sudo install -d -o banij -g banij -m 0750 /var/www/banij-storefront /var/www/banij-storefront/releases
sudo install -d -o banij -g banij -m 0700 /var/www/banij-storefront/shared

sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

## 2. Redis (once)

Local only, authenticated, never evicting (carts and checkout idempotency keys must not be dropped).
In `/etc/redis/redis.conf` set:

```conf
bind 127.0.0.1 -::1
protected-mode yes
maxmemory 1gb
maxmemory-policy noeviction
appendonly yes
appendfsync everysec
aclfile /etc/redis/users.acl
```

```bash
REDIS_PASSWORD=$(openssl rand -hex 32)      # keep it only for the .env below
printf 'user default off\nuser storefront on >%s ~bsf:* +@all -@dangerous +info\n' "$REDIS_PASSWORD" \
  | sudo tee /etc/redis/users.acl > /dev/null
sudo chown redis:redis /etc/redis/users.acl && sudo chmod 0640 /etc/redis/users.acl
sudo systemctl restart redis-server
redis-cli --user storefront --pass "$REDIS_PASSWORD" --no-auth-warning ping     # PONG
```

## 3. Server-side environment (once; again on credential rotation)

`$APP/shared/.env`, written by hand from the one-time block a Banij **Super Admin** issues for this
website (the storefront never writes or fetches it):

```bash
sudo -u banij install -m 0600 /dev/null /var/www/banij-storefront/shared/.env
sudo -u banij nano /var/www/banij-storefront/shared/.env
```

```dotenv
BANIJ_ERP_BASE_URL=https://erp.example.com
BANIJ_CREDENTIAL_KEY_ID=wsk_01XXXXXXXXXXXXXXXXXXXXXXXX
BANIJ_CREDENTIAL_SECRET=<64 lowercase hex characters>
STOREFRONT_REDIS_URL=redis://storefront:<REDIS_PASSWORD>@127.0.0.1:6379/0
STOREFRONT_IMAGE_ORIGIN=https://media.example.com/storage/
```

Nothing else. Never set `STOREFRONT_PREVIEW`, `STOREFRONT_MODE`, `STOREFRONT_INSECURE_COOKIES` or any
other development variable here. `NODE_ENV`, `PORT` and `HOSTNAME` come from the systemd unit.

## 4. Build a release

```bash
APP=/var/www/banij-storefront
REL=$APP/releases/$(date +%Y%m%d%H%M%S)
sudo -u banij git clone --depth 1 --branch <installation-branch> <REPOSITORY_URL> "$REL"
cd "$REL"
sudo -u banij git log --oneline -1                           # record the commit being deployed
sudo -u banij grep -E '"(id|primary|environment)"' site/site.config.json   # production values?

sudo -u banij npm ci
# The build needs ONE value: the public image origin (fixed at build time). No credential is used.
sudo -u banij env NEXT_TELEMETRY_DISABLED=1 \
  STOREFRONT_IMAGE_ORIGIN="$(sudo grep '^STOREFRONT_IMAGE_ORIGIN=' $APP/shared/.env | cut -d= -f2-)" \
  npm run build
# Browser bundle must not contain any server-side material or any .env value.
sudo -u banij bash dev/bundle-scan.sh "$APP/shared/.env"     # → BUNDLE CLEAN

# Standalone server: static assets (and public/, if present) sit next to server.js.
sudo -u banij cp -r .next/static .next/standalone/.next/static
[ -d public ] && sudo -u banij cp -r public .next/standalone/public
```

A release directory never contains `.env`; the build fails the bundle scan rather than ship a leak.

## 5. First start (once)

```bash
sudo ln -sfn "$REL" /var/www/banij-storefront/current
sudo install -m 0644 "$REL/deploy/vps/banij-storefront.service" /etc/systemd/system/banij-storefront.service
sudo systemctl daemon-reload && sudo systemctl enable --now banij-storefront
sudo systemctl status banij-storefront --no-pager
sudo journalctl -u banij-storefront -n 50 --no-pager
```

If it does not stay up, the journal names the problem without printing values, e.g.
`Installation environment missing or malformed: BANIJ_CREDENTIAL_SECRET`,
`STOREFRONT_IMAGE_ORIGIN differs from the image origin this build allows`, or a site-config field.
Fix `.env` (or rebuild) and `sudo systemctl restart banij-storefront`.

## 6. Nginx

```bash
DOMAIN=shop.example.com                     # the value of domains.primary
sed "s/STOREFRONT_DOMAIN/$DOMAIN/g" "$REL/deploy/vps/nginx-banij-storefront.conf" \
  | sudo tee /etc/nginx/sites-available/banij-storefront > /dev/null
sudo ln -sfn /etc/nginx/sites-available/banij-storefront /etc/nginx/sites-enabled/banij-storefront
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Before DNS exists, check through Nginx on the server itself:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health                       # 200
curl -s -o /dev/null -w '%{http_code}\n' -H "Host: $DOMAIN" http://127.0.0.1/en                 # 200
curl -s -o /dev/null -w '%{http_code}\n' -H "Host: not-this-shop.example" http://127.0.0.1/en   # 000 (closed)
```

## 7. HTTPS (only once the real domain points here)

```bash
dig +short "$DOMAIN"                        # the VPS address
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d "$DOMAIN" --redirect -m <ops-email> --agree-tos --no-eff-email
sudo certbot renew --dry-run
```

Then add HSTS inside the `listen 443` server Certbot created, and reload:
`add_header Strict-Transport-Security "max-age=31536000" always;` → `sudo nginx -t && sudo systemctl reload nginx`.

Production cookies are `Secure`: carts and checkout work only over HTTPS.

## 8. Verify (no orders)

Run the checks in [production-runbook.md §4](production-runbook.md) against `https://$DOMAIN`
(health, HTTPS redirect, certificate, `/en` and `/bn`, images as WebP, cart stepper, checkout up to
"Calculate total" only, the owner's ERP Integration page showing this website's calls). A first real
order only with explicit approval.

## 9. Update to a new release

Repeat §4 into a **new** `$REL`, then:

```bash
sudo ln -sfn "$REL" /var/www/banij-storefront/current
sudo systemctl restart banij-storefront
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health      # 200, else roll back
ls -1dt /var/www/banij-storefront/releases/* | tail -n +4 | xargs -r sudo rm -rf   # keep the last 3
```

The switch is atomic; carts survive in Redis. Nothing else changes: `shared/.env`, Nginx and the
unit file stay as they are (re-install the unit only if `deploy/vps/banij-storefront.service` changed).

## 10. Roll back

```bash
ls -1dt /var/www/banij-storefront/releases/*                       # newest first
sudo ln -sfn /var/www/banij-storefront/releases/<previous> /var/www/banij-storefront/current
sudo systemctl restart banij-storefront
```

Other ways back: restore the previous `shared/.env` (keep a 0600 copy outside the web tree) and
restart; take the shop offline with `sudo systemctl stop banij-storefront` (Nginx then answers 502) or
with maintenance mode in ERP Admin; a compromised credential is revoked by a Super Admin in the ERP,
reissued, written into `shared/.env`, then `restart`.

## 11. Catalogue freshness (what to expect after an owner change)

Every catalogue page is a live, signed ERP read cached in this installation's Redis for **at most 60
seconds** per listing or product (delivery areas: 1 hour). When the owner connects **and publishes** a
product in the ERP, it appears in the storefront within about a minute — no rebuild, no restart. A
product page someone opened while the product was not yet published shows "not found" until that
entry's 60 seconds pass. Prices, stock and totals at checkout are always re-read from the ERP. The
cache is per-website versioned for an ERP webhook to invalidate instantly, but no webhook receiver is
installed yet, so the 60-second bound is the guarantee.
