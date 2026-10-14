# Private preview — Cloudflare Tunnel + Access (plan; nothing executed)

**Date:** 2026-10-13 · **Status:** read-only preflight done; every change below waits for explicit approval.

| | |
|---|---|
| **Target** | `https://karimtraders-preview.deshfiri.com` |
| **Gate** | Cloudflare Access, email one-time PIN |
| **Path** | Cloudflare edge → Tunnel → `127.0.0.1:3200` (separate production-mode storefront in WSL) → local dev ERP via `https://127.0.0.1:8443` |
| **Nature** | A **private visual preview, not a launch**. The ERP is never exposed |

---

## 1. Preflight findings (read-only)

| # | Check | Finding |
|---|---|---|
| A1 | WSL runtime | Ubuntu 26.04, WSL2 kernel 6.18, **systemd on** (PID 1). Node **24.21.0**, npm 11.19, Next **16.4.0**. Redis **8.0.5** responds |
| A1 | Local ERP | `https://127.0.0.1:8443/api/storefront/v1/health` → **200**, through the dev TLS shim (`php -S :8001` + TLS proxy :8443) |
| A1 | Shim lifetime | The shim processes are ad hoc (`nohup`), not services. **The dev TLS certificate expires 2026-11-12** |
| A1 | Build readiness | The template builds and passes the full no-order regression (13/13, Phase 1). Standalone output present |
| A2 | DNS zone | `deshfiri.com` is on **Cloudflare** (NS `ara.ns.cloudflare.com`, `ridge.ns.cloudflare.com`), proxied. `karimtraders-preview.deshfiri.com` has **no record** (no conflict). `_banij-verify.karimtraders-preview…` has no TXT |
| A3 | Cloudflare auth | **None on this machine:** no `cloudflared`, no `~/.cloudflared`, no `CF_*`/tunnel env vars, no API token. Account access, the Zero Trust team name and the One-time PIN login method **cannot be verified from here**; they must come from you |
| A5 | Access before routing | Possible, and planned two ways. (1) The Access application is created for the hostname **before** any DNS record or tunnel route exists, so the edge enforces it from the first request. (2) `cloudflared` validates the Access JWT at the origin (`originRequest.access.required: true` + team name + application AUD), so even a misconfigured edge policy cannot reach the storefront |
| A6 | ERP domain model | A custom domain can be added to website 2 **without changing `websites.domain`** (`registerDomain(..., makePrimary: false)`). The subdomain `karimtraders.feriwala.shop` stays served. **Side effect:** `/site` primary = `websites.domain` if active, else the first active custom domain. Website 2's `domain` is `karimtraders.example` (unverified), so once the preview domain is **active**, the ERP reports `hosts.primary = karimtraders-preview.deshfiri.com`, `subdomain = karimtraders.feriwala.shop`. The dev installation on :3000 keeps working: its identity check accepts the subdomain. Domain uniqueness is enforced by partial unique indexes, and the preview name is unused |
| A6 | Domain-registration semantics | The only creation path is `ProvisionWebsiteService::registerDomain`, which records a **registration**: status `active`, fee, `expires_at = now + termMonths`, renewal-reminder tracking. Use `fee = 0.00`, a short term (3 months) and registrar "Cloudflare (preview)". Reminders may log (dev mail and SMS drivers are `log`) |
| A6 | Activation requirements | Token issued → TXT `_banij-verify.karimtraders-preview.deshfiri.com` = token (real DNS lookup from WSL) → **Check** → **Activate**, which needs a verified domain, a running registration and a website that is not closed. Activation announces `website.updated`; website 2 has **no webhook endpoint**, so nothing is sent |
| A7 | New credential | `ManageWebsiteCredentials::issue()` **only inserts** a new credential and an audit row; existing credential #1 is untouched. **Pass `[catalog:read]` explicitly**: an empty scope list falls back to `catalog:read` + `inventory:read` |
| A7 | Current credential | #1 (`catalog:read`, `orders:write`, `orders:read`) — **not used for the preview** (unrestricted `orders:read`) |
| A8 | Conflicts | Port **3200 free**. No `~/preview`, no `~/.cloudflared`, no `cloudflared` process. Redis **db 11 empty** (dbs 1–3 belong to the ERP; db 8 to the dev storefront and legacy registry) |
| — | Caddy, Docker | Still not installed. **Not needed for this route**: Cloudflare terminates TLS. `deploy/installation/*` remains unvalidated for VPS installations |

## 2. Exact safe setup sequence

Each **[APPROVAL]** step needs your explicit go. Nothing becomes reachable before step 9, and step 9 is reachable only through Access.

| Step | Where | Action | Reversible by |
|---|---|---|---|
| 1 | storefront (local) | Implement `STOREFRONT_PREVIEW` (§5) + tests; full no-order regression | git working tree (uncommitted) |
| 2 | WSL (local) | Create `~/preview/banij-storefront` (release dirs + `current` symlink), copy the template **without** `.env*`/`dev/tls`/`.next`, preview `site.config.json`, build | delete the dir |
| 3 | **[APPROVAL] ERP dev data** | Issue the preview credential `catalog:read` only (§4.1). The secret goes straight into the preview `.env` (0600), never printed | `revoke()` |
| 4 | **[APPROVAL] ERP dev data** | `registerDomain(makePrimary: false, fee 0, 3 months)` → `issueVerification` (§4.2) | `suspend()` / registration lapses |
| 5 | **[APPROVAL] Cloudflare DNS** | Add TXT `_banij-verify.karimtraders-preview` = token (DNS only, not proxied) | delete the record |
| 6 | **[APPROVAL] ERP dev data** | `verify()` → `activate()` the preview domain | `suspend()` |
| 7 | WSL (local) | Start the preview on `127.0.0.1:3200` (systemd unit); verify locally with `Host: karimtraders-preview.deshfiri.com` (§6 local checks) | stop the unit |
| 8 | **[APPROVAL] Cloudflare Zero Trust** | Enable One-time PIN login. Create a **self-hosted Access application** for `karimtraders-preview.deshfiri.com` (whole host, session 24 h). Policy **Allow** — Include: Emails = your approved list. No other policies; Access denies everyone not matched. Record the application **AUD tag** and team name | delete the application |
| 9 | **[APPROVAL] install + tunnel** | Install `cloudflared` (user-level binary). `cloudflared tunnel login` (browser; the zone certificate is written 0600 under the preview config dir). `cloudflared tunnel create banij-preview-karimtraders` (credentials JSON 0600). Write `config.yml` (§3.2). `cloudflared tunnel route dns banij-preview-karimtraders karimtraders-preview.deshfiri.com`, which creates the proxied CNAME **after** Access exists. Run as a systemd unit | `tunnel route` delete / `tunnel delete` / remove the CNAME |
| 10 | verify | §6 full checklist from a browser and from an unauthenticated client | — |

## 3. Cloudflare design

### 3.1 Access (dashboard actions)

1. **Zero Trust → Settings → Authentication → Login methods:** add **One-time PIN**.
2. **Zero Trust → Access → Applications → Add → Self-hosted:**
   - **Name:** "Banij preview — Karim Traders"
   - **Domain:** `karimtraders-preview.deshfiri.com`, path empty (covers the whole host, including `/api/*`)
   - **Session duration:** 24 h
   - **Identity providers:** One-time PIN only; Instant Auth on
3. **Policy:** "Approved reviewers", action **Allow**, Include → **Emails** → your addresses. Add no "Everyone" or "Bypass" rule.
4. **Additional settings:** CORS off. Cookie settings: HttpOnly on, Same-Site Lax, Binding Cookie on.
5. Copy the **Application Audience (AUD) Tag** for §3.2.
6. **Before step 9, verify:** the Access application shows the hostname and the policy. With no DNS record yet, the hostname does not resolve, so nothing is exposed.

### 3.2 Tunnel (locally managed, origin-side Access enforcement)

All files live in `~/.config/banij-preview/cloudflared/` (dir 0700, files 0600). Never in git, docs or logs.

```yaml
# config.yml — no secrets inside; credentials-file holds the tunnel secret (0600)
tunnel: <TUNNEL_UUID>
credentials-file: /home/<operator>/.config/banij-preview/cloudflared/<TUNNEL_UUID>.json
no-autoupdate: true
loglevel: info            # never debug: no request headers in logs
ingress:
  - hostname: karimtraders-preview.deshfiri.com
    service: http://127.0.0.1:3200
    originRequest:
      httpHostHeader: karimtraders-preview.deshfiri.com
      access:
        required: true                 # cloudflared rejects any request without a valid Access JWT
        teamName: <ZERO_TRUST_TEAM>
        audTag: [<ACCESS_APPLICATION_AUD>]
  - service: http_status:404           # everything else, including other hostnames, 404
```

- **Locally managed, not token-based:** no tunnel token in a systemd unit or process arguments. The run credential is a 0600 file.
- **Zone certificate:** `cert.pem` from `tunnel login` is needed only to create, route or delete tunnels. It is moved **out** of the run path after step 9, to 0600 in an offline location of your choice (or deleted and re-obtained for changes).
- **No quick tunnels:** `trycloudflare` is never used. The only ingress hostname is the preview host. **The ERP (:8001/:8443) is not in the ingress** and is unreachable from the tunnel.

### 3.3 Services (WSL systemd, user-level)

| Unit | Description |
|---|---|
| `banij-preview-storefront.service` | `node .next/standalone/server.js`, `WorkingDirectory=~/preview/banij-storefront/current`, `EnvironmentFile=~/preview/banij-storefront/shared/.env` (0600), `HOSTNAME=127.0.0.1 PORT=3200 NODE_ENV=production`, `NODE_EXTRA_CA_CERTS=<dev ERP shim cert>`, `Restart=on-failure` |
| `banij-preview-tunnel.service` | `cloudflared --config ~/.config/banij-preview/cloudflared/config.yml tunnel run`, `After=` the storefront |

Both are user units (`systemctl --user`), with lingering enabled so they run without a login session. **Dependency:** the dev ERP shim (:8001/:8443) and the ERP itself are today ad hoc processes. The preview is down whenever they, WSL or the PC are down. Optional: user units for the shim too (they change nothing in the ERP repo). Regenerate the shim certificate before **2026-11-12**.

## 4. ERP coordination (dev database only — exact requests)

### 4.1 Preview credential

```php
// actor: platform staff user 2; website 2 = Karim Traders Shop (01M4MHJ7BA282X3QXV1Q256ZMP)
$issued = app(ManageWebsiteCredentials::class)->issue(
    Website::find(2), User::find(2),
    'Private preview — karimtraders-preview.deshfiri.com',
    [CredentialScope::CatalogRead],          // explicit; NOT empty (empty → defaults)
);
// key_id + secret written straight to ~/preview/banij-storefront/shared/.env (0600) as
// BANIJ_CREDENTIAL_KEY_ID / BANIJ_CREDENTIAL_SECRET — never printed, never in a file elsewhere.
```

- Credential #1 is not touched.
- **Expected effects:** 1 `website_credentials` row and 1 audit row.
- **Rollback:** `revoke($credential, $actor, 'preview ended')`.

### 4.2 Preview domain

```php
$domain = app(ProvisionWebsiteService::class)->registerDomain(
    Website::find(2), User::find(2), 'karimtraders-preview.deshfiri.com',
    termMonths: 3, registrar: 'Cloudflare (preview, deshfiri.com)', fee: Money::zero(), makePrimary: false,
);
app(ManageWebsiteDomainRouting::class)->issueVerification($domain, User::find(2)); // token → TXT record (step 5)
// after the TXT is live:
app(ManageWebsiteDomainRouting::class)->verify($domain, User::find(2));
app(ManageWebsiteDomainRouting::class)->activate($domain, User::find(2));
```

- **Effects:**
  - 1 `website_domains` row.
  - routing `unverified → verified → active`.
  - audit rows.
  - `/site.hosts.primary` for website 2 becomes the preview host while it is active (§1 A6).
  - `websites.domain` is unchanged.
  - No orders, reservations, payments, charges or ledger entries.
  - No webhook sent (no endpoint).
- **Rollback:** `suspend($domain, $actor, 'preview ended')`, which returns `/site.hosts.primary` to the subdomain. The registration lapses after 3 months. No deletes.

## 5. Local-only preview preparation (storefront code, step 1)

| # | Change | Where |
|---|---|---|
| 5.1 | `STOREFRONT_PREVIEW=true` flag (server-side env), refused unless `deployment.environment` is `staging` | `src/server/site-config.ts`, boot check in `src/instrumentation.ts` |
| 5.2 | **ERP SDK allow-list in preview** (the single choke point): only `GET /site`, `/products*`, `/categories*`, `/delivery/areas`; `POST /checkout/quote` only if `STOREFRONT_PREVIEW_QUOTE=true` (off by default; needs `orders:write`). Everything else throws `PreviewRefused` before any network call: `POST /orders`, every `/orders/*` read or mutation, confirmation, code resend, cancellation, payment-session, returns | `src/server/erp.ts` |
| 5.3 | Server actions refuse in preview: place order, COD confirm, resend, quote (unless enabled) → `{ kind: "refused", code: "preview" }`. Add-to-cart and cart edits stay on (Redis only) | `src/app/actions.ts` |
| 5.4 | Checkout page in preview: cart summary + notice "Ordering is disabled in this preview" (en/bn), no Place-order button. `/orders/[id]` → 404 | `src/app/[lang]/checkout/page.tsx`, `src/app/[lang]/orders/[id]/page.tsx`, `src/lib/i18n.ts` |
| 5.5 | Banner on every page: "PREVIEW — UNDER DEVELOPMENT · ordering disabled" (en/bn), `role="status"`, high contrast, not dismissible | `src/app/[lang]/layout.tsx` |
| 5.6 | No indexing: `X-Robots-Tag: noindex, nofollow, noarchive` on every response; `robots.txt` → `Disallow: /`; `sitemap.xml` empty; `<meta name="robots" content="noindex">` | `src/proxy.ts`, `src/app/robots.ts`, `src/app/sitemap.ts`, layout metadata |
| 5.7 | Internal routes: `/api/internal/*` already 404 in single mode (tested); `/api/health` stays (behind Access) | — |
| 5.8 | Tests: unit (SDK allow-list refuses every mutating path without a network call; actions refused) + E2E against the preview build (banner both locales, no Place-order, order URLs 404, cart works, robots and headers). Plus the full no-order regression | `tests/unit/preview.test.ts`, `tests/e2e/preview.spec.ts` |
| 5.9 | Deploy script: build a new release dir from the dev repo (tar, excluding `.env*`, `dev/tls`, `.git`, `test-results`), run unit tests and a bundle scan on it, atomically switch `current`, restart the unit, health-check, roll back automatically on failure. The dev repo and :3000 are never touched | `dev/preview-deploy.sh` |
| 5.10 | Preview installation files | see below |

**Preview installation files (5.10):**

- `~/preview/banij-storefront/shared/site.config.json`:
  - `website.id = 01M4MHJ7BA282X3QXV1Q256ZMP`
  - `domains.primary = karimtraders-preview.deshfiri.com`
  - `aliases = []`, `development = []`
  - `deployment.environment = "staging"`
- `~/preview/banij-storefront/shared/.env` (0600):
  - `BANIJ_ERP_BASE_URL=https://127.0.0.1:8443`
  - the preview `BANIJ_CREDENTIAL_KEY_ID` / `BANIJ_CREDENTIAL_SECRET`
  - `STOREFRONT_REDIS_URL=redis://127.0.0.1:6379/11`
  - `STOREFRONT_PREVIEW=true`
  - `STOREFRONT_PREVIEW_QUOTE=false`

## 6. Final security verification checklist (run after steps 7 and 10)

**Before the tunnel exists (local, step 7):**

- [ ] `ss -ltn`: the preview listens on **127.0.0.1:3200 only**; nothing on 0.0.0.0.
- [ ] `Host: karimtraders-preview.deshfiri.com` → 200, banner present (en and bn). Any other Host → 404. `/api/internal/registry` → 404.
- [ ] Every mutating path refused **without an ERP request**: the place-order and confirm actions return `preview`; ERP `api_logs` show no `POST /orders`; ERP order count still **7**, reservations **6**.
- [ ] `/en/orders/<any>` → 404; checkout shows no Place-order button.
- [ ] `robots.txt` = `Disallow: /`; `X-Robots-Tag` on every response; sitemap empty.
- [ ] Bundle scan of the preview build clean, including the preview credential's actual values; the `.env` is 0600 and outside any git tree.
- [ ] `identity` checks pass for the preview host. A wrong secret gives 503 with no secret in the logs.
- [ ] The dev server on :3000 is unchanged (status sweep 22/22 still green).

**After the tunnel (step 10):**

- [ ] From a non-authenticated client (`curl -sI https://karimtraders-preview.deshfiri.com/en`): **302 to `<team>.cloudflareaccess.com`**, never 200. The same for `/api/health`, `/robots.txt`, `/_next/static/...` and an unknown path.
- [ ] A request carrying a forged or expired `Cf-Access-Jwt-Assertion` straight to the tunnel hostname is rejected by `cloudflared` (origin enforcement).
- [ ] An unapproved email cannot obtain a PIN session; approved emails can, and see the banner.
- [ ] DNS: exactly one proxied CNAME for the preview host to `<uuid>.cfargotunnel.com`. The TXT is DNS-only. No record points at a home IP.
- [ ] The ERP is unreachable via the tunnel. `cloudflared` ingress lists only the preview host + `http_status:404`.
- [ ] No tunnel credential, cert or token in git (`git status`, `git ls-files`), docs, shell history, process arguments (`ps -ef | grep cloudflared` shows only `--config`), or logs.
- [ ] The preview credential has exactly `catalog:read`; credential #1 is unchanged.
- [ ] Rollback rehearsed: stop the tunnel unit → hostname 530/1033 behind Access. Revoke and suspend commands prepared.
