# Banij Master Storefront

The reusable foundation for Banij storefronts. Under P3, **every Owner's website is an independent
installation** with its own domain, hosting, runtime and deployment, built from this template. The
central Banij ERP is the only backend: prices, stock, orders and payments are decided there and
reached only through the frozen Storefront API v1 (`feriwala/requirements/05-storefront-api-contract.md`).

**Installing a website → [docs/installation.md](docs/installation.md).**

> **Not production-ready yet.** An installation must not take real customers until both of these hold:
>
> - ERP order-specific authorization (ER-11) and its storefront use (SF-11) are verified.
> - The website's credential carries no unrestricted `orders:read`.

## One installation = one website

| What | Where | Notes |
|---|---|---|
| Public configuration: expected website id, domains, theme, locale, features | `site/site.config.json` (schema v2) | No credentials, no ERP address, no secrets; refused at boot |
| Customization | `site/theme.css` (tokens), `site/customizations.tsx` (Hero, FooterNote, section order) | The only files an Owner edits |
| ERP endpoint + website-scoped credential | server-side `.env`: `BANIJ_ERP_BASE_URL`, `BANIJ_CREDENTIAL_KEY_ID`, `BANIJ_CREDENTIAL_SECRET` | Entered by hand by an admin; never in git, the image or the browser |
| Redis | `STOREFRONT_REDIS_URL` | One per installation (`deploy/redis-storefront.conf`) |
| Deployment | `deploy/Dockerfile`, `deploy/installation/{Caddyfile,compose.yaml}` | Fixed names, automatic TLS, no ERP services |

### How a request is served

1. **Host check.** `src/proxy.ts` validates `Host` (`X-Forwarded-Host` is ignored). Only the configured primary, ERP-registered aliases (308 to the primary) and, outside production, configured development hosts are served. Anything else gets a 404.
2. **Signed `/site` call.** The `.env` credential signs `GET /site` (HMAC, contract §3.2), stating the configured primary in `X-Feriwala-Storefront-Host`. The ERP derives the website **from the credential**; the configured `website.id` is only an expected-identity assertion.
3. **Identity checks.** The storefront serves only if the ERP accepted the credential and host, the website it returned is the configured one, and the configured primary is a host the ERP registered for it. Otherwise it answers 503 (a generic page) and writes a secret-free `{"channel":"identity",…}` log line. Identity is cached briefly under the **credential's key id**, so a credential change never reuses stale identity. Failures are never cached.
4. **Unavailable websites.** Suspended, preparing or maintenance websites, or an unreachable ERP, get a 503 with `Retry-After`.
5. **Locale.** A path without a locale redirects to the website's default locale.
6. **Boot validation.** `src/instrumentation.ts` refuses to start on an invalid config, an incomplete `.env`, or `STOREFRONT_MODE=shared` in production.

| Concern | Where |
|---|---|
| Signed ERP client, retries, idempotency | `src/server/erp.ts`, `src/server/signing.ts` |
| Mode, installation env, public config | `src/server/site-config.ts`, `src/config/site-schema.ts` |
| Identity and host resolution | `src/server/tenant.ts`, `src/server/current.ts`, `src/proxy.ts` |
| Catalogue reads, versioned Redis cache (60 s) | `src/server/catalog.ts` |
| Cart (Redis, host-only cookie) | `src/server/cart.ts` |
| Quote and exactly-once COD order | `src/server/checkout.ts` |
| Server actions | `src/app/actions.ts` |
| Pages | `src/app/[lang]/…` (`en`, `bn`) |
| Themes `classic` / `modern` / `minimal` | `src/app/globals.css` (+ `site/theme.css`), chosen by `/site` branding or `site.config.json` |

### Exactly-once orders

The prices an order claims are the quote the customer saw, held server-side. They never come from
the browser.

- **Before the ERP call:** the `Idempotency-Key`, the storefront reference and the exact payload are stored in Redis, and the call runs under a per-cart lock.
- **Timeout, double click or reload:** the identical request is re-sent under the same key, and the ERP answers with the order it already made.
- **Definitive refusal:** the key is discarded, so a corrected order is a new request (contract §6.1.1).
- **Unknown outcome:** an earlier request whose outcome is unknown is replayed before any new attempt can start.
- **`price_mismatch`:** the customer sees the revised total and must confirm again; nothing is accepted on their behalf.

## Run locally (WSL)

Requirements: Node 24, Redis, and the Banij ERP checked out at `~/projects/feriwala`.

```bash
npm install
cp .env.example .env.local        # then fill BANIJ_* by hand (dev credential from the ERP), chmod 600
```

The ERP refuses plain HTTP and trusts no proxy, so local development puts a TLS terminator in front of
a second ERP dev server. These are development-only shims and change nothing in the ERP:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=127.0.0.1" \
  -addext "subjectAltName=IP:127.0.0.1" -keyout dev/tls/erp-dev.key -out dev/tls/erp-dev.crt
(cd ~/projects/feriwala/public && ERP_ROOT=~/projects/feriwala php -S 127.0.0.1:8001 ~/projects/banij-storefront/dev/erp-router.php) &
node dev/erp-tls-proxy.mjs &
bash dev/restart-next.sh          # next dev on 127.0.0.1:3000 with the dev TLS root
```

Open <http://karimtraders.localhost:3000>. `karimtraders.localhost` is a `domains.development` host
in `site/site.config.json`. It is honoured only outside production.

## Tests

All of these are no-order: nothing writes ERP data unless `ALLOW_ERP_ORDERS=1` is set explicitly.

```bash
bash dev/regression.sh            # everything below, with a pass/fail summary
npm run check                     # tsc + eslint + unit tests
npm run test:integration          # live dev ERP + Redis: signing, host_mismatch, identity checks, cart isolation
npm run test:status               # HTTP status of security- and SEO-relevant routes
E2E_NO_ORDER=1 npm run test:e2e   # browser: catalogue, cart, quote, themes, states, cookies
npm run test:builds               # two generated installations: build + runtime isolation
dev/bundle-scan.sh                # after `next build`: no server-side value in the client bundle
```

---

## Appendix — legacy shared mode (development only, pending approved removal)

D30's single multi-tenant deployment is **superseded by P3**. Its code stays until an approved
cleanup and is reachable only with `STOREFRONT_MODE=shared` **outside production**. Production
refuses it at boot.

- **Code:** `src/server/registry.ts`, the shared branch of `src/server/tenant.ts`,
  `src/server/provisioning*.ts`, `src/app/api/internal/registry/route.ts`.
- **Scripts:** `scripts/registry.mjs`, `scripts/provision-send.mjs`, `scripts/provisioning-keys.mjs`.
- **Dev tooling and docs:** `dev/provisioning-check.sh`, `dev/smoke.sh`,
  `deploy/legacy-shared/Caddyfile`, `docs/provisioning-protocol.md`.
- **Provisioning:** the endpoint answers only in legacy shared development mode. A single
  installation never exposes it (P3: manual `.env` only).
- **`dev/dev-env.mjs`:** reads the dev credential from this legacy dev registry to write an
  installation's `.env.local` without printing it. It is a development bridge only.
