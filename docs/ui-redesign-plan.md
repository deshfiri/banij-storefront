# Storefront UI redesign — plan (awaiting approval; nothing implemented)

**Date:** 2026-10-13

**Scope:** visual and UX redesign of the Banij master storefront (Karim Traders as the sample site). The logic behind each surface stays as it is: catalogue, cart, quote, COD, preview mode, identity checks and the independent-installation architecture.

**Reference:** <https://jmorbit.com/>, a DFCommerce-style shop. It was inspected on 2026-10-13 in headless Chromium at 1440×900 and 390×844: home, a category page and a product page, with full-page screenshots plus computed fonts and colours. **Only layout and interaction patterns are borrowed.** No logo, brand colour, copy, icons, images or code are reused.

---

## 1. What was inspected

### 1.1 Reference site (observed, not assumed)

| Area | Observed pattern |
|---|---|
| Header (desktop) | Row 1: logo left; a wide search field ("Search products, brands, categories…") with a solid search button; square icon buttons for cart and account. Row 2: category tabs ("All" + categories) with an underline on the active tab |
| Header (mobile) | Logo + cart + account; full-width search on its own row; category tabs scroll horizontally |
| Hero | One wide, rounded banner image (configurable artwork) |
| Home sections | "Shop by Category" (rounded square tiles with a tinted background, image and label); "Trending Now" product rail with "See All ›"; a 4-card trust strip (delivery, cash on delivery, returns, authenticity) |
| Section headings | Bold heading with a short coloured accent bar on the left |
| Product card | White card with a 1px border and rounded corners; square image area; name; rating pill; bold price; a round **+** quick-add button bottom-right |
| Product page | Breadcrumb. Left: a gallery card with dots and a next arrow. Right: an info card with category eyebrow, title, rating, share button, large price, a "taxes included" note, a −/1/+ quantity stepper, **Add to Cart** (outline) + **Buy Now** (solid), a 2×2 trust grid, SKU and category chips. Description/Reviews tabs below |
| Product page (mobile) | **Sticky bottom bar** with price, cart icon button and Buy Now |
| Category page | Breadcrumb; heading with "CATEGORY" eyebrow and product count; grid |
| Footer | Brand + tagline + social icons; link columns (Shop / Support / Company / App); payment-method strip. On mobile the columns become **accordions** |
| Typography and colour | Poppins + a Bangla webfont; slate-900 text, gray-500 secondary, gray-50/100 surfaces, one green brand colour, white cards with light borders |

### 1.2 Current storefront: limitations

| # | Limitation | Evidence |
|---|---|---|
| L1 | **No product images.** Cards and the product page show a big initial letter | All 5 dev products have **0** `product_media` rows (§6) |
| L2 | Plain header: text-only cart and language links, no icons, no account placeholder, no category bar | Screenshots |
| L3 | **No category navigation.** The ERP `/categories` returns *website* categories, and website 2 has none (`website_categories` = 0) | Layout renders the nav only when that list is non-empty |
| L4 | Hero is a generic gradient with the shop name. The ERP branding is empty (`logo`, `banner`, `tagline` all null) | Dev DB |
| L5 | Home shows only "New arrivals". Flash deals, Best sellers and Featured fail (**ERP 500** on sorted and flash listings until the P2 migrations run) | Browser console: 3 `home section failed` errors (the dev "3 Issues" badge) |
| L6 | **Mobile layout overflows:** the header row (name + Shop + বাংলা + Cart) is wider than 390 px, so the page lays out at 430 px. The existing visual test missed it because it compared against the already-widened viewport | Mobile probe: layout width 430 vs device 390 |
| L7 | Product page: no gallery, a plain number input instead of a stepper, no Buy-now, no sticky mobile CTA, no trust info, no related products | Screenshot |
| L8 | Catalogue filters are a static sidebar form, with no mobile filter/sort drawer and no active-filter chips | Code |
| L9 | Thin footer: name + contact only, no link structure | Screenshot |
| L10 | Images use plain `<img>` with `images.unoptimized`: no responsive sizes or lazy-loading strategy, and no fallback design | `next.config.ts`, components |

---

## 2. Visual design system (evolves the existing token architecture; does not replace it)

Every colour still comes from the tokens in `src/app/globals.css`. The three presets (**classic / modern / minimal**) stay. `site/theme.css` and `site.config.json` → `theme.colors` keep overriding them, and **brand colours keep coming from the ERP's branding first**. No colour from the reference is used.

| Token group | Proposal |
|---|---|
| Type | **Latin:** Inter (self-hosted via `next/font`; neutral, excellent numerals). **Bangla:** Noto Sans Bengali (already shipped). One stack, so mixed EN/BN text aligns. Scale: 12 / 13 / 14 / 16 / 18 / 20 / 24 / 30 / 36 px; weights 400 / 500 / 600 / 700; prices use `tabular-nums` |
| Colour roles | `--brand` (accent), `--brand-2` (primary action/ink), `--bg`, `--surface`, `--surface-2` (tinted tiles), `--text`, `--muted`, `--line`, `--success`, `--warning`, `--danger`, plus new `--sale` (sale badge) and `--focus`. Preset values are retuned for contrast (WCAG AA for text on surfaces and buttons) |
| Radius | `--radius-card` 16 / 12 / 4 px (modern / classic / minimal); `--radius-ctl` 12 / 10 / 4 |
| Elevation | `--shadow-card` (subtle; zero in minimal), `--shadow-pop` (menus, drawers, sticky bar) |
| Spacing and layout | 4 px grid. Container max 1280 px; gutters 16 (mobile) / 24 (tablet) / 32 (desktop). Product grid 2 / 3 / 4 / 5 columns at 0 / 640 / 1024 / 1280 px |
| Motion | 150–200 ms ease-out on hover and press; image zoom ≤ 1.04; all motion off under `prefers-reduced-motion` |
| Focus and accessibility | Visible 2 px focus ring (`--focus`). 44 px minimum touch targets. Labels on every icon button. Status never shown by colour alone (text + dot) |
| Icons | A small **inline-SVG icon set** in `src/components/icons.tsx` (search, cart, user, menu, close, chevron, plus, minus, truck, cash, shield, return, share, star-free). **No new dependency** |

**Component primitives** (new, in `src/components/ui/`): `Button` (primary / secondary-outline / ghost / icon, with loading state), `IconButton`, `Badge`, `SectionHeader` (accent bar + "See all"), `QuantityStepper`, `Drawer` (mobile menu, filters), `Tabs`, `Breadcrumbs`, `Skeleton` variants (card, rail, PDP, cart line), `EmptyState`, `PriceTag`. `PriceTag` renders the ERP's `formatted` strings only and never computes.

---

## 3. Page-by-page layout

### 3.1 Global header

```
Desktop (≥1024)
┌───────────────────────────────────────────────────────────────────────────────┐
│ [Logo/Name]  [ Search products…                                  ][🔍]  [বাংলা] [👤] [🛒 2] │
├───────────────────────────────────────────────────────────────────────────────┤
│  All   Men's Clothing   Women's Clothing   Grocery   …   (scrolls if long)    │
└───────────────────────────────────────────────────────────────────────────────┘

Mobile (<640)
┌───────────────────────────────┐
│ [☰] [Logo/Name]      [🛒 2]    │
│ [ Search products…      ][🔍] │
│ All · Men's · Women's · Groc… │  ← horizontal scroll chips
└───────────────────────────────┘
☰ opens a drawer: categories, language, contact, (account later)
```

- Logo from ERP `branding.logo_url`; otherwise the shop name as a wordmark.
- **Account (👤):** customer accounts are P5 and not built. The icon appears only when `features.accounts` is on (new flag, **off** by default), so there's no dead link.
- Cart badge counts are server-rendered, as today.
- Sticky header that compacts on scroll on desktop. The mobile header must fit 390 px with no overflow (L6).

### 3.2 Homepage

```
[ Hero carousel: slide(s) from ERP banner + site content ]   (16:6 desktop, 4:3 mobile, rounded)
▌Shop by Category                                   See all ›
[tile][tile][tile][tile][tile][tile]   (mobile: 3 per row / horizontal scroll)
▌Flash deals  ⏱ ends in 05:12:44                     See all ›   (only when the ERP returns items)
[card][card][card][card][card]   (mobile: horizontal snap rail)
▌Best sellers                                        See all ›
▌New arrivals                                        See all ›   (fallback rail — never empty)
▌Featured                                            See all ›
[ Trust strip: up to 4 configured cards ]
[ Footer ]
```

- **Hero is configurable** and never invented:
  1. The ERP banner (`branding.banner_url`) plus tagline is slide 1 when present.
  2. Optional extra slides come from a new public file **`site/content.json`** (per installation: image path or URL, alt, headline, subline, CTA label and link).
  3. With neither, a clean text hero on brand tokens (shop name + tagline + Shop now). This is today's behaviour, restyled.
- **Category tiles:** the image comes from the ERP category image once the API exposes it (§6, E3); until then, a tinted tile with a neutral category icon. No stock photos.
- **Product rails:** each section shows only when the ERP returns products. Its failure stays silent for customers and logged for operators (L5). The flash-deal countdown uses the ERP's `promotion.ends_at`.
- **Trust strip:** text comes from `site/content.json`, and only claims the business confirms. Nothing defaults to "free delivery" or "authentic", because the ERP charges a flat delivery fee. A COD card appears automatically only when `/site` reports COD enabled.

### 3.3 Product card

```
┌──────────────────────────┐
│ [SALE] [FLASH]           │  ← badges from ERP fields only
│                          │
│      product image       │  1:1 frame, object-contain on --surface-2, lazy, responsive sizes
│                          │  hover: 2nd image (if ERP has one) or zoom 1.03
├──────────────────────────┤
│ Brand (if any)           │  12px muted
│ Product name, max two    │  14–15px, 2-line clamp
│ lines…                   │
│ ৳1,450.00  ̶৳̶1̶,̶8̶0̶0̶      [+] │  price = ERP formatted; strike = compare_at_price; [+] quick add
│ ● In stock / Only 3 left │
└──────────────────────────┘
```

- **Quick add (+):** single-variant products add via the existing server action. Multi-variant products open the product page with the option picker focused. In preview mode, adding to the cart is allowed; checkout is not.
- **Out of stock:** the image is dimmed, the badge says "Out of stock" and the + is disabled.
- **No ratings and no "% off".** Reviews aren't built, and the storefront never computes money, so a discount percentage only appears if the ERP sends one.
- **Missing image:** a neutral "image not available" placeholder (icon + text, localized). Never another product's image and never a generated picture.
- A matching skeleton shimmer.

### 3.4 Catalogue and category pages

- **Breadcrumb**, plus a page header with an eyebrow ("Category"), the title and the active search term.
- **Toolbar:** sort dropdown; on mobile, **Filter** and **Sort** buttons open a bottom-sheet drawer; active filter chips with ✕ and "Clear all".
- **Filters:** price range, brand (with counts from the ERP facets), in stock, flash deals, and attributes (sizes, colours) from the facets. Each still works as a plain GET form (no-JS safe).
- **Grid** as in §2. **"Load more"** uses the ERP cursor; prev/next stays for no-JS.
- **States:** empty (with a clear-filters action), error, and an unavailable-sort message (L5).
- **Category source (L3):** the category bar and pages use the website categories when they exist. Otherwise they use the catalogue categories present on listed products (each product's `categories[0]`), until the ERP offers a category facet (§6, E4). The category route accepts either.

### 3.5 Product details page

```
Desktop
Home › Men's Clothing › Cotton Panjabi
┌──────────────────────────────┐  ┌──────────────────────────────────────┐
│                              │  │ MEN'S CLOTHING · Brand            [⤴] │
│        main image 1:1        │  │ Cotton Panjabi – Off-white  (h1)      │
│  (zoom on hover, swipe on    │  │ [SALE · ends 2d 4h]                   │
│   mobile, ‹ › arrows)        │  │ ৳1,450.00   ̶৳̶1̶,̶8̶0̶0̶.̶0̶0̶               │
│                              │  │ Size:  [M] [L] [X̶L̶]                   │
└──────────────────────────────┘  │ ● In stock   (Only 3 left)            │
[th][th][th][th]  thumbnails      │ Quantity  [−] 1 [+]                   │
                                  │ [  Add to cart  ] [   Buy now   ]     │
                                  │ ┌ Cash on delivery ┐ ┌ Delivery ┐      │  ← only ERP-true facts
                                  │ SKU · Category chips                  │
                                  └──────────────────────────────────────┘
[ Description | Specifications | Delivery & returns ]   tabs
▌You may also like  (same category rail)

Mobile: gallery (swipe + dots) → info → tabs → related;
        sticky bottom bar: [৳1,450.00]  [🛒]  [ Buy now ]
```

- **Gallery:** ERP `media[]` sorted by `position`, with `alt` from the ERP or the product name, and keyboard-accessible thumbnails. When the ERP exposes `variant_id` per image (§6, E2), choosing a size or colour switches to that variant's image.
- **Variant picker:** grouped by attribute name ("Size", "Colour") from `variants[].attributes`, instead of today's single "Option" row.
- **Quantity stepper:** respects `min_order_quantity`, `max_order_quantity` and available stock.
- **Buy now** adds to the cart, then goes to checkout. Hidden in preview mode, where checkout is disabled.
- **Trust facts only when true:** COD (from `/site.checkout`), a flat delivery note, the return window (if the ERP exposes it). **Specifications** come from variant attributes; **Delivery & returns** text comes from `site/content.json`.
- **Share** uses the Web Share API, with copy-link as the fallback.
- **SEO:** Product JSON-LD and canonical stay as they are.

### 3.6 Cart

- **Two columns:** line items with thumbnail, name, variant, ERP unit price × qty (from the quote), stepper and remove. A sticky summary card shows the ERP subtotal, "Delivery calculated at checkout" and **Proceed to checkout**.
- **Mobile:** stacked lines and a sticky bottom checkout bar.
- **States:** empty (illustration-free icon + CTA), a line no longer available (from the quote refusal), and a low-stock warning.
- **Preview mode:** unchanged — catalogue prices, no total, the note stays.

### 3.7 Checkout (logic unchanged: quote → explicit confirm → place once)

- **Desktop:** steps on the left (1 Contact · 2 Delivery address with division/district/upazila · 3 Payment, COD); **order summary** on the right, sticky, with ERP figures only.
- **Mobile:** a collapsible summary at the top ("Show order summary ৳…"), single-column steps and a sticky **Calculate total / Place order** bar.
- Clear inline validation in EN/BN. The price-changed and stock-changed banners are restyled, but their behaviour is the same.
- Preview mode keeps the "ordering disabled" page.

### 3.8 Order confirmation and COD verification

- A success header with the order number and a copy button, and a status pill with text.
- The COD code entry becomes a 6-box OTP input (paste-friendly, `autocomplete="one-time-code"`), with a resend countdown and an item summary card. The logic stays as it is.

### 3.9 Footer

- **Columns:**
  - brand (logo or name, ERP `about`);
  - **Shop** (categories, New arrivals, Best sellers, Flash deals — the last two only when available);
  - **Help** (contact from the ERP; optional info pages from `site/content.json`);
  - **Language** switch.
- **Social links** come from `site/content.json`, and only those configured are shown.
- **Payment line:** "Cash on delivery" as text when enabled (no payment-network logos until online payment exists).
- **Mobile:** the columns become accordions.

### 3.10 System states

Every page keeps loading skeletons that match its final layout, plus empty, error, not-found (404) and unavailable (503) states. The preview banner stays on top of everything and is not themeable.

---

## 4. Mobile specifics (≤ 640 px)

- **Header and overflow:** the header fits 390 px (L6). The test is corrected to compare against the *device* width and run at 360, 390 and 414 px.
- **Rails and grids:** product rails are horizontal snap-scroll; grids use 2 columns with 12 px gaps.
- **Drawers:** menu and filter/sort open as drawers (focus-trapped, Esc / swipe to close).
- **Sticky bars:** a bottom bar on the product page (price + add + buy), the cart (checkout) and checkout (total + action). Content is padded so the bar never hides it.
- **Touch targets** are at least 44 px; inputs use the correct `inputmode` (tel, numeric).

## 5. Theme and customization architecture (preserved)

- **Unchanged:** presets in `globals.css`, `site/theme.css` overrides, `site.config.json` → `theme`, and the existing slots (`Hero`, `FooterNote`, `homeSections`).
- **New slots** in `site/customizations.tsx`: `TrustStrip`, `FooterColumns`, `ProductBadges`. They're optional, with the template's defaults otherwise.
- **New public content file:** `site/content.json` (schema-validated, no secrets) holds hero slides, trust cards, social links, info-page links and delivery/returns text.
- **New flag:** `features.accounts` (default `false`).
- The three presets are retuned and re-verified in the browser (3 presets × 2 viewports × key pages).

## 6. ERP image and data dependencies (for the ERP / ERP Panel sessions)

**Findings (read-only, dev DB, 2026-10-13):**

| Area | Finding |
|---|---|
| Product media | `product_media` = **0** rows and `stored_files` = **0**. **No product has an uploaded image.** The redesign will show correct placeholders until images are uploaded in the ERP Admin Panel |
| Payload | `media[] = { url, alt, position, type }`, sorted by `position`. **Not exposed** (though in the table): `width`, `height`, `product_variant_id` |
| URLs | `ProductMediaStore::url()` → public disk `local`, URL base `http://localhost/storage`. A generated URL looks like `http://localhost/storage/products/…/x.webp`: **no port**, while the ERP runs on `:8000`/`:8001`, and **no `public/storage` symlink**. So **image URLs from the dev ERP would 404 today**, even after an upload |
| Categories | They have `image_path`, but `/categories` sends no image |
| Branding | Website 2 has `logo_path`, `banner_path` and `tagline` all **null** |

| ID | Dependency (ERP side; v1-additive only — the contract allows new response fields) | Needed for |
|---|---|---|
| **E1** | Working media URLs. **Dev:** set the ERP public disk URL to the URL the ERP actually serves (e.g. `http://127.0.0.1:8000/storage`) and run `storage:link` — or use the R2 public disk. **Production:** absolute **HTTPS** URLs on R2/CDN | Any real image |
| **E2** | Add `width`, `height` and `variant_id` (variant public id or null) to each `media[]` item | Layout stability (no shift), variant image switching |
| **E3** | Add `image_url` (and optional `alt`) to category payloads | Category tiles |
| **E4** | Either create website categories for Karim Traders (data, via the Admin Panel) or add a `categories` facet to `/products/facets` | Category bar and pages |
| **E5** | Upload real product images, logo, banner and tagline for Karim Traders through the Admin Panel (operator data entry; no fake images) | Visual completeness |
| **E6** | Apply the pending P2 migrations (already planned) | Flash deals, Best sellers, Featured rails, sorting |

**Storefront-side image handling (part of this redesign):**

- `next/image` with a **build-time allow-list** of media hosts (`BANIJ_MEDIA_HOSTS`, e.g. the ERP host or the R2 domain). Only allow-listed hosts can be fetched, which guards against SSRF.
- The result is responsive `srcset`, lazy loading and optimised formats.
- Because the storefront's server fetches the images, they also work in the **private preview**, where the browser cannot reach the private ERP.

**Coordination:** two other Claude sessions are active here (`feriwala-a4`, `feriwala-0d`). I did not message either, because I can't tell which one is the ERP Panel redesign session and don't want to disturb the P2 work. Once you name it, I'll send it E1–E5 as a request. The ERP stays untouched by this session.

## 7. Implementation stages (after approval; storefront only)

| Stage | Content | Estimate |
|---|---|---|
| S0 Foundation | Tokens, Inter + Bangla fonts, preset retune, icon set, UI primitives, skeletons; fix the mobile overflow (L6) and its test | 0.75 day |
| S1 Shell | Header (desktop + mobile drawer + search), category bar with fallback source (L3), footer with accordions, `site/content.json` schema | 1 day |
| S2 Product card and catalogue | Card, grids, rails, catalogue/category with filter/sort drawer, chips, load-more | 1 day |
| S3 Homepage | Hero carousel (ERP banner + content), category tiles, rails with flash countdown, trust strip, resilient section states | 0.75 day |
| S4 Product page | Gallery, variant groups, stepper, Add + Buy now, sticky mobile bar, tabs, related, share | 1 day |
| S5 Cart, checkout, confirmation | Layouts, sticky bars, collapsible summary, OTP input, restyled states (logic unchanged) | 1 day |
| S6 Images | `next/image` + host allow-list, placeholders, ERP media integration; finished when E1/E5 land | 0.5 day (+ ERP) |
| S7 QA | Screenshots (3 presets × 360/390/1440 × key pages, EN/BN), accessibility pass (axe + keyboard), Lighthouse budget, preview-mode suite, full no-order regression | 0.75 day |
| **Total** | | **≈ 6.75 days** (storefront), plus the ERP items E1–E6 in their own sessions |

**Guardrails for every stage:**
- No ERP data or code changes, no test orders (E2E stops at the quote), no credential or domain changes, no Cloudflare, no deploy, no commit.
- Server-side ERP authority is untouched: prices, totals and availability always come from the ERP.

## 8. Decisions requested

1. **Approve the plan** (or adjust the stages), starting with S0–S1.
2. **Typography:** Inter + Noto Sans Bengali (recommended), or another family.
3. **Account icon:** hidden until accounts exist (recommended), or shown as "coming soon".
4. **`site/content.json`** for hero slides, trust cards and social links (recommended), or keep hero content ERP-only.
5. **Which session is the ERP Panel redesign,** so I can send E1–E5.
6. **Default preset look:** keep the warm-neutral "classic" as default, or make "modern" the default for new installations.
