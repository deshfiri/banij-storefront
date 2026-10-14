# Installing a Banij storefront

One storefront installation serves **one** Owner's website. It has its own domain, hosting, runtime and deployment (P3). The central Banij ERP stays authoritative for products, prices, stock, orders and payments; the storefront is a client of it.

> **Not production-ready yet.** An installation must not take real customers until both of these hold:
>
> - The ERP's order-specific authorization (**ER-11**) and the storefront's use of it (**SF-11**) are implemented and verified.
> - The website's credential is issued **without unrestricted `orders:read`**.
>
> Until then, use installations for staging and acceptance only.

## What goes where

| Kind | Where | In git? | In the image? |
|---|---|---|---|
| Public configuration: website identity (expected), domains, theme, locale, features | `site/site.config.json` | yes, in the website's project | yes |
| Customization: design tokens, component slots | `site/theme.css`, `site/customizations.tsx` | yes | yes |
| ERP endpoint and the website-scoped credential | server-side `.env` | **never** | **never** |
| Redis connection | server-side `.env` | never | never |

The configured `website.id` is an **expected-identity assertion**, not authentication. The ERP decides which website a request belongs to from the credential alone.

On every request the storefront checks that:

- the ERP accepts the credential,
- the website the ERP returns is the configured one, and
- the configured primary domain is one the ERP has registered for that website.

If any check fails, it serves nothing: customers see a temporary-unavailability page, and operators get a log line.

## 1. Prerequisites

- A server: a VPS or container host with Docker, or Node.js 24.
- A Redis 8 instance **for this installation only** (`deploy/redis-storefront.conf`). The compose file provides one.
- The website's domain, with DNS you control.
- A Banij Super Admin to do step 2.

## 2. In the Banij ERP (Super Admin)

1. **The website exists and is live.** Note its **public id** (a 26-character ULID). This is `website.id` below.
2. **Register the domain on the website and verify it.**
   - Publish the TXT record `_banij-verify.<domain>` with the token the ERP shows.
   - Click **Check**, then **Activate**.
   - The domain must be **verified and active**. The storefront refuses to serve a primary domain the ERP does not list for the website.
   - The website's ERP subdomain also counts as registered.
3. **Generate the website-scoped API credential.** It is shown **once**: a key id `wsk_…` and a 64-character secret.
   - Minimum scopes: `catalog:read`, `orders:write`, and order access per ER-11.
   - Do not issue unrestricted `orders:read` for production.
   - Hand the key id and secret to the installing admin over a secure channel. Never email them in clear, and never commit them.

## 3. Public configuration — `site/site.config.json`

```json
{
  "schemaVersion": 2,
  "template": { "name": "banij-storefront", "version": "0.2.0" },
  "website": { "id": "<ERP website public id>", "slug": "<short-name>" },
  "domains": { "primary": "shop.example.com", "aliases": ["www.shop.example.com"], "development": [] },
  "theme": { "preset": "modern", "colors": { "primary": "#c2410c" } },
  "locale": { "default": "bn" },
  "features": { "flashDeals": true, "bestSellers": true, "featured": true, "newArrivals": true, "cashOnDelivery": true },
  "deployment": { "environment": "production" }
}
```

**Rules,** all enforced at boot. The server refuses to start otherwise.

- **No credentials, no ERP address, no secrets.** The schema rejects `credential` and `erp` keys, any `wsk_…` key id, and anything secret-shaped.
- **Hosts are lowercase names,** without scheme or port.
- **`aliases`** are redirected to the primary, and only while the ERP also lists them for the website. Otherwise an alias answers 404.
- **`development` hosts** (e.g. `shop.localhost`) are honoured only outside production, and are refused when `deployment.environment` is `production`.
- **`onlinePayment` cannot be enabled** here (not yet integrated).
- **Presentation and features:** theme, colours, locales and features change presentation only. They never override the ERP's rules (prices, stock, COD eligibility and limits).

**Customization:**

- Edit only `site/theme.css` (design tokens) and `site/customizations.tsx` (Hero, FooterNote, homepage section order).
- Do not edit `src/`. The ERP SDK, cart, checkout and security code are the template's.

## 4. Credentials — the server-side `.env` (entered by hand)

On the server, next to the project (or where `compose.yaml` expects it), create `.env` from `.env.example`:

```dotenv
BANIJ_ERP_BASE_URL=https://erp.example.com
BANIJ_CREDENTIAL_KEY_ID=wsk_01XXXXXXXXXXXXXXXXXXXXXXXX
BANIJ_CREDENTIAL_SECRET=<64 lowercase hex characters>
STOREFRONT_REDIS_URL=redis://storefront:<password>@redis:6379/0
STOREFRONT_IMAGE_ORIGIN=https://media.example.com/storage/
```

```bash
chmod 600 .env
```

`STOREFRONT_IMAGE_ORIGIN` is public (not a secret) but **build-time**: the image optimizer's allow-list
is fixed when the app is built. Build with the same value — `--build-arg STOREFRONT_IMAGE_ORIGIN=…`
for the container image; `npm run build` reads it from `.env` — or the server refuses to start.

- Never commit `.env`. `.gitignore` and `.dockerignore` already exclude `.env*`.
- Never put these values in `site.config.json`, the image, a URL or a ticket.
- Never set the development-only or legacy variables in production (see `.env.example`). Production refuses `STOREFRONT_MODE=shared` at boot.

## 5. Build and run

### Option A — containers (`deploy/installation/compose.yaml`)

```bash
docker build -f deploy/Dockerfile --build-arg STOREFRONT_IMAGE_ORIGIN=https://media.example.com/storage/ \
  -t banij-storefront-<slug>:<version> .
# deploy/installation/caddy.env (not secret): SITE_PRIMARY_HOST, ACME_EMAIL, STOREFRONT_IMAGE, STOREFRONT_REDIS_PASSWORD
# deploy/installation/redis.acl (secret, 0600): user storefront on ><password> ~bsf:* +@all -@dangerous; user default off
docker compose -f deploy/installation/compose.yaml --env-file deploy/installation/caddy.env up -d
```

Edit `deploy/installation/Caddyfile` to list the website's aliases, if any. The image is built **without** any credential. The build fails if a `.env` slips into the build context.

### Option B — Node.js on a VPS

```bash
npm ci && npm run build
NODE_ENV=production npm start           # reads .env; listens on 127.0.0.1:3000 behind Caddy
caddy run --config deploy/installation/Caddyfile   # with SITE_PRIMARY_HOST, ACME_EMAIL, STOREFRONT_UPSTREAM=127.0.0.1:3000
```

**Boot validation:** the server refuses to start, naming the variable or field at fault and never its value, when:

- the configuration is invalid,
- the `.env` is incomplete or malformed,
- shared mode is requested in production, or
- `STOREFRONT_IMAGE_ORIGIN` is local on a production site, or differs from the origin the build allows.

## 6. DNS and TLS

Point the primary domain (and any aliases) at the server. Caddy obtains certificates automatically for exactly those names. There is no on-demand TLS.

## 7. Verify the installation

| Check | Expected |
|---|---|
| `curl -s https://shop.example.com/api/health` | `{"status":"ok"}` |
| Open `https://shop.example.com/` | Redirects to `/<locale>`, shows the website's name and products |
| Request with an undeclared Host (`curl -H "Host: other.example.com" https://<server-ip>/en -k`) | `404` |
| Temporarily set a wrong `BANIJ_CREDENTIAL_SECRET`, restart, open the shop | `503` "temporarily unavailable"; the log shows `{"channel":"identity","event":"identity_mismatch","check":"credential",…}`. **Restore the real secret and restart.** |
| Server log contains no secret | `grep` the log for the secret value → no match |
| Cart → checkout → **Calculate total** | ERP prices and delivery appear. **Do not place a test order on a production website.** |

## 8. Rotate the credential

1. In the ERP, rotate or regenerate the website's credential. The old one stays valid for the ERP's rotation grace window.
2. Edit `BANIJ_CREDENTIAL_KEY_ID` / `BANIJ_CREDENTIAL_SECRET` in `.env` and restart the storefront.
   - Cached website identity is keyed by credential, so the new credential is checked against the ERP immediately. Nothing cached under the old key is reused.
3. Revoke the old credential in the ERP once the shop is serving.

## 9. Troubleshooting

| Symptom | Log event | Cause → fix |
|---|---|---|
| Server will not start | `Installation environment missing or malformed: <VAR>` | Fix `<VAR>` in `.env` (format: https URL / `wsk_` + 26 characters / 64 lowercase hex) |
| Server will not start | site-config validation error | Fix `site/site.config.json` (schema v2; no credentials; lowercase hosts) |
| 503 on every page | `identity_mismatch` `check:"credential"` | The ERP refused the credential: wrong or revoked key id or secret |
| 503 on every page | `identity_mismatch` `check:"stated_host"` | The primary domain does not belong to the credential's website, or is not verified and active in the ERP |
| 503 on every page | `identity_mismatch` `check:"website"` | The credential belongs to a different website than `website.id` |
| 503 on every page | `identity_mismatch` `check:"primary_host"` | The ERP does not list the configured primary for this website |
| 503, `Retry-After: 30` | `/site failed ERP unreachable` | The ERP is down or unreachable over HTTPS. If the ERP answers `https_required`, the ERP must be served so PHP sees HTTPS (Caddy `php_fastcgi`) |
| 404 on an alias | `alias_not_registered` | Register and activate the alias in the ERP, or remove it from `aliases` |
| 404 on the main domain | — | The request Host is not the configured `primary` (check spelling and lowercase) |
