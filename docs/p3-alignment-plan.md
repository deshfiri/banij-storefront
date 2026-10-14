# Banij Master Storefront — P3 alignment implementation plan

**Date:** 2026-10-13 · **Status:** PLAN ONLY. No code changes, commits, deploys or ERP data in this step.
**Supersedes:**

- `docs/master-template-plan.md` §0, §4 (generator credential options) and §8 (A1–A8 statuses)
- `docs/provisioning-protocol.md` in full (automatic provisioning is out of scope)
- the shared-deployment parts of `docs/launch-readiness.md`

## 0. Approved model (P3, superseding D30)

- One independently installed storefront per Owner: its own domain, hosting, runtime and deployment, and its own source customization.
- One reusable Banij Master Storefront foundation. The ERP stays authoritative.
- A Super Admin generates website-scoped API credentials. An admin enters them **manually** into the storefront's server-side `.env`.
- No automatic provisioning, no secret-store push, no connection handshake.
- Single-installation mode is the production default. Shared mode is legacy development compatibility only, until cleanup is approved.

**Approvals:**

| Item | Status |
|---|---|
| A1 | approved |
| A2 | approved in principle (package boundaries to be reviewed) |
| A3 | manual `.env` only |
| A4 | approved in principle (ERP installation tracking) |
| A5 | not approved: no generator |
| A6 | not approved: no ERP orders |
| A7 | not approved: no second dev website |
| A8 | not approved: no commit |

## 1. Security model this plan implements

1. **Authentication is the credential alone.** The ERP derives the website from the HMAC credential (contract §3.5).
   - The storefront never sends a website id to the ERP, and no request parameter selects one.
   - Verified in code today: no ERP call carries a website id.
2. **`site.config.json` → `website.id` is an expected-identity assertion, never authentication.**
   - The storefront compares it with what the ERP says the credential belongs to.
   - On mismatch it serves nothing.
3. **Triple consistency check, at startup and on every `/site` refresh.** All three must hold, or the storefront answers **503**, logs `identity_mismatch` (no secrets), and caches nothing:
   - **Website:** ERP `GET /site` → `data.id` equals the configured `website.id`.
   - **Host:** the configured `domains.primary` is one of the ERP's registered hosts for that website (`/site.hosts.primary`, `.subdomain` or `.aliases`). The ERP independently enforces the same through `X-Feriwala-Storefront-Host` (`403 host_mismatch`).
   - **Request host:** the incoming `Host` is the configured primary or a configured alias (redirect to the primary), or a configured development host when `NODE_ENV` is not production.
4. **Credentials live only in server-side environment:**
   - `BANIJ_ERP_BASE_URL`
   - `BANIJ_CREDENTIAL_KEY_ID`
   - `BANIJ_CREDENTIAL_SECRET`

   None of these reaches `site.config.json`, the repository, the build or the browser.
5. **Order access (SF-11, depends on ERP ER-11).**
   - On placement the ERP returns an order-specific authorization token.
   - The storefront stores it in the browser's **server-side** order session (Redis, never a cookie value or HTML).
   - It supplies the token on every protected order operation: read, COD code request, COD confirm, cancel, and payment session.
   - **No production credential may carry unrestricted `orders:read`.** No production-readiness claim is made until ER-11/SF-11 authorization is verified end to end.

## 2. Files to RETAIN unchanged

These are the working MVP. Behaviour must not change.

| Area | Files |
|---|---|
| ERP SDK and signing | `src/server/erp.ts`, `src/server/signing.ts`, `src/lib/types.ts` (A2 review may move them into a package unchanged) |
| Crypto helpers | `src/server/crypto.ts` (`sha256Hex`, `hmacHex`, `constantTimeEqualHex`, `randomToken`; the registry AES helpers are removed later, see §4) |
| Catalogue | `src/server/catalog.ts`, `src/components/catalog.tsx`, `src/components/product-card.tsx`, `src/components/price.tsx`, `src/components/add-to-cart.tsx` |
| Pages | `src/app/[lang]/products/(list)/page.tsx`, `src/app/[lang]/products/(list)/loading.tsx`, `src/app/[lang]/products/[slug]/page.tsx`, `src/app/[lang]/categories/[slug]/page.tsx`, `src/app/[lang]/cart/page.tsx`, `src/app/[lang]/error.tsx`, `src/app/[lang]/not-found.tsx` |
| Checkout UI | `src/components/checkout-form.tsx` |
| Areas, health | `src/app/api/areas/route.ts`, `src/app/api/health/route.ts` |
| i18n, formatting, themes | `src/lib/i18n.ts`, `src/lib/format.ts`, `src/app/globals.css` |
| Host validation | `src/server/host.ts` (`normalizeHost`; `subdomainOf` is removed later) |
| Redis client | `src/server/redis.ts` (key layout is kept; the `websiteKey` prefix stays harmless in single-installation mode) |
| Customization layer | `site/theme.css`, `site/customizations.tsx` |
| Tooling | `next.config.ts`, `eslint.config.mjs`, `playwright.config.ts`, `vitest.config.ts`, `tsconfig.json`, `tests/stubs/server-only.ts` |
| Dev ERP shim | `dev/erp-router.php`, `dev/erp-tls-proxy.mjs`, `dev/bundle-scan.sh`, `dev/e2e.sh`, `dev/free-port.sh`, `dev/status-codes.sh`, `dev/listing-probe.sh` |
| Tests kept as-is | `tests/unit/security.test.ts`, `tests/integration/cart.test.ts`, `tests/e2e/visual.spec.ts` |
| Records | `dev/demo-data.json`, `docs/erp-cod-settings-spec.md` (still valid), `AGENTS.md` |

## 3. Files to ADAPT (implementation, after this plan is accepted)

| # | File | Change |
|---|---|---|
| 1 | `src/server/site-config.ts` | `storefrontMode()`: default **`single`**. `shared` only when `STOREFRONT_MODE=shared` **and** `NODE_ENV !== "production"`; otherwise startup fails with a clear error. Credential from `BANIJ_CREDENTIAL_KEY_ID` + `BANIJ_CREDENTIAL_SECRET` (env only; drop the `_FILE` variant and `secretEnv` indirection). ERP base URL from `BANIJ_ERP_BASE_URL`. Validate env once at startup (format of key id, 64-hex secret, https URL), never logging values |
| 2 | `src/config/site-schema.ts` | Remove the `credential` block and `erp.baseUrl` (both move to env). Keep `website.id` documented as *expected identity*. Keep domains, theme, locale, features, deployment and template version. Keep the secret guard, extended to refuse `wsk_` key ids too |
| 3 | `site/site.config.json` | Drop `credential` and `erp`; bump `schemaVersion` to 2 (the schema accepts only v2) |
| 4 | `.env.example` | Rewrite for single installation: `BANIJ_ERP_BASE_URL`, `BANIJ_CREDENTIAL_KEY_ID`, `BANIJ_CREDENTIAL_SECRET`, `STOREFRONT_REDIS_URL`. Shared and registry variables go in a clearly marked "legacy development only" block |
| 5 | `src/server/tenant.ts` | Single branch becomes the main path. Add the **host** leg of the triple check (configured primary ∈ ERP hosts) next to the existing website-id check; both answer `unavailable` (503), not `not-found`, and log `identity_mismatch`. Shared branch stays, but is reachable only in dev compatibility mode |
| 6 | `src/server/env.ts` | `erpBaseUrl` from `BANIJ_ERP_BASE_URL` in single mode. `registryKey` and `rootDomain` are required only in shared dev mode |
| 7 | `src/proxy.ts` | Drop the provisioning-host branches when the route is removed (§4). Health and locale handling unchanged |
| 8 | `src/server/cart.ts` | **SF-11:** replace the order-id set with a server-side order session: `bsf:t:{site}:session:{id}` → hash `orderId → token` (TTL 30 days), written only by placement. `canViewOrder` becomes `orderTokenFor(orderId) → string \| null`. The token is never sent to the browser |
| 9 | `src/server/checkout.ts` | **SF-11:** capture the token from the `POST /orders` 201/200 response, and from the pending-attempt replay. `readOrder` and `orderWrite` take the token and send it as the ER-11 header. A missing token means no ERP call (404 to the user) |
| 10 | `src/app/actions.ts`, `src/app/[lang]/orders/[id]/page.tsx` | Use `orderTokenFor` instead of `canViewOrder`; pass the token through `readOrder` / `orderWrite` |
| 11 | `src/server/urls.ts` | Canonical origin from the configured primary host. Remove the dev-suffix mapping |
| 12 | `src/app/robots.ts`, `src/app/sitemap.ts`, `src/app/[lang]/layout.tsx` | Unchanged logic. They already resolve the single tenant; verify only |
| 13 | `src/app/[lang]/page.tsx`, `src/app/[lang]/checkout/page.tsx` | Unchanged (feature flags, slots). Verify only |
| 14 | `deploy/Dockerfile` | Unchanged build. Document env-only credentials; the image never contains `.env` (already excluded) |
| 15 | `deploy/Caddyfile` | Replace with a **per-installation** Caddyfile: one site block for the configured primary (+ aliases → redirect), automatic TLS for those names only, no on-demand TLS, no provisioning listener. The ERP site block moves to an ERP-side deployment document |
| 16 | `deploy/redis-storefront.conf` | Keep: one Redis per installation (or a dedicated ACL user and key prefix on shared infrastructure) |
| 17 | `dev/independent-builds.sh`, `dev/single-site-e2e.sh` | Credentials via env (`BANIJ_*`), not `secretEnv`/`_FILE`; site B config without a `credential` block; keep every existing assertion |
| 18 | `dev/site-secret.mjs` | Replace with `dev/dev-env.sh`: writes a 0600 `.env.local` for a generated site from the **dev** registry once, then the registry is no longer needed (dev-only; deleted with the registry) |
| 19 | `tests/unit/site-config.test.ts` | Update for schema v2: credential and ERP fields refused in config; `wsk_` and secret refusal |
| 20 | `tests/integration/erp.test.ts`, `tests/integration/unavailable.test.ts` | Resolve the tenant through single-installation config and env instead of the registry |
| 21 | `tests/integration/two-tenant.test.ts` | Rewrite as **two installations** (two env sets, two configs, two Redis DBs) rather than two registry entries. Still skipped until A7 |
| 22 | `tests/e2e/checkout.spec.ts` | Keep `E2E_NO_ORDER`. Add SF-11 assertions (below), active only when ER-11 is available |
| 23 | `README.md` | Single installation is the documented path; shared and registry move to a "legacy development" appendix |
| 24 | `package.json` | Remove the `registry` script with §4; keep the others |

## 4. OBSOLETE code to remove later (separate, approved cleanup; not now)

| Remove | Why |
|---|---|
| `src/app/api/internal/registry/route.ts`, `src/server/provisioning.ts`, `src/server/provisioning-crypto.ts` | Automatic provisioning is out of scope (manual `.env` only) |
| `scripts/provision-send.mjs`, `scripts/provisioning-keys.mjs`, `dev/provisioning-check.sh`, `tests/unit/provisioning.test.ts` | Same |
| `docs/provisioning-protocol.md` | Superseded. Archive or mark it superseded; do not hand it to the ERP session |
| `src/server/registry.ts`, `scripts/registry.mjs`, the registry AES helpers in `src/server/crypto.ts` (`encryptSecret`/`decryptSecret` and their unit tests) | The shared multi-tenant registry is not the production model |
| Shared branch of `src/server/tenant.ts`, `canonicalHostFor` / `STOREFRONT_DEV_HOST_SUFFIX`, `subdomainOf` in `host.ts`, `STOREFRONT_ROOT_DOMAIN`, `STOREFRONT_REGISTRY_KEY` | Shared mode retirement |
| `deploy/Caddyfile` sections: on-demand TLS, `ask` endpoint, provisioning listener, catch-all `https://` | Each installation has fixed names |
| `dev/smoke.sh`, `dev/restart-next.sh` (shared-mode dev server) | Superseded by single-installation dev scripts |
| `docs/launch-readiness.md` §5 shared topology, `docs/master-template-plan.md` §0/§4 | Superseded by this plan (keep the files as history; mark them) |
| Template default files `src/app/layout.tsx`, `src/app/page.tsx` | Already deleted in the working tree; still in the initial scaffold commit, so the deletion lands with the first approved commit |

**Removal precondition:** single-installation dev runs the full suite green without `STOREFRONT_MODE=shared`, and the cleanup is explicitly approved.

## 5. ERP dependencies

| ID | Dependency | Needed for |
|---|---|---|
| **ER-11** | Order-specific authorization token issued at `POST /orders`, required for read, COD code and confirm, cancel and payment session. Need from the ERP session: field name in the 201/200 body, request header name, lifetime, whether it survives an idempotent replay (must), and the error code for a missing or wrong token (must be indistinguishable from not-found) | SF-11; production readiness |
| ER-11b | Credential scopes without unrestricted `orders:read` (order reads authorised by token, not by scope alone); `GET /orders` list either removed from storefront credentials or token-scoped | Production credential issuance |
| A4 | ERP installation tracking: per website, template version, installed domain(s), deployment environment, last verified `/site` identity, operator, timestamps (append-only, audited) | Operations, upgrades |
| — | Super Admin screen to generate website-scoped credentials with the minimum scopes (`catalog:read`, `orders:write`, and order access per ER-11), shown once for manual `.env` entry, rotate and revoke | Installation |
| — | Every installation's domain registered on the website and **verified and active** (TXT `_banij-verify`) | `X-Feriwala-Storefront-Host`, payment `return_url`, host leg of the triple check |
| — | Still open: P2 migrations (sorting and flash deals), COD settings writer (`docs/erp-cod-settings-spec.md`), ERP served so `isSecure()` holds (`php_fastcgi`), `webhooks` queue in the worker, webhook rotation signing | Launch |
| — | No longer needed for storefronts: the TLS on-demand ask endpoint for storefront domains, provisioning, the host↔registry mapping. ERP-side cleanup is the ERP session's decision | — |

## 6. Test plan

| Requirement | Test | Type | Runs now? |
|---|---|---|---|
| Single mode is the production default; shared refused in production | `site-config.test.ts`: mode resolution matrix (`NODE_ENV` × `STOREFRONT_MODE`) | unit | yes |
| Credentials only in env; config refuses credential, ERP URL, `wsk_` and secrets | `site-config.test.ts` (schema v2) | unit | yes |
| Env validation never prints values | unit: malformed key id/secret/URL → error message names the variable, not the value | unit | yes |
| Configured website id is assertion only | integration: ERP `/site` id ≠ config → 503 `identity_mismatch`, nothing cached, no catalogue served (simulated via cached `/site`, as in `unavailable.test.ts`) | integration | yes |
| Host leg of the triple check | integration: config primary not in ERP hosts → 503; ERP `host_mismatch` → 503; request host not configured → 404 | integration | yes |
| One installation's credential cannot serve another website | `independent-builds.sh`: site B with site A's credential → 503 (`host_mismatch`), never A's data | harness | yes |
| Independent builds and customization isolation | `independent-builds.sh` (24 existing assertions, adapted to env credentials) | harness | yes |
| No secret in build or bundle | `bundle-scan.sh` per build, including actual `BANIJ_CREDENTIAL_SECRET` value | harness | yes |
| Cart isolation | `cart.test.ts` plus a separate Redis per installation in the harness | integration | yes |
| MVP preserved: catalogue, detail, cart, quote | `checkout.spec.ts` with `E2E_NO_ORDER=1` in single mode; `visual.spec.ts`; `status-codes.sh` adapted to the single installation | E2E | yes |
| COD placement and confirmation | `checkout.spec.ts` full | E2E | **after A6** |
| SF-11 token: stored server-side only | E2E: after placement, no cookie value, HTML or JS payload contains the token; Redis order session holds it | E2E + integration | after A6 + ER-11 |
| SF-11: protected operations need the token | integration: read, code, confirm, cancel without token → refused; another order's token → refused; correct token → OK; idempotent replay returns the same token | integration | after ER-11 |
| ER-11b: credential without unrestricted `orders:read` | integration: `GET /orders/{id}` and `GET /orders` without token refused for the production scope set | integration | after ER-11 |
| Cross-installation order isolation | `two-tenant.test.ts` rewritten as two installations | integration | **after A7** |

## 7. Recommended implementation order

| Step | Work | Depends on | Estimate |
|---|---|---|---|
| 1 | Mode default flip + production guard (`site-config.ts`) and tests | — | 0.25 day |
| 2 | Credentials and ERP URL to env; schema v2; `.env.example`; harness and dev scripts adapted | 1 | 0.5 day |
| 3 | Triple identity check (website id, configured host ∈ ERP hosts, request host) + tests | 2 | 0.5 day |
| 4 | Re-run the full no-order suite in single mode as the default (unit, integration, harness, E2E no-order, visual, bundle scan, build) | 3 | 0.25 day |
| 5 | Per-installation `deploy/Caddyfile`, Dockerfile env documentation, README single-install guide | 2 | 0.5 day |
| 6 | A2 package-boundary review: proposal for `@banij/erp-sdk` (`erp.ts`, `signing.ts`, contract types) and core/customization boundaries, with a customization-safety review of the `site/` slots | 4 | 0.5 day (review) + 1 day (extraction, after approval) |
| 7 | SF-11 order session store (token hash in Redis) behind the current API, ready to send the header | ER-11 contract details | 0.5 day |
| 8 | Wire SF-11 into read, code, confirm, cancel and payment session; SF-11 tests | ER-11 implemented in dev | 0.5 day + tests after A6 |
| 9 | Approved cleanup of §4 obsolete code; suite green without shared mode | explicit approval | 0.5 day |
| 10 | Generator (A5) and installation-tracking integration (A4) | approvals | not estimated here |

**Storefront total (steps 1–9):** ≈ 5–6 working days, excluding ERP work and approval waits.

**Production readiness is NOT claimed** until all of these hold: ER-11/SF-11 verified end to end, production credentials issued without unrestricted `orders:read`, P2 migrations applied, COD writer in place, ERP HTTPS (`isSecure()`) confirmed in the target hosting, and the full COD placement regression re-run (A6).

## 8. Requests

- **Approve this plan** to start steps 1–5. They are storefront-only, reversible, and create no ERP data.
- **ERP session:** publish the ER-11 contract details listed in §5, so step 7 can start.
- **A6 and A7** remain needed for the order-placement and cross-installation tests.
- **A8** (local commit) is recommended before step 9 removes code, so the working state is recoverable.
