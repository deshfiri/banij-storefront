# ERP specification — persistent, audited cash-on-delivery settings writer

**For:** the ERP session (repository `feriwala`). **Not implemented in the storefront.**

## Problem

`App\Domain\Website\CodTerms` reads two platform settings and one website-level override:

| Level | Where | Key |
|---|---|---|
| Website override | `websites.payment_config['cod']` (jsonb) | `enabled` (bool), `maximum_amount` (flat Taka decimal string) |
| Platform default | `settings` table | `orders.website_cod_enabled`, `orders.website_cod_maximum_amount` |

Nothing writes any of them. Neither settings row is defined, so `SettingsRepository::set()`
(`firstOrFail`) cannot be used yet. In the dev database COD currently answers "enabled, no limit"
**only because of a stale `feriwala:settings:v2` cache entry**. The real default is `false`. Any
cache flush silently turns COD off for every website.

## Decisions to confirm before building

1. **Who may set it.** Platform staff only. D30 §7 says owners may never reconcile COD and
   `order.*` stays platform-only; the `CodTerms` docblock says COD is switched on per shop by
   someone who knows that shop's couriers.
   - Suggested platform permission: `order.manage_settings`, already used by `OrderPolicy:163`.
   - Suggested website override permission: `website.edit` (`WebsitePolicy::administer`).
2. **Default after launch.** Off, until enabled deliberately for the platform or per website.

## A. Platform default — `SetCodTerms` (Action)

Path: `app/Domain/Order/Actions/SetCodTerms.php`. It follows `SetDeliveryChargeSettings` and
`ConfigureGateway`.

```php
public function handle(User $actor, bool $enabled, ?Money $maximum, ?string $reason = null): void
```

- **Validation** (throws `InvalidArgumentException`, which the controller maps to
  `ValidationException`):
  - `$maximum` is null (no limit) or greater than zero, and in `Currency::base()`.
  - `$reason` is required (10–500 characters) when **disabling**.
- **`define()` both rows idempotently, then `set()` them:**
  - `orders.website_cod_enabled`: group `orders`, `SettingType::Boolean`, default `false`, label
    "Cash on delivery for websites".
  - `orders.website_cod_maximum_amount`: group `orders`, `SettingType::Money`, default `null`,
    label "Cash on delivery limit per order".
- **Before/after:** read through `CodTerms`/`SettingsRepository`, with money as `->toDecimal()`.
  Never a float, never minor units.
- **Audit:** `RecordAuditLog` with action `order.cod_terms_updated`, `module: 'order'`,
  `isSensitive: true`, `before`/`after` as `{enabled, maximum}`, and `reason`.
- **Announce:** only when the effective answer changed, dispatch
  `AnnouncePaymentMethodsChanged::dispatch([Currency::base()->value])->afterCommit()`. It fans out
  `website.updated` to every served BDT website with an endpoint (one pending event per website).
  Changing nothing announces nothing.
- **Concurrency:** wrap it in `DB::transaction` and take an advisory lock
  (`pg_advisory_xact_lock(<constant>)`), so two admins cannot interleave define, set and audit.
  `SettingsRepository::set()` flushes the cache itself.

## B. Website override — `SetWebsiteCodTerms` (Action)

Path: `app/Domain/Website/Actions/SetWebsiteCodTerms.php`. It follows `ManageWebsiteDomainRouting`.

```php
public function handle(Website $website, User $actor, ?bool $enabled, ?Money $maximum, string $reason): Website
```

- `null` for a field means "inherit the platform default", which removes that key.
- `DB::transaction` + `Website::lockForUpdate()`. Refuse terminal websites (`WebsiteRefused::notEditable()`).
- Read, modify and write **only** `payment_config['cod']`, keeping every other `payment_config` key.
  Store `maximum_amount` as `$maximum->toDecimal()` (e.g. `"5000.00"`), in the website's currency.
- **Audit:** action `website.cod_terms_updated`, `auditableType: Website::class`, `accountId`,
  `module: 'website'`, `isSensitive: true`, `before`/`after` cod arrays, and `reason`.
- **Announce:** call `AnnounceWebsiteUpdated->handle($website)` only when the effective answer
  changed. It is safe inside the transaction (delivery is `afterCommit`).

## C. Screens and routes

- **Admin → Settings → Money: "Cash on delivery".**
  - A new item in `SettingsController` (money section) and a new `Admin\CodSettingsController`.
  - Inline validation, using `DecimalAmountRule` for the limit and `DecimalAmount::parseOrNull($v, Currency::base())`.
  - `abort_unless(... PermissionModule::Order, PermissionAction::ManageSettings)`, then an Inertia
    flash toast.
- **Admin → Websites → {website} → Checkout: "Cash on delivery for this website".**
  - Options: inherit / on / off, plus inherit or a specific limit, and a reason.
  - `Gate::authorize('administer', $website)`.
- Strings go in `lang/en` and `lang/bn`. Money is rendered with `MoneyAmount`.

## D. Fix carried with it

`CodTerms::maximumFor()` returns the platform `Money` (always base currency) as is. For a non-BDT
website, `greaterThan` would throw on currency mismatch. Until multi-currency COD is decided, either:

- compare only when currencies match, treating a mismatch as "COD unavailable", or
- refuse a website override in a non-base currency.

## E. Tests (Pest, `--group=website` / `orders`)

1. **Defaults:** COD is off on a fresh install with no rows. `GET /site` reports
   `cod.enabled=false`, and `POST /orders` with `cod` is refused with `payment_method_unavailable`.
2. **Platform writer:** enabled with limit `5000.00` → `/site` shows the limit and the quote's
   `cod.eligible` follows it. Exactly 5000.00 is allowed and 5000.01 is refused with
   `cod_limit_exceeded`.
3. **Survives a cache flush:** after `Cache::forget('feriwala:settings:v2')` the answer is unchanged.
4. **Audit:** one row per change, with before/after and reason. No row when nothing changed.
5. **Announce:** queued exactly once per affected website when the answer changes, and not at all
   when unchanged (`Queue::fake`, `Bus::assertDispatched`).
6. **Website override:**
   - Overrides the platform default in both directions, and inheriting removes the key.
   - Other `payment_config` keys are preserved.
   - Refused for closed websites.
   - Refused to a business-account identity, to the owner and to staff without the permission (403).
7. **Concurrency:** two simultaneous overrides of the same website serialise with no lost update
   (`lockForUpdate`).
8. **Money guard:** the limit is stored as a decimal string, and the repository guard test stays
   green.

## F. Rollout

1. Merge.
2. In each environment, run `SetCodTerms` once with the business's intended default. It defines the
   rows, so the answer no longer depends on the cache.
3. Set per-website overrides as needed.
4. Verify `GET /site` from the storefront. Within one webhook delivery cycle the storefront's
   `/site` cache (60 s) reflects it, even with no webhook endpoint.

**Database changes:** none. The `settings` rows are created by `define()`, and `payment_config` is
already jsonb.
