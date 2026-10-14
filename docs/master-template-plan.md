> **PARTLY SUPERSEDED BY P3 (2026-10-13).** §0 (dual-mode stance), §4 (credential delivery options)
> and §8 (approval statuses) are replaced by `docs/p3-alignment-plan.md` and
> `docs/phase-1-checklist.md`. Credentials are manual `.env` only; single installation is the default.

# Banij Master Storefront Template — preparation report and plan

**Date:** 2026-10-13 · **Status:** reversible preparation done and tested. The full generator is **not** built and waits for approval and the P3 Architecture Session's report. Nothing is committed, pushed or deployed. The ERP repository and ERP data were not touched.

## 0. Architecture conflict to resolve first

The new direction (every owner website has its own source, hosting and domain) **contradicts approved D30**:

- **§1:** "**One** Next.js codebase and **one** deployment serve every partner website".
- **§4:** shared Caddy with on-demand TLS.
- **§5:** shared caching and sessions.

"Storefront separation" is also an architecture-locked item. Until a superseding decision is recorded in `04-decisions.md`, this work keeps **both** models working:

- **`STOREFRONT_MODE=shared`** (the default) is the approved D30 deployment and the working MVP. It is unchanged.
- **`STOREFRONT_MODE=single`** is new. One deployment is one website, configured by its own `site/` folder.

Everything added is additive. Removing `site/`, `src/config/site-schema.ts`, `src/server/site-config.ts` and the `single` branch in `tenant.ts` restores the previous state exactly.

## 1. Existing MVP features — preserved, with evidence

| Feature | Evidence (this session) |
|---|---|
| Real ERP catalogue, product detail, availability | Shared mode: status sweep 22/22. Single-mode production build serves `/en` and product pages from the live dev ERP |
| Redis cart, checkout quote | Browser E2E up to the authoritative quote, passing in **shared** and **single** mode |
| COD order placement and confirmation | Unchanged code path. Last full placement and confirmation: order #7 `ORD-261013-MVWB6MQ8` (earlier this session). **Not re-run** in this phase because no new ERP data may be created without approval (§8 A6) |
| Bengali and English; Classic, Modern, Minimal | Unchanged. The single-mode site config can choose the preset, colours and locales; the ERP's branding stays the default |
| Security protections | Unit 48/48, including 6 new site-config tests. Bundle scan clean. Single mode answers only its own hosts, ignores dev hosts in production, and has no provisioning route |

## 2. Configuration extraction

### What was website-specific, and where it lives now

| Concern | Before (shared MVP) | Single-website template |
|---|---|---|
| Website identity | Registry entry, keyed by host | `site/site.config.json` → `website.id`, `website.slug` |
| Domain(s) | Registry hosts and ERP `/site` hosts | `domains.primary`, `aliases` (redirect to primary), `development` (refused in production) |
| ERP endpoint | `ERP_BASE_URL` env | `erp.baseUrl`, HTTPS enforced by the schema |
| Credential | Encrypted registry secret | **Reference only:** `credential.keyId` and `credential.secretEnv`. The secret comes from `<ENV>` or `<ENV>_FILE` at runtime. The schema refuses secret-looking values anywhere in the file |
| Theme and branding | ERP `/site` branding | ERP branding by default; `theme.preset` and `theme.colors` override presentation only |
| Locale | ERP `/site` locale | `locale.default` / `available`, limited to what the ERP offers |
| Feature flags | Hard-coded homepage sections | `features.*` (sections, `cashOnDelivery`). `onlinePayment` is locked to `false` by the schema |
| Deployment environment | `NODE_ENV` + dev env vars | `deployment.environment`. `production` refuses development hosts |
| Customization | None | `site/theme.css` (token overrides) and `site/customizations.tsx` (slots: `Hero`, `FooterNote`, `homeSections`) |

**Never browser-visible:** the config file is read only by server code (`src/server/site-config.ts` imports `server-only`). The credential secret is never in the config or the build, and the bundle scan checks the actual secret values.

**Rules stay with the ERP:** prices, stock, COD eligibility and limits, payment methods and order acceptance. A site config can *hide* COD (`cashOnDelivery: false`, enforced server-side too) but can never *grant* what the ERP refuses.

## 3. Master template structure

### Current layout (prepared, reversible)

```
site/                       ← WEBSITE-OWNED: the only folder an owner or generator edits
  site.config.json          identity, domains, ERP, credential reference, theme, locale, features, env
  theme.css                 design-token overrides
  customizations.tsx        component slots
src/
  config/site-schema.ts     TEMPLATE: config schema (pure; shared with the generator)
  server/                   TEMPLATE core: tenant resolution, cart, checkout, provisioning
    erp.ts, signing.ts      TEMPLATE: ERP API SDK + request signing   ← to become packages/erp-sdk
    site-config.ts          TEMPLATE: mode switch, config loader, runtime credential
  app/, components/, lib/   TEMPLATE: pages, theme presets (globals.css), i18n
deploy/                     TEMPLATE: Dockerfile, Caddyfile, Redis config
```

### Target layout (proposed; needs approval)

```
packages/
  erp-sdk/                  @banij/erp-sdk — signing, typed client, retries, idempotency, contract types
                            versioned independently; follows the frozen Storefront API v1
template/                   the storefront app (current src/), no website data
  .banij/manifest.json      ownership: every template-owned file with its hash and the template version
sites/<slug>/ (in each website's own repository after generation)
  site/                     website-owned layer (as today)
  .banij/lock.json          template version + manifest hashes this site was generated or upgraded from
tools/sitegen/              generator CLI: create · configure · verify · build · upgrade · diff
```

**The SDK rule.** Owner customizations live only in `site/`. Slots receive display data, never the ERP client or a credential. CI in every website repository fails the build if a template-owned file differs from its manifest hash. Owners therefore cannot, and need not, edit the SDK.

## 4. Proposed generator

### Workflow (each step idempotent, audited, resumable)

```
Admin creates website in Banij ERP            (exists: website, subdomain, package slot)
 → selects template version + theme preset    (ERP: stored on a storefront deployment record)
 → generator: create project                  (copy template@version, write site/ from ERP data, .banij/lock.json, new repo)
 → configure domain + hosting                 (subdomain DNS; custom domain TXT _banij-verify → Verify → Activate in ERP)
 → provision website-scoped credential        (ERP issues; secret goes ONLY to the site's hosting secret store,
                                               sealed per docs/provisioning-protocol.md — never to the repo or generator logs)
 → build + deploy                             (container from deploy/Dockerfile; secret mounted as BANIJ_CREDENTIAL_SECRET_FILE)
 → verify connection                          (sitegen verify: GET /api/health; via the site, ERP /site stating the primary host
                                               returns this website id; host_mismatch for any other host; bundle scan of the image)
 → live                                       (ERP record → live; webhook endpoint registered for the site's primary host)
```

### State and version tracking (ERP side, proposed)

Proposed table `website_storefront_deployments`:

- **Columns:** `website_id`, `template_version`, `config_hash`, `repository`, `commit`, `image_digest`, `status`, `verified_at`, `created_by`.
- **Status moves through `transitionTo()`:** `requested → project_created → configured → domain_pending → credentials_provisioned → built → deployed → verified → live`, plus `failed` and `rolled_back`.
- **Rows are append-only:** an upgrade is a new row, never an edit.

### Upgrades

`sitegen upgrade --to 0.3.0`:

1. Replaces template-owned files whose hash still matches the old manifest.
2. Stops with a report if any were modified locally.
3. Never touches `site/`.
4. Migrates `site.config.json` through `schemaVersion`.
5. Builds, then verifies, then deploys.
6. Rolls back to the previous image digest if verification fails.

### Credential handling for independent hosting

Two options. Pick one in the P3 decision:

- **(a) Secret store push (recommended).** The ERP/generator seals the secret to the site host's key and writes it into that host's secret store. Rotation means re-push plus restart, or file reload.
- **(b) Per-site provisioning endpoint.** Reuse the implemented channel in single mode, accepting only its own `website.id`. Rotation needs no restart, but every site exposes an internal endpoint.

## 5. Files

### Changed in this phase (all reversible)

| File | Change |
|---|---|
| `src/config/site-schema.ts` | **new**: site config schema, secret guard |
| `src/server/site-config.ts` | **new**: mode switch, config loader, runtime credential, feature flags |
| `site/site.config.json`, `site/theme.css`, `site/customizations.tsx` | **new**: website-owned layer (dev website) |
| `src/server/tenant.ts` | `single` branch: own hosts only, alias redirect, config overrides over `/site`. Shared path unchanged |
| `src/server/env.ts` | ERP base URL from site config in single mode |
| `src/app/[lang]/page.tsx` | Hero slot, section order, feature flags |
| `src/app/[lang]/layout.tsx` | `site/theme.css` after template CSS; FooterNote slot |
| `src/app/[lang]/checkout/page.tsx`, `src/server/checkout.ts` | COD feature flag, enforced in UI and server |
| `tsconfig.json`, `vitest.config.ts` | `@site/*` alias |
| `tests/unit/site-config.test.ts` | **new**, 6 tests |
| `tests/e2e/checkout.spec.ts` | `E2E_NO_ORDER` stops at the quote |
| `dev/independent-builds.sh`, `dev/single-site-e2e.sh`, `dev/site-secret.mjs`, `dev/free-port.sh` | **new**: generation, build and runtime isolation harness |

### To change for the full template (after approval)

- Move `src/server/{erp,signing}.ts` and `lib/types.ts` (contract types) into `packages/erp-sdk`. The template imports it; there is no behaviour change. Pull the `crypto.ts` parts that only the SDK needs.
- Add `.banij/manifest.json` and its CI check.
- Add the `tools/sitegen` CLI.
- Make the per-site Dockerfile and runtime secret-file handling the default; production health and verify endpoints.
- Decide shared mode's fate (keep for subdomain hosting, or retire): `registry.ts`, `provisioning.ts`, `proxy.ts` paths and `deploy/Caddyfile` on-demand TLS.
- Docs: owner customization guide (`site/` only), generator runbook.

## 6. Testing strategy

| Requirement | Test | Status |
|---|---|---|
| Two generated websites have separate configurations | `tests/unit/site-config.test.ts` (separate ids, keys, hosts; no shared objects); `independent-builds.sh` (each build contains only its own identity) | **Pass** |
| One website's credentials cannot access another website | `independent-builds.sh`: site B deployed with site A's real credential → ERP `host_mismatch` → 503, never A's data. Each site refuses the other's host. `erp.test.ts` (`host_mismatch`, wrong secret) | **Pass** |
| Independent builds work | `independent-builds.sh`: two projects generated from the template build separately; both production servers run | **Pass** |
| Customizations do not affect another website | Hero, footer and theme tokens present only in their own build; template `site/` hash unchanged by generation | **Pass** |
| Cart and order data isolated | Separate Redis database per site in the harness; `cart.test.ts` (tenant-keyed, forged cookie, concurrency); `two-tenant.test.ts` for orders | Carts **pass**. Cross-website orders written but **not run**: they need a second live website (A6/A7) |
| Existing COD checkout continues to work | E2E to the authoritative quote in shared **and** single mode | **Pass** to the quote. Placement awaits approval to create a dev order (A6) |

Run results in this phase:

| Check | Result |
|---|---|
| Unit | 48/48 |
| Independent build and runtime harness | 24/24 |
| Single-mode browser checkout to quote | 2/2 |
| Shared-mode browser checkout to quote | 2/2 |
| Status sweep | 22/22 |
| Typecheck, lint, production build, bundle scan | pass |

## 7. Dependencies on the ERP

1. **P3 decision record** superseding D30 §1, §4 and §5, plus the storefront separation lock. Required before irreversible work.
2. **Website hosts known to the ERP.** Independent domains must still be registered and **verified and active** website domains. The ERP checks `X-Feriwala-Storefront-Host`, payment `return_url` and the TLS ask against them.
3. **Credential delivery to independent hosting** (§4, option a or b). This extends `docs/provisioning-protocol.md`.
4. **Deployment record and orchestration:** the `website_storefront_deployments` table, a job driving the generator, and an admin UI with status and retry. It is append-only and audited.
5. **Webhook endpoint per site:** one per website already exists. Each site's own host becomes the endpoint.
6. **Still open from the launch-readiness report:**
   - P2 migrations (sorting and flash deals)
   - COD settings writer
   - ERP served via `php_fastcgi`
   - `webhooks` queue in the worker
   - webhook rotation signing

## 8. Estimate and approval requests

| Work | Owner | Estimate |
|---|---|---|
| Extract `@banij/erp-sdk` package (no behaviour change) | storefront | 1–1.5 days |
| Ownership manifest + CI check + `upgrade`/`diff` | storefront | 2–3 days |
| `sitegen` CLI: create, configure, build, verify | storefront | 2–3 days |
| Per-site deployment (image, secret file, health/verify, rollback) | storefront + ops | 2–3 days |
| ERP: deployment record, orchestration job, admin UI, credential delivery | ERP session | 4–6 days |
| Hosting automation (provider-specific: DNS, server/container, TLS) | ops | 2–5 days (depends on provider) |
| Two-website live isolation + COD placement regression | storefront | 0.5 day after approval |
| **Total** | | **≈ 14–24 working days**, parallelisable to ≈ 8–12 |

| # | Approval request |
|---|---|
| **A1** | P3 Architecture Session records the decision that supersedes D30 §1, §4, §5. Do we keep shared mode for subdomain-hosted sites, or retire it? |
| **A2** | Approve the target structure (§3): the `@banij/erp-sdk` package, the template ownership manifest, `site/` as the only owner-editable layer |
| **A3** | Choose credential delivery for independent hosting: (a) secret-store push (recommended) or (b) per-site provisioning endpoint |
| **A4** | Approve the ERP deployment record and state machine (§4) for the ERP session to build |
| **A5** | Approve implementing the full `sitegen` generator (create, configure, build, verify, upgrade) |
| **A6** | Allow one dev COD order (and confirmation) to re-run the full placement regression in single mode |
| **A7** | Create a second dev website with its own credential and products (launch-readiness A2) to run cross-website cart and order isolation live |
| **A8** | When to make a local commit of the storefront repository (no push) |
