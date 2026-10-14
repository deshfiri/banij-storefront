> **PARTLY SUPERSEDED BY P3 (2026-10-13).** The shared multi-tenant topology (§5), the provisioning
> channel (E3, A4) and the on-demand-TLS Caddy setup are replaced by independent installations — see
> `docs/installation.md` and `docs/p3-alignment-plan.md`. ERP dependencies E1, E2, E4–E7 and the
> migration commands in §3 remain current.

# Banij Storefront — Launch Readiness Report

**Date:** 2026-10-13 · **Status:** NOT READY FOR PRODUCTION. Development milestone accepted; launch blocked on ERP work and approvals listed in §7.
Nothing has been committed, pushed or deployed. The ERP repository and its data were not modified in this phase (read-only inspection only).

---

## 1. Completed storefront fixes

| Item | Result | Evidence |
|---|---|---|
| Unknown product / category / order → HTTP 404 | Fixed. Cause: a locale-wide `loading.tsx` flushed a 200 shell before `notFound()`; the skeleton now lives only on the product list route group | `dev/status-codes.sh` 22/22; E2E asserts `404` |
| Bengali text and ৳ rendered as empty boxes on devices without a Bengali font | Fixed: Noto Sans Bengali self-hosted by `next/font` at build time (no runtime Google request) | Screenshots `test-results/visual/*-bangla.png` |
| Homepage blank when the ERP refuses sorted listings | Fixed: "New arrivals" falls back to the default listing; other sections hide | Homepage shows 5 products while sorts are refused |
| Classic / Modern / Minimal themes | Verified in a real browser (desktop 1280 + mobile 390), 5 pages each, no horizontal overflow. Preview uses a development-only cookie that production ignores | 30 screenshots, 6 theme tests |
| Error, unavailable, empty states | Verified: ERP unreachable → 503 + `Retry-After: 30`, not cached; suspended → 503 without reason; maintenance message shown and HTML-escaped; empty search; empty cart; checkout without cart → cart | `tests/integration/unavailable.test.ts`, `visual.spec.ts` |
| Redis cart security | Verified: 128-bit random id; cookie host-only, HttpOnly, SameSite=Lax (Secure in production); cart key includes the website, so the same cookie on another website reaches nothing; forged cookie values ignored; 10 concurrent writers lose no update | `tests/integration/cart.test.ts`, `visual.spec.ts` |
| Secure credential provisioning (storefront side) | Implemented: `POST /api/internal/registry`, internal host only, HMAC + timestamp + single-use nonce, X25519/HKDF/AES-256-GCM sealing bound to website+key+revision, revision ordering, credential verified live against the ERP before storing, secret-free audit lines. Operator CLI is break-glass only in production | §4; `docs/provisioning-protocol.md` |
| Host-independent health check | `GET /api/health` (Redis ping, no data) for Caddy | — |
| Container build | `deploy/Dockerfile` (standalone output, non-root, bundle scan in build) | Build passes |
| Dev data inventory | Test orders #2–#7 recorded with reservations and how they were created | `dev/demo-data.json` |
| Secrets | `.env.local`, `dev/tls/` git-ignored; bundle scan extended to provisioning secrets and their actual values | `dev/bundle-scan.sh`: CLEAN |

**Correction to the MVP report.** The MVP smoke test checked status codes only. Sorted listings (`newest`, `featured`, `price_*`, `best_selling`) and `flash_deal` return 200 **with the error state**, because the ERP fails with `column website_products.promotion_starts_at does not exist` (pending migration A, §3). Default listing, search, category, in-stock filter, detail, cart, quote and COD order are unaffected. Sorting starts working when the migrations are applied.

## 2. Remaining ERP dependencies

| # | Dependency | Blocks | Spec |
|---|---|---|---|
| E1 | Apply the two pending P2 migrations (dev now; production with the P2 release) | sorting, flash deals, best sellers, promotions | §3 |
| E2 | Persistent, audited COD settings writer (`SetCodTerms`, `SetWebsiteCodTerms`) | COD survives a cache flush; today it is on only because of a stale cache entry | `docs/erp-cod-settings-spec.md` |
| E3 | Provisioning sender (`ProvisionStorefrontWebsite` job + triggers + revision column) | onboarding websites to production without operator CLI | `docs/provisioning-protocol.md` §6 |
| E4 | ERP served via Caddy `php_fastcgi` + php-fpm (decision; no code) — or a `trustProxies` change if `reverse_proxy` is preferred | every Storefront API call in production (`400 https_required` otherwise) | §5 |
| E5 | Add the `webhooks` queue to the production worker (`queue:work --queue=…`) | webhook delivery (cache invalidation) | §6.1 |
| E6 | Outbound webhook signing uses only the new secret after rotation (`AttemptWebhookDelivery.php:143`) | zero-downtime webhook-secret rotation (retries recover) | §6.1 |
| E7 | `InitiateOrderPayment` throws `LogicException` when `payment_id` is null — confirm a COD order can never reach it (would be a 500, not 409) | online payment hardening | §6.2 |

## 3. Required database changes

**ERP, already written (P2, uncommitted, untracked files):**

| Migration | Effect | Lock | Down |
|---|---|---|---|
| `2026_11_05_100000_add_promotion_windows_to_website_products` | +3 columns (`promotion_starts_at`, `promotion_ends_at`, `promotion_live`), backfills `promotion_live`, 2 CHECKs, 2 partial indexes | ACCESS EXCLUSIVE on `website_products` for the ALTER+UPDATE (seconds on dev; plan a window or a batched variant for a large production table) | refuses (throws) once any promotion window exists; otherwise lossless |
| `2026_11_06_100000_create_website_product_sales` | new derived table + index on `orders(placed_at) WHERE website_id IS NOT NULL` + index on `order_return_items(order_item_id)` | SHARE (blocks writes, not reads) on `orders` / `order_return_items` while indexes build | lossless (derived; rebuilt every 15 min) |

Prepared commands (run from `~/projects/feriwala`, **only after the P2 session finishes and you approve**):

```bash
# 1. Preview (read-only)
php artisan migrate:status | tail -5
php artisan migrate --pretend \
  --path=database/migrations/2026_11_05_100000_add_promotion_windows_to_website_products.php \
  --path=database/migrations/2026_11_06_100000_create_website_product_sales.php
# 2. Apply both, one batch (Postgres runs each migration in a transaction)
php artisan migrate \
  --path=database/migrations/2026_11_05_100000_add_promotion_windows_to_website_products.php \
  --path=database/migrations/2026_11_06_100000_create_website_product_sales.php
# 3. Fill best sellers once (otherwise within 15 minutes when the scheduler runs)
php artisan schedule:test --name=website-best-sellers
# 4. Verify from the storefront
bash ~/projects/banij-storefront/dev/listing-probe.sh      # every variant: error=0
```

Rollback (only these two; they must be the latest batch):

```bash
php artisan migrate:rollback \
  --path=database/migrations/2026_11_06_100000_create_website_product_sales.php \
  --path=database/migrations/2026_11_05_100000_add_promotion_windows_to_website_products.php
```

Caveats: rollback of 11_05 refuses once a promotion window was saved; after rollback the uncommitted P2 code fails again on the same queries; never `migrate:fresh`/`refresh` (the `testing` schema belongs to the P2 suite). These migrations touch only the `public` schema.

**ERP, to be written:** `websites.storefront_registry_revision BIGINT NOT NULL DEFAULT 0` (provisioning revision, E3). COD writer needs **no** schema change.
**Storefront:** no database. Redis keys only (`bsf:*`).

## 4. Security and tenant-isolation results

All run on 2026-10-13 against the live dev ERP and dev Redis.

| Area | Result |
|---|---|
| Request signing | Matches the ERP's own PHP `RequestSignature` byte-for-byte (golden test) |
| Host validation | Unknown, IP, userinfo, path, multi-value, malformed hosts → 404; forged `X-Forwarded-Host` ignored; internal provisioning host never serves a shop |
| Credential ↔ host pairing | ERP refuses website 2's credential stating website 1's host: `403 host_mismatch`; wrong secret: `401` |
| Order exactly-once | Double-click → one order; same key+body replay → same order; same reference + new key → `409 duplicate_storefront_order`; claimed price → `422 price_mismatch` |
| Order privacy | Another browser (no session) gets 404 for an order URL, identical to an unknown id |
| Cart isolation | Same cookie on two websites → two carts; forged cookie ignored; concurrent writes serialised |
| Provisioning channel | 7/7: applied, unchanged, stale, replay → 401, wrong secret → 401, credential presented as another website → 422 (registry untouched), public host → 404; 12 unit tests on sealing and authentication |
| Client bundle | No credential, key, signing code, ERP path, provisioning secret or their actual values |
| **Two-tenant isolation with two live websites** | **NOT RUN** — requires creating a second dev website (approval A2). Suite is written: `tests/integration/two-tenant.test.ts` (host mismatch both ways, catalogue separation, cross-website quote refused, cross-website order read → 404, order list separation, same phone = two customers) |

Test totals this phase: unit 42/42 · integration 13/13 (+6 two-tenant pending) · E2E 17/17 run (checkout with COD confirmation; catalogue; 3 themes × 2 viewports; states; cookie) · status sweep 22/22 · typecheck, lint, production build pass.

Known limitation: the visual review was in headless Chromium at two viewports, not on physical devices or Safari/Firefox.

## 5. Deployment requirements

Topology (D30 §4): one VPS, Docker, Caddy at the edge, ERP (php-fpm) + queue workers + scheduler, storefront container(s), PostgreSQL, ERP Redis, **separate storefront Redis**.

| Component | Requirement | File |
|---|---|---|
| Caddy | ERP site via `php_fastcgi` (sets `HTTPS=on`; real `REMOTE_ADDR`); on-demand TLS for every partner host with `ask` → `/api/internal/tls/authorize?token=…`; internal provisioning listener restricted to ERP egress IPs; `/api/internal/*` refused on public hosts; HTTP → HTTPS 308 | `deploy/Caddyfile` (not validated with a Caddy binary here — run `caddy validate` before use) |
| ERP config | `STOREFRONT_TLS_ASK_TOKEN`, optionally `STOREFRONT_TLS_ASK_ALLOWED_IPS` = Caddy; `STOREFRONT_DOMAIN`; worker includes `webhooks` queue (E5); gateways stay `sandbox` | ERP `.env` (not read) |
| Storefront | `NODE_ENV=production`, `ERP_BASE_URL` (https), `STOREFRONT_REDIS_URL`, `STOREFRONT_REGISTRY_KEY`, `STOREFRONT_ROOT_DOMAIN`, the four `STOREFRONT_PROVISIONING_*` from the secret store. Never set the dev-only variables (`STOREFRONT_DEV_HOST_SUFFIX`, `…_PUBLIC_SCHEME`, `…_PUBLIC_PORT`, `…_INSECURE_COOKIES`) | `deploy/Dockerfile`, `.env.example` |
| Storefront Redis | dedicated instance, ACL user without dangerous commands, `noeviction`, AOF `everysec` + snapshots, private network | `deploy/redis-storefront.conf` |
| DNS | wildcard `*.{storefront domain}` → Caddy; partner custom domains → Caddy after TXT `_banij-verify.{domain}` and admin Verify + Activate (manual buttons; no scheduler) | — |
| Secrets | registry key, provisioning private key + HMAC secret, TLS ask token, Redis ACL password: secret manager, rotated deliberately | — |

## 6. Plans for remaining integration

### 6.1 ERP webhook invalidation (storefront ≈ 0.5–1 day after E5)

- Route `POST /api/webhooks/feriwala` on each website's own host (the ERP sends to the website's registered endpoint). Read raw body; verify `X-Feriwala-Signature: sha256=HMAC(secret, timestamp + "." + body)` constant-time, ±300 s; accept the current **and** previous webhook secret during rotation.
- Webhook secret delivered by the provisioning channel (add `webhook_secret` sealed like the credential — additive to protocol v1). The resolved host must be the event's `website_id`, or 404.
- Deduplicate on `X-Feriwala-Delivery` (`SET NX`, 7 days). Ignore events whose `occurred_at` is older than the last applied for that subject. Answer 2xx within 10 s; work is O(1).
- Effects: `product.*`, `inventory.*`, `category.updated` → bump the website's cache version (one `INCR`); `website.updated` / `.suspended` / `.restored` → drop the cached `/site`. Webhooks remain hints (contract §7.5); checkout already re-prices at the ERP.
- Testing: the ERP refuses `*.localhost` and private addresses, so end-to-end needs a public HTTPS tunnel or staging. Unit tests use the ERP's documented signature.

### 6.2 Online payment (storefront ≈ 1.5–2 days; sandbox only)

- Offer `online` only when `/site` lists it. `POST /orders` with `payment: { method: "online", return_url: "https://{primary}/{lang}/payment/return" }` (HTTPS, port 443, the website's own verified host — so it needs staging or a tunnel, not `*.localhost`).
- On 201: redirect the browser to `payment.redirect_url` (gateway page; no card data touches the storefront). If null, call `POST /orders/{id}/payment-session` with a new idempotency key.
- Return page: the ERP appends `?order=&payment=`; treat both as a greeting. Require the order to be in this browser's session, then `GET /orders/{id}` and show `payment.state` (`awaiting`/`confirming` → poll with backoff; `paid` → confirmation; `failed`/`cancelled` → retry via `payment-session` while the 15-minute reservation lasts). **Never** mark paid from the redirect; settlement is the ERP's IPN + server-side verification.
- Exactly-once reuses the COD attempt machinery (key and payload persisted before the call).
- Live mode stays off: `payment.{gateway}.mode` must remain `sandbox` until explicitly approved.

### 6.3 Production Redis
`deploy/redis-storefront.conf`; monitor memory against `noeviction` (alert at 70%); AOF on persistent volume; nightly RDB copy; carts expire in 30 days, attempts in 24 h, site cache 60 s, catalogue 60 s, areas 1 h.

### 6.4 Caddy deployment
`caddy validate` on `deploy/Caddyfile`; staging first with the ACME staging CA; confirm the ask endpoint refuses an unverified name (no certificate issued) and that a suspended website still gets HTTPS and the 503 page.

### 6.5 Domain verification and TLS
Admin issues a token → partner publishes TXT `_banij-verify.{domain}` and points DNS at Caddy → admin Check → Activate → ERP pushes the new host list over the provisioning channel (E3) → first HTTPS request triggers the certificate via the ask endpoint. Lapse/closure → ERP pushes the new host list/remove; the ask endpoint refuses renewal.

## 7. Estimated remaining work

| Work | Owner | Estimate |
|---|---|---|
| Apply migrations + verify (E1) | ERP / ops | 30 min after approval |
| COD settings writer + tests (E2) | ERP session | 0.5–1 day |
| Provisioning sender + revision column + tests (E3) | ERP session | 1–1.5 days |
| Webhook queue in worker, rotation signing fix (E5, E6) | ERP session | 0.5 day |
| Two-tenant run (after A2) | storefront | 1 hour |
| Webhook receiver | storefront | 0.5–1 day |
| Online payment (sandbox) | storefront | 1.5–2 days |
| Staging environment (Caddy, Redis, containers, DNS) + rehearsal | ops + both | 1–2 days |
| Security review gate (D30 §10: tenant isolation across hosts, certificate refusal, bundle, DNS takeover) | reviewer | 1 day |
| **Total to launch-ready** | | **≈ 6–9 working days**, parallelisable to ≈ 4–5 |

## 8. Approval requests

| # | Request | Effect if approved |
|---|---|---|
| **A1** | Apply the two P2 migrations to the **dev** database once the P2 session has finished, using §3 commands, then run the best-seller refresh once | Sorting, flash deals, best sellers work in dev; promotions can be seeded |
| **A2** | Create a second **dev** website ("tenant B") through ERP actions: website for an existing or new dev business account, credential (`catalog:read`, `orders:write`, `orders:read`) delivered through the new provisioning channel, 1–2 products published only on B; then run `tests/integration/two-tenant.test.ts` (places one COD order on each website) | Genuine two-tenant isolation evidence |
| **A3** | Hand `docs/erp-cod-settings-spec.md` to the ERP session for implementation; confirm the permission choice (platform `order.manage_settings`; website override `website.edit`) and that COD defaults to **off** | Removes the stale-cache COD dependency |
| **A4** | Hand `docs/provisioning-protocol.md` §6 to the ERP session, including the `websites.storefront_registry_revision` migration | Production onboarding without operator access to secrets |
| **A5** | Decide the ERP runtime: Caddy `php_fastcgi` + php-fpm (recommended, no ERP code change) **or** `reverse_proxy` + a `trustProxies` change in the ERP | Storefront API reachable over HTTPS in production |
| **A6** | Add the `webhooks` queue to the ERP worker and fix rotation signing (E5, E6) | Webhook invalidation can be built and tested |
| **A7** | Start the online-payment integration in **sandbox** (live mode remains off pending a separate approval) | P2 feature work begins |
| **A8** | When to commit the storefront repository (local commit only; no push) | Work is preserved under version control |
