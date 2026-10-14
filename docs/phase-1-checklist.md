# Phase 1 readiness — implementation checklist (steps 1–5)

**Date:** 2026-10-13 · **Status:** checklist only; nothing below is implemented yet.

**Guardrails for the whole phase:**

- No ER-11/SF-11 work.
- No ERP orders. Every order-placing test runs with `E2E_NO_ORDER=1` or stays skipped.
- No ERP code or data changes, no commit, no push, no deploy.
- Every step leaves the repository runnable, and the regression in §4 is re-run after each step.

Baseline (current, all green):

| Suite | Result |
|---|---|
| Unit | 48 |
| Integration | 13 (6 two-tenant skipped) |
| Independent-build harness | 24 assertions |
| E2E no-order and visual | 14 (shared) / 2 (single) |
| Status sweep | 22 |
| Build, typecheck, lint, bundle scan | pass |

---

## Step 1 — Single installation is the production default

| # | File | Exact change | Done when |
|---|---|---|---|
| 1.1 | `src/server/site-config.ts` | `storefrontMode()`: return `"shared"` only if `STOREFRONT_MODE === "shared"` **and** `NODE_ENV !== "production"`; otherwise `"single"`. Add `assertDeploymentMode()`: throws if `NODE_ENV === "production"` and `STOREFRONT_MODE === "shared"` | Unit matrix passes (1.6) |
| 1.2 | `src/instrumentation.ts` (**new**) | `register()` calls `assertDeploymentMode()`, then (step 2) `assertInstallationEnv()` and `siteConfig()`, so a misconfigured production server **fails at boot**, not on the first request. Error messages name variables, never values | Boot with bad env → process exits non-zero, no secret in output |
| 1.3 | `src/server/provisioning.ts` | `provisioningConfig()` returns `null` unless `storefrontMode() === "shared"` (legacy dev). Single installations never expose `/api/internal/registry` | Status check: `/api/internal/registry` on any host → 404 in single mode, even with provisioning vars in env |
| 1.4 | `src/proxy.ts` | No logic change; it already defers to `isProvisioningRequest`, which now returns false in single mode. Verify only | — |
| 1.5 | `.env.local` (dev, git-ignored) | Add `STOREFRONT_MODE=shared` so the running dev server on :3000 keeps its current behaviour until step 2 switches dev to single | Dev server unchanged after restart |
| 1.6 | `tests/unit/site-config.test.ts` | Add a mode matrix: (unset, dev) → single; (unset, prod) → single; (shared, dev) → shared; (shared, prod) → `assertDeploymentMode` throws; (single, any) → single. Add: provisioning disabled in single mode | +2 tests green |

## Step 2 — Credentials and ERP endpoint in server-side `.env` only

**Contract after this step:**

- `site/site.config.json` holds public, non-secret metadata only.
- The installation's `.env` holds:
  - `BANIJ_ERP_BASE_URL`: https URL
  - `BANIJ_CREDENTIAL_KEY_ID`: `wsk_` + 26-character ULID
  - `BANIJ_CREDENTIAL_SECRET`: 64 lowercase hex
  - `STOREFRONT_REDIS_URL`

| # | File | Exact change | Done when |
|---|---|---|---|
| 2.1 | `src/config/site-schema.ts` | `SITE_CONFIG_SCHEMA_VERSION = 2`; `schemaVersion: z.literal(2)`. **Remove** `erp` and `credential` from the schema; `.strict()` then refuses them. Extend `looksSecret()` to also refuse `wsk_[0-9A-Z]{26}` (key ids belong in env, not config). Document `website.id` as *expected identity, not authentication* | Config containing `credential`, `erp` or a `wsk_` id fails validation |
| 2.2 | `site/site.config.json` | `schemaVersion: 2`; delete the `erp` and `credential` keys. All other keys unchanged | `parseSiteConfig` passes |
| 2.3 | `src/server/site-config.ts` | Replace `singleSiteCredential(config)` with `installationCredential(config)`: key id from `BANIJ_CREDENTIAL_KEY_ID`, secret from `BANIJ_CREDENTIAL_SECRET`, `websiteKey = config.website.id` (local namespace only, never sent to the ERP). Add `assertInstallationEnv()` validating the three `BANIJ_*` formats. Remove the `_FILE` and `secretEnv` indirection | Unit: missing, malformed or valid env cases |
| 2.4 | `src/server/env.ts` | `erpBaseUrl`: single → `BANIJ_ERP_BASE_URL`, shared (dev only) → `ERP_BASE_URL`. `registryKey` and `rootDomain` documented as legacy shared-dev only (still read lazily, so single mode never requires them) | Single mode boots without `STOREFRONT_REGISTRY_KEY` / `STOREFRONT_ROOT_DOMAIN` |
| 2.5 | `src/server/tenant.ts` | Single branch calls `installationCredential(config)` | — |
| 2.6 | `src/server/urls.ts` | `publicOrigin` in single mode: the configured primary over https in production. For a configured **development** host it uses the request host with the dev scheme and port. Shared branch unchanged | Canonical, sitemap and robots URLs use the configured primary (checked in 4.x) |
| 2.7 | `.env.example` | Rewrite: section **Installation** (`BANIJ_ERP_BASE_URL`, `BANIJ_CREDENTIAL_KEY_ID`, `BANIJ_CREDENTIAL_SECRET`, `STOREFRONT_REDIS_URL`); section **Development only** (`STOREFRONT_PUBLIC_SCHEME`, `STOREFRONT_PUBLIC_PORT`, `STOREFRONT_INSECURE_COOKIES`); section **Legacy shared mode, development only — pending removal** (`STOREFRONT_MODE=shared`, `ERP_BASE_URL`, `STOREFRONT_REGISTRY_KEY`, `STOREFRONT_ROOT_DOMAIN`, `STOREFRONT_DEV_HOST_SUFFIX`, `STOREFRONT_PROVISIONING_*`) | No real values in the file |
| 2.8 | `dev/site-secret.mjs` → `dev/dev-env.mjs` | Writes the dev installation's `BANIJ_CREDENTIAL_KEY_ID` + `BANIJ_CREDENTIAL_SECRET` (from the **dev** registry, decrypted in-process, never printed) into a 0600 env file. Dev-only bridge; deleted with the registry | File mode 0600; stdout carries no secret |
| 2.9 | `.env.local` (dev) | Run 2.8 to add the `BANIJ_*` values and `BANIJ_ERP_BASE_URL=https://127.0.0.1:8443`; then **remove** `STOREFRONT_MODE=shared`, switching the :3000 dev server to single installation (controlled restart via `dev/restart-next.sh`) | `karimtraders.localhost:3000` serves as before |
| 2.10 | `dev/independent-builds.sh` | Site B config without `credential`/`erp`, `schemaVersion: 2`. Read A's key id from `.env.local`, not the config. Start both servers with `BANIJ_ERP_BASE_URL`, `BANIJ_CREDENTIAL_KEY_ID`, `BANIJ_CREDENTIAL_SECRET` env (secret read from the 0600 dev file into the child env only). Drop `STOREFRONT_MODE=single` (now default). Add assertion: neither build contains `wsk_` | 24 + 1 assertions green |
| 2.11 | `dev/single-site-e2e.sh` | Same env change; drop `STOREFRONT_MODE=single`, `STOREFRONT_ROOT_DOMAIN`, `BANIJ_CREDENTIAL_SECRET_FILE` | 2/2 green |
| 2.12 | `dev/bundle-scan.sh` | Also check actual `BANIJ_CREDENTIAL_SECRET` and `BANIJ_CREDENTIAL_KEY_ID` values from `.env.local`, and the `BANIJ_` name | CLEAN |
| 2.13 | `tests/unit/site-config.test.ts` | Update fixtures to v2. Add: `credential` / `erp` / `wsk_` refused; env assertion cases | green |

## Step 3 — Strict identity and host checks

The configured `website.id` is an **assertion only**. The ERP decides identity from the credential. Every row below answers **503 `identity_mismatch`** (except 3.4 and 3.5), logs a structured line without secrets, and never renders catalogue data.

| # | Check | Where | Behaviour |
|---|---|---|---|
| 3.1 | ERP `/site` → `data.id` == configured `website.id` | `tenant.ts` `resolveSingleSite` (exists; change result `not-found` → `unavailable` with reason `identity`) | 503 |
| 3.2 | Configured `domains.primary` ∈ ERP `{hosts.primary, hosts.subdomain, ...hosts.aliases}` | `tenant.ts` (**new**) | 503 |
| 3.3 | ERP refuses the stated primary (`403 host_mismatch`) or the credential (`401`) | `loadSite` (exists → `unavailable`) | 503. **Not cached** (change: currently cached 20 s as `suspended`; make `host_mismatch`/`401` uncached and reason `identity`) |
| 3.4 | Request `Host` ∈ configured primary / aliases / dev hosts (dev only) | `resolveSingleSite` (exists) | 404 |
| 3.5 | A configured alias that the ERP does not list | `resolveSingleSite` (**new**) | that alias → 404 (no redirect), warning logged; primary unaffected |
| 3.6 | Site cache cannot outlive a credential change | `loadSite` cache key → `bsf:t:{website}:site:{keyId}:{host}` (**change**) | After `.env` key change and restart, the first request re-reads `/site` with the new credential |
| 3.7 | Proxy page for reason `identity` | `src/proxy.ts` | Generic "temporarily unavailable" + `Retry-After: 300`, `noindex`; the reason is never shown to customers |
| 3.8 | Tests | `tests/integration/identity.test.ts` (**new**, runs against live dev ERP + Redis, **no orders**) | Cases: correct config → 200. 3.1: cached `/site` with another id → 503, body has no shop name. 3.2: cached `/site` whose hosts exclude the primary → 503. 3.3: wrong secret → 503, nothing cached. 3.3: config primary set to another website's real host (`rb35vhxhcf.feriwala.shop`) → ERP `host_mismatch` → 503. 3.4: undeclared host → 404. 3.5: unlisted alias → 404. 3.6: key-id change → fresh `/site` read |

Note on 3.1–3.3 versus the earlier `not-found`: a mismatch is an operator misconfiguration on the installation's **own** host. 503 + `Retry-After` keeps search engines from de-indexing the shop while an admin fixes `.env`, and still reveals nothing.

## Step 4 — Preserve and re-run the no-order regression

### Tests to preserve (must stay green; counts are current)

| Suite | File(s) | Count | Adaptation in Phase 1 |
|---|---|---|---|
| Security unit | `tests/unit/security.test.ts` | 30 | none |
| Site config unit | `tests/unit/site-config.test.ts` | 6 → ~14 | 1.6, 2.13 |
| Provisioning unit (legacy) | `tests/unit/provisioning.test.ts` | 12 | none; kept until approved cleanup. Set `STOREFRONT_MODE=shared` in its `beforeEach` (1.3 makes provisioning shared-only) |
| Cart isolation | `tests/integration/cart.test.ts` | 5 | none (mode-independent) |
| ERP contract | `tests/integration/erp.test.ts` | 4 | **adapt:** resolve the tenant through single installation (config + `BANIJ_*` env) instead of the registry. Host cases: `karimtraders.localhost` → ok; `rb35vhxhcf.localhost`, `karimtraders.evil.com`, `127.0.0.1` → not-found. **The order test places an ERP order; skip it unless `ALLOW_ERP_ORDERS=1` (A6 not approved)** |
| Unavailable states | `tests/integration/unavailable.test.ts` | 4 | **adapt:** cache key per 3.6; ERP-down via `BANIJ_ERP_BASE_URL` instead of `ERP_BASE_URL` |
| Identity checks | `tests/integration/identity.test.ts` | new, ~8 | step 3 |
| Two installations | `tests/integration/two-tenant.test.ts` | 6 (skipped) | keep skipped (A7). Rewrite as two installations is out of Phase 1 |
| Independent builds | `dev/independent-builds.sh` | 24 → 25 | 2.10 |
| Single-site checkout to quote | `dev/single-site-e2e.sh` → `tests/e2e/checkout.spec.ts` with `E2E_NO_ORDER=1` | 2 | 2.11 |
| Visual, themes, states, cookie | `tests/e2e/visual.spec.ts` | 14 (7 × 2 viewports) | none; now runs in single mode on :3000 |
| Catalogue E2E | `tests/e2e/checkout.spec.ts` "catalogue…" | 2 | none |
| Status sweep | `dev/status-codes.sh` | 22 | **adapt:** the two `registry.localhost` checks expect 404 (still true). Add: `/api/internal/registry` on the shop host → 404 in single mode |
| Build gates | `npx tsc --noEmit`, `npx eslint src site`, `npx next build`, `dev/bundle-scan.sh` | — | none |

### Run order (each step's gate)

```bash
npm run check                                   # tsc + eslint + unit
bash dev/integration.sh                         # cart, erp (order test skipped), unavailable, identity
bash dev/status-codes.sh                        # 22+ status checks, single mode on :3000
E2E_NO_ORDER=1 bash dev/e2e.sh                  # catalogue, cart, quote, themes, states, cookie — no ERP order
bash dev/independent-builds.sh                  # two generated installations, build + runtime isolation
bash dev/single-site-e2e.sh                     # generated installation, checkout to quote
npx next build && bash dev/bundle-scan.sh       # production build + client bundle
```

Before 4.x the `E2E_NO_ORDER` guard must also cover `tests/e2e/checkout.spec.ts` on the **mobile** project, which is already skipped for orders.

**Not re-runnable in Phase 1 (by approval status):** full COD placement and confirmation (A6), the two-installation order isolation (A7). The last verified placement remains order #7 (`ORD-261013-MVWB6MQ8`).

## Step 5 — Per-installation deployment configuration and documentation

| # | File | Content |
|---|---|---|
| 5.1 | `deploy/installation/Caddyfile` (**new**) | One site block for `{$SITE_PRIMARY_HOST}` → `reverse_proxy 127.0.0.1:3000` (Host passed through; `X-Forwarded-Proto https`). `{$SITE_ALIAS_HOSTS}` → `redir https://{$SITE_PRIMARY_HOST}{uri} 308`. Automatic TLS for exactly these names (no `on_demand`). Security headers; `/api/internal/*` → 404; health check `/api/health`. No ERP block, no provisioning listener |
| 5.2 | `deploy/installation/compose.yaml` (**new**, optional) | Services: `storefront` (image from `deploy/Dockerfile`, `env_file: .env`, read-only root FS, non-root), `redis` (`deploy/redis-storefront.conf`, private network, volume), `caddy` (5.1). No ERP services |
| 5.3 | `deploy/Dockerfile` | Unchanged build. Header comment: credentials only via runtime `.env`; the image contains `site/` (public config) and never `.env*` (already excluded in the build stage) |
| 5.4 | `deploy/redis-storefront.conf` | Unchanged; comment updated: one Redis (or one ACL user + key prefix) **per installation** |
| 5.5 | `deploy/Caddyfile` → `deploy/legacy-shared/Caddyfile` (move) | Marked legacy (D30, superseded); not used by installations; deleted in the approved cleanup |
| 5.6 | `docs/installation.md` (**new**) | Operator guide, in order:<br>1. Prerequisites (Node 24 or Docker, Redis, a domain).<br>2. ERP side: the website exists; its domain is registered and **verified and active** (TXT `_banij-verify`); Super Admin generates the website-scoped credential (minimum scopes; see the ER-11 note).<br>3. Fill `site/site.config.json` (id = the website's ERP public id, primary/aliases = the verified hosts, theme/locale/features).<br>4. Enter credentials **manually** into the server-side `.env` (`chmod 600`, never committed, never in the image).<br>5. Build and run (`npm ci && npm run build && npm start`, or compose).<br>6. DNS → server; Caddy obtains the certificate.<br>7. Verification checklist: `/api/health` 200; the shop host renders the website name; an undeclared host → 404; a deliberately wrong secret → 503 then restore; bundle scan clean.<br>8. Credential rotation: generate the new one in the ERP, edit `.env`, restart; the ERP's grace window covers in-flight requests.<br>9. Troubleshooting by symptom (503 `identity_mismatch`, 404 host, ERP `https_required`) |
| 5.7 | `README.md` | Lead with the single installation (link to `docs/installation.md`); move shared mode, registry, provisioning and the dev ERP shim to an appendix "Legacy shared mode — development only, pending removal" |
| 5.8 | `docs/provisioning-protocol.md`, `docs/master-template-plan.md`, `docs/launch-readiness.md` | Add a "Superseded by P3 (2026-10-13)" banner at the top; content unchanged |
| 5.9 | `package.json` scripts | Add `test:status` (`bash dev/status-codes.sh`), `test:builds` (`bash dev/independent-builds.sh`). Keep the `registry` script until cleanup, labelled legacy in the README |

**Production-readiness note, carried into `docs/installation.md`:** an installation is **not** production-ready until ER-11/SF-11 order authorization exists and its credential is issued **without unrestricted `orders:read`**. Phase 1 makes the installation model correct; it does not change that.

---

## Files touched in Phase 1 (summary)

- **Changed:**
  - `src/config/site-schema.ts`
  - `src/server/site-config.ts`, `src/server/env.ts`, `src/server/tenant.ts`, `src/server/urls.ts`, `src/server/provisioning.ts` (guard only)
  - `site/site.config.json`
  - `.env.example`
  - `tests/unit/site-config.test.ts`, `tests/unit/provisioning.test.ts` (mode in `beforeEach`)
  - `tests/integration/erp.test.ts`, `tests/integration/unavailable.test.ts`
  - `dev/independent-builds.sh`, `dev/single-site-e2e.sh`, `dev/bundle-scan.sh`, `dev/status-codes.sh`
  - `deploy/Dockerfile` (comment), `deploy/redis-storefront.conf` (comment)
  - `README.md`, `package.json`
  - three superseded-doc banners
- **New:**
  - `src/instrumentation.ts`
  - `tests/integration/identity.test.ts`
  - `dev/dev-env.mjs` (replaces `dev/site-secret.mjs`)
  - `deploy/installation/Caddyfile`, `deploy/installation/compose.yaml`
  - `docs/installation.md`
- **Moved:** `deploy/Caddyfile` → `deploy/legacy-shared/Caddyfile`.
- **Local, not in git:** `.env.local` (dev values, 0600).
- **Not touched:**
  - every catalogue, cart, checkout and order page and component;
  - `src/server/erp.ts`, `signing.ts`, `cart.ts`, `checkout.ts`, `catalog.ts`;
  - `site/theme.css`, `site/customizations.tsx`;
  - the ERP repository and ERP data.

**Estimate:**

| Step | Days |
|---|---|
| 1 | 0.25 |
| 2 | 0.75 |
| 3 | 0.5 |
| 4 | 0.25 |
| 5 | 0.5 |
| **Total** | **≈ 2.25 working days** |

**Risks:**

- Switching the :3000 dev server to single mode (2.9) changes how everyone's local dev resolves hosts. `STOREFRONT_MODE=shared` in `.env.local` restores it instantly.
- `instrumentation.ts` boot validation could block `next dev` on a misconfigured workstation; the error names the missing variable.
