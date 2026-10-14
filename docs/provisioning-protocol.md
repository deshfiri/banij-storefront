> **SUPERSEDED BY P3 (2026-10-13).** Automatic provisioning is out of scope: a Super Admin generates
> website-scoped credentials and an admin enters them by hand into each installation's server-side
> `.env` (see `docs/installation.md`). Do not hand this document to the ERP session. The code it
> describes is legacy shared-development only and is kept until the approved cleanup.

# ERP → Storefront credential provisioning — protocol v1

**Status:** storefront side implemented and tested (`src/app/api/internal/registry/route.ts`,
`src/server/provisioning.ts`). ERP side **not built**. This document is the specification for it.

Governing decision: D30 §2. Credentials are issued in the ERP and "delivered to the storefront's
server-side registry over an authenticated, encrypted channel, keyed by website". Adding a website
or rotating a secret updates the registry without a new deployment.

## 1. Shape

The ERP **pushes**. The storefront never pulls credentials and never reads a website, account or
credential id from a customer request.

```
ERP (queued job, after commit)  ──HTTPS──▶  Caddy internal listener  ──▶  Next.js
POST https://<provisioning host>/api/internal/registry                     /api/internal/registry
```

- **Provisioning host:** an internal name, e.g. `registry.storefront.internal`. It is configured as
  `STOREFRONT_PROVISIONING_HOST` and is never one of the websites' hosts. On any other host the path
  answers 404. On the provisioning host every other path answers 404.
- **Transport:** TLS, terminated by Caddy on a listener reachable only from the ERP's network. Use
  an IP allow-list, and mTLS if available. In production the route also requires
  `X-Forwarded-Proto: https` from Caddy.
- The endpoint is **off** (503 `provisioning_disabled`, or 404 via the proxy) unless all four
  settings are present. There is no partial or fallback mode.

## 2. Keys

| Held by | Name | What |
|---|---|---|
| Storefront secret store | `STOREFRONT_PROVISIONING_PRIVATE_KEY` | X25519 private key, PKCS#8 DER, base64 |
| ERP config (public) | storefront provisioning public key | the matching 32-byte X25519 public key, base64url |
| Both secret stores | `STOREFRONT_PROVISIONING_SECRET` | 32 random bytes, base64. HMAC key **as raw bytes** (decode first) |
| Both | `STOREFRONT_PROVISIONING_KEY_ID` | non-secret identifier, e.g. `sfp_…` |

`node scripts/provisioning-keys.mjs --file <env file> --host <provisioning host>` generates all four
into the storefront's env file. It prints only the key id and the public key. Copy the HMAC secret
to the ERP's secret store out of band.

## 3. Request

```
POST /api/internal/registry
Host: <provisioning host>
Content-Type: application/json
X-Banij-Provisioning-Key-Id: <key id>
X-Banij-Timestamp: <unix seconds>
X-Banij-Nonce: <uuid v4, fresh per request>
X-Banij-Signature: sha256=<hex HMAC-SHA256(secret_bytes, canonical)>
```

```
canonical = "POST" \n "/api/internal/registry" \n <timestamp> \n <nonce> \n <hex sha256(raw body)>
```

The storefront refuses with `401 unauthenticated` (same body for every reason) when:

- the key id is unknown,
- the timestamp is outside ±300 s,
- the nonce is not a UUID v4 or was **already used within 600 s**,
- the signature does not match (constant-time comparison).

### Body: upsert (issue, rotate, host change)

```json
{
  "op": "upsert",
  "website_id": "<website public_id ULID>",
  "revision": 42,
  "hosts": { "primary": "shop.example.com", "subdomain": "karim.feriwala.shop", "aliases": ["www.shop.example.com"] },
  "credential": {
    "key_id": "wsk_…",
    "sealed_secret": { "epk": "<b64url 32B>", "iv": "<b64url 12B>", "ct": "<b64url>", "tag": "<b64url 16B>" }
  }
}
```

- **`hosts`:** exactly what the ERP serves now. That is the subdomain, plus custom domains whose
  routing status is **active** on a website that is not closed (`ResolveWebsiteHost`).
- **`revision`:** strictly increasing per website. Use a monotonic counter column, or the
  microsecond timestamp of the change that caused the push.
  - A lower revision answers `200 {"status":"stale"}` and changes nothing.
  - An equal revision answers `200 {"status":"unchanged"}`.
  - **Every change must carry a new revision.**

### Body: remove (website closed, credential revoked with no replacement)

```json
{ "op": "remove", "website_id": "<ULID>", "revision": 43 }
```

The website's hosts stop resolving immediately. A tombstone keeps the revision so a late, older
upsert cannot resurrect the entry.

## 4. Sealing the secret

The plaintext is the credential secret exactly as issued: 64 lowercase hex characters.

```
binding  = website_id "|" key_id "|" revision                (ASCII)
(esk, epk) = fresh X25519 key pair per message
shared   = X25519(esk, storefront_public_key)
key      = HKDF-SHA256(ikm = shared, salt = epk || storefront_public_key,
                       info = "banij-storefront-provisioning-v1|" binding, length = 32)
iv       = 12 random bytes
ct, tag  = AES-256-GCM(key, iv, plaintext, aad = binding)
```

PHP equivalent (all built in):

```php
$kp   = sodium_crypto_box_keypair();
$esk  = sodium_crypto_box_secretkey($kp);
$epk  = sodium_crypto_box_publickey($kp);
$shared = sodium_crypto_scalarmult($esk, $storefrontPublicKey);       // 32 raw bytes
$binding = "{$websiteId}|{$keyId}|{$revision}";
$key  = hash_hkdf('sha256', $shared, 32, 'banij-storefront-provisioning-v1|'.$binding, $epk.$storefrontPublicKey);
$iv   = random_bytes(12);
$ct   = openssl_encrypt($secret, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, $binding, 16);
sodium_memzero($esk); sodium_memzero($shared); sodium_memzero($key);
```

Encode each part as unpadded base64url. The binding makes the ciphertext unusable for any other
website, key id or revision.

## 5. What the storefront does with it

1. Verifies the signature and claims the nonce.
2. Validates the body, takes a per-website lock and applies the revision rule.
3. Refuses `409 host_conflict` if a host is currently mapped to a different website. **Send the
   other website's upsert or remove first.**
4. Opens the secret. Failure is `422 unsealable_secret`.
5. Calls the ERP's `GET /site` with the new credential, stating the primary host. The credential
   must authenticate and return this `website_id`.
   - `website_unavailable` (suspended) is accepted, so the storefront can show its unavailable page.
   - Any other refusal is `422 credential_rejected`; ERP unreachable is `503`.
6. Re-encrypts the secret at rest (AES-256-GCM, storefront registry key, bound to the website) and
   atomically swaps the host map.
7. Writes a secret-free audit line, and bumps the website's cache version.

**Responses:** `200 applied|unchanged|stale`, `401`, `409 host_conflict|in_progress`,
`413`, `422 validation_failed|invalid_host|unsealable_secret|credential_rejected|credential_website_mismatch`,
`503 erp_unreachable|provisioning_disabled`. Retry `409 in_progress` and `503` with backoff; do
not retry other 4xx. An identical retry needs a **new nonce and signature**, but may reuse the body
and revision.

## 6. ERP implementation outline (for the ERP session)

1. **Config:** storefront provisioning URL, host, key id, HMAC secret (encrypted setting or env),
   storefront public key.
2. **`ProvisionStorefrontWebsite` job** (queue `webhooks` or a dedicated one, `afterCommit`). It
   builds the body from the website's current state, seals the **current** credential secret and
   POSTs.
   - The secret is decrypted only inside the job and wiped after sealing. It is never logged or
     put in the job payload: the job carries `website_id` only and reads the secret when it runs.
3. **Triggers,** each dispatching the job once with a new revision:
   - `ManageWebsiteCredentials::issue` and `::rotate`
   - `::revoke` (remove, or upsert with the remaining active credential)
   - `ManageWebsiteDomainRouting` activate, suspend and re-issue
   - website closed (remove)
   - website suspended or restored (upsert, so hosts stay mapped for the unavailable page)
4. **Revision:** add `websites.storefront_registry_revision BIGINT NOT NULL DEFAULT 0` and increment
   it under `lockForUpdate` in the triggering transaction. This is the only schema change.
5. **Audit:** `website.storefront_provisioned` with website, revision, key id prefix, host count
   and outcome. Never the secret or the ciphertext.
6. **Retries:** exponential backoff; dead-letter after N attempts with a staff-visible retry, like
   webhook deliveries.
7. **Rotation grace:** issue the new credential, push, and only then let the old one age out
   (`rotation_grace_minutes`). The storefront switches the moment the push is applied.

## 7. Operator break-glass

`scripts/registry.mjs put` still writes an entry directly, with the secret on stdin and encrypted at
rest. In production it refuses unless `--break-glass` is passed, and it emits an audit line. Use it
only to recover from a broken channel. The next ERP push supersedes it.

## 8. Verified (development, 2026-10-13)

`dev/provisioning-check.sh` ran against the dev server, with the reference sender standing in for
the ERP:

- An operator-provisioned entry moved onto the channel: `applied` at revision 10, with the
  credential checked live against the ERP.
- Same revision again → `unchanged`; older revision → `stale`.
- Byte-identical signed request replayed → `401`; wrong HMAC secret → `401`.
- Website 2's credential presented as website 1's → `422 credential_rejected` (ERP `host_mismatch`).
  The registry was untouched.
- The endpoint reached through a public shop host → `404`.
- 12 unit tests cover the seal binding, a tampered ciphertext, the wrong recipient, the key type,
  signature, timestamp and key id refusals, and the schema.
