# Production runbook — Karim Traders storefront

For the operator who deploys one Banij storefront installation (Karim Traders, website
`01M4MHJ7BA282X3QXV1Q256ZMP`). Read [installation.md](installation.md) first; this runbook is the
exact order of operations, the checks between them, and the way back.

**Status (2026-10-14):** not deployed. Every step below needs explicit approval; the blockers in §1
must all be closed first.

---

## 1. Prerequisites (all must be true before step 3)

### 1.1 ERP side (owned by the ERP team — the storefront cannot do these)

| # | Dependency | How to confirm |
|---|---|---|
| E1 | Production ERP reachable over **HTTPS** with a publicly trusted certificate (no self-signed root) | `curl -sI https://<erp-host>/up` → `200` from the storefront server |
| E2 | ERP release containing Storefront API **v1** (contract `requirements/05-storefront-api-contract.md`) and **all migrations applied** (incl. promotion windows, website product sales, stock item soft deletes) | ERP team confirms `php artisan migrate:status` has nothing pending |
| E3 | **Admin-only credential management** committed and released; owners have a read-only Integration page | Owner's Integration page shows no Issue / Rotate / Revoke |
| E4 | Website `01M4MHJ7BA282X3QXV1Q256ZMP` exists in the **production** database, status *active*, accepting orders, with its catalogue connections published (the dev database is not production) | ERP Admin → Websites → Karim Traders |
| E5 | The production host is one of the website's **registered hosts** (`GET /site` → `hosts`). Recommended: `karimtraders.feriwala.shop` (§2.1). The QA record `karimtraders.example` must not be used | Storefront boot identity check passes (§4) |
| E6 | **Product media on one public HTTPS origin** (§2.2), with every published product's images uploaded there | A product media URL opens over HTTPS |
| E7 | **Cash on delivery** enabled for the website, with its limit, and **delivery areas** configured | `GET /site` → `checkout.cod.enabled: true`; checkout shows divisions |
| E8 | **SMS provider live** in production (COD orders are confirmed with a one-time code) | ERP Admin → SMS shows an active provider |
| E9 | A production **credential issued by a Super Admin**, with explicit scopes `catalog:read`, `orders:write`, `orders:read` (no `inventory:read`, `customers:write`, `returns:write` — this storefront does not use them) | Delivered once, as the `.env` block, to the operator only |

### 1.2 Infrastructure

- A Linux server (or container host) with Docker + Compose **or** Node.js 24, ports 80/443 reachable.
- DNS control for the chosen host (§2.1).
- Its own Redis 8 (the compose file runs one, ACL-protected, not shared with any other website).
- An operator who can hold secrets in a `0600` file and never paste them elsewhere.

### 1.3 Storefront code

- The reviewed commits on `main` (local; see the commit summary). A remote is created only with approval.
- `site/site.config.json` set for production (§3, step 2).

---

## 2. Domain and image storage (decided, not configured)

### 2.1 Domain — recommended: `karimtraders.feriwala.shop`

The platform subdomain is the safest first production host:

- it is already the website's primary in `site.config.json` and is among the hosts the ERP returns
  for this website, so the identity check passes without any new ERP record;
- the platform controls its DNS zone — no third-party registrar, no domain verification step;
- TLS is a standard ACME certificate for one exact host (Caddy, `SITE_PRIMARY_HOST`).

DNS: one `A` (and `AAAA` if IPv6) record for `karimtraders.feriwala.shop` → the storefront server. No
wildcard. A shop-owned domain can be added later as an **alias** once the ERP has verified and
activated it (domain routing in ERP Admin), then listed in `domains.aliases` and the Caddyfile.

Not for production: `karimtraders-preview.deshfiri.com` (private preview only), `karimtraders.example`
(QA placeholder in the ERP), any `*.localhost` host.

### 2.2 Images — recommended: one dedicated HTTPS media origin

The storefront accepts product images from **exactly one** origin and path prefix
(`STOREFRONT_IMAGE_ORIGIN`), fixed at build time. So:

- **Preferred:** the ERP's object storage (R2) behind a custom HTTPS domain, e.g.
  `https://media.feriwala.shop/catalog/products/` — a narrow path prefix, so the image optimizer can
  fetch nothing else.
- **Acceptable:** the production ERP's own public disk, `https://<erp-host>/storage/catalog/products/`.
- **Choose before uploading production images.** Each `product_media` row keeps the disk it was
  written to; images on a different origin than the configured one render as placeholders (and are
  logged as `untrusted_media_origin`). Moving storage later means re-uploading or migrating media.
- Never a local or private address (refused at boot on a production site), never plain HTTP.

---

## 3. Deployment (container option — recommended)

Run from a clean checkout of the reviewed commit on the build machine.

1. **Record the release.** `git rev-parse --short HEAD` → note it as `<version>` (e.g. `0.2.0-<sha>`).
2. **Production site config** — `site/site.config.json` (public, compiled into the image):
   `website.id` = `01M4MHJ7BA282X3QXV1Q256ZMP`, `domains.primary` = `karimtraders.feriwala.shop`,
   `domains.development` = `[]`, `deployment.environment` = `"production"`. Commit it (reviewed).
3. **Checks before building:**
   ```bash
   npm ci && npx tsc --noEmit && npx eslint src site && npx vitest run tests/unit
   ```
4. **Build the image** (no credential is involved; the image origin is public):
   ```bash
   docker build -f deploy/Dockerfile \
     --build-arg STOREFRONT_IMAGE_ORIGIN=https://media.feriwala.shop/catalog/products/ \
     -t banij-storefront-karimtraders:<version> .
   ```
   The build fails if any `.env` is in the context, if the image origin is missing, or if the bundle
   scan finds server-side material in browser code.
5. **On the server**, next to `deploy/installation/`:
   - `.env` from `.env.example`, filled by hand from the Super Admin's one-time block, `chmod 600`:
     `BANIJ_ERP_BASE_URL`, `BANIJ_CREDENTIAL_KEY_ID`, `BANIJ_CREDENTIAL_SECRET`,
     `STOREFRONT_IMAGE_ORIGIN` (**identical** to the build argument). Nothing else; no dev or legacy
     variables; `STOREFRONT_PREVIEW` absent.
   - `deploy/installation/caddy.env` (not secret): `SITE_PRIMARY_HOST=karimtraders.feriwala.shop`,
     `ACME_EMAIL=…`, `STOREFRONT_IMAGE=banij-storefront-karimtraders:<version>`,
     `STOREFRONT_REDIS_PASSWORD=…` (`chmod 600`, it holds the Redis password).
   - `deploy/installation/redis.acl` (`chmod 600`): `user storefront on ><password> ~bsf:* +@all -@dangerous`, `user default off`.
6. **DNS:** point `karimtraders.feriwala.shop` at the server (approval required). Wait until it resolves.
7. **Start:**
   ```bash
   docker compose -f deploy/installation/compose.yaml --env-file deploy/installation/caddy.env up -d
   docker compose -f deploy/installation/compose.yaml logs -f storefront   # until ready
   ```
   The storefront **refuses to start** (and names the variable, never its value) on a bad `.env`,
   shared mode, a local or mismatched image origin, or an invalid site config. Fix and restart.

Node.js option (no containers): `npm ci && npm run build` with the same `.env` present (the build
reads `STOREFRONT_IMAGE_ORIGIN` from it), then `NODE_ENV=production npm start` behind Caddy with
`STOREFRONT_UPSTREAM=127.0.0.1:3000`, under a process supervisor (systemd) that restarts on failure.

---

## 4. Post-deployment verification (no orders unless approved)

| Check | Expected |
|---|---|
| `curl -s https://karimtraders.feriwala.shop/api/health` | `200` |
| `curl -sI http://karimtraders.feriwala.shop/` | redirect to HTTPS |
| Certificate | valid, issued for `karimtraders.feriwala.shop` |
| `/en` and `/bn` | the shop's name, categories, products, ERP prices in ৳; no preview banner |
| Product images | load through `/_next/image` as WebP; none fall back to placeholders unexpectedly |
| Storefront log | no `identity_mismatch`, no `untrusted_media_origin`, no `ERP unreachable` |
| A host that is not the shop's | Caddy serves no certificate for it; the storefront itself answers `404` for any unregistered host |
| `/robots.txt`, `/sitemap.xml` | served for the production host; no `noindex` header on pages |
| Cart | add, change quantity with the stepper, remove — totals from the ERP quote |
| Checkout | the form loads with divisions and the COD option; **"Calculate total" only** |
| ERP Integration page (owner view) | recent calls `200` from this website; key `last used` updates |
| Bundle | `bash dev/bundle-scan.sh` on the build output: `BUNDLE CLEAN` |

**First real order:** only with explicit approval, by a named person, with a real phone number for the
SMS code, then cancelled or fulfilled in the ERP as agreed. Record the order number.

---

## 5. Rollback

The storefront holds no business data (orders, stock and prices live in the ERP), so rollback is a
redeploy.

1. **Bad release:** set `STOREFRONT_IMAGE` in `caddy.env` back to the previous tag and
   `docker compose … up -d`. Keep the last two image tags on the server.
2. **Bad configuration:** restore the previous `.env` (keep a `0600` copy, never in git) and restart.
3. **Take the shop offline:** `docker compose … stop storefront` — Caddy then answers `502`; or set
   the website to maintenance in ERP Admin (the storefront shows its maintenance page).
4. **Credential compromised:** a Super Admin revokes it in the ERP (immediately refused everywhere),
   issues a new one, the operator updates `.env` and restarts. Never reuse a revoked secret.
5. **DNS:** remove or repoint the record (the old certificate expires on its own).

Carts live in the installation's Redis (`bsf:` keys) for their TTL; losing Redis loses carts, never orders.

---

## 6. After go-live

- Watch the storefront log and the ERP Integration page for the first day.
- Rotate the credential on the ERP's schedule (§8 of installation.md).
- Images: upload every published product's media to the configured origin before publishing it.
