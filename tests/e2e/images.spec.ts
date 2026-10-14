import { expect, test } from "@playwright/test";

/**
 * Real ERP product images on cards and the product page (run once STOREFRONT_IMAGE_ORIGIN is set to
 * the ERP's confirmed media origin): `E2E_IMAGES=1 bash dev/e2e.sh tests/e2e/images.spec.ts`.
 * Uses a dev product that has an uploaded image (Checked Cotton Lungi). Whether some real product
 * lacks an image is data that changes, so the placeholder is covered by fixed fixtures in
 * tests/unit/product-placeholder.test.ts; here every card only has to be one or the other, never broken.
 */
test.skip(!process.env.E2E_IMAGES, "enable after the ERP image origin is configured");

const WITH_IMAGE = "checked-cotton-lungi";

const ERP_ORIGIN = "http://localhost:8000/storage/";

async function loaded(locator: import("@playwright/test").Locator) {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
}

/** The image is served by the storefront's own optimizer, wrapping a URL under the trusted ERP origin. */
async function servedByStorefront(page: import("@playwright/test").Page, locator: import("@playwright/test").Locator) {
  const src = new URL((await locator.getAttribute("src"))!, page.url());
  expect(src.host).toBe(new URL(page.url()).host);
  expect(src.pathname).toBe("/_next/image");
  expect(src.searchParams.get("url")).toMatch(new RegExp(`^${ERP_ORIGIN.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`));
}

/** No element makes the browser contact the ERP directly. */
async function noDirectErpReferences(page: import("@playwright/test").Page) {
  const direct = await page.evaluate((origin) => {
    const values: string[] = [];
    document.querySelectorAll("img").forEach((img) => values.push(img.getAttribute("src") ?? "", ...(img.getAttribute("srcset") ?? "").split(",")));
    document.querySelectorAll("link[href], source[srcset], a[href]").forEach((el) => values.push(el.getAttribute("href") ?? el.getAttribute("srcset") ?? ""));
    return values.map((v) => v.trim()).filter((v) => v.startsWith(origin) || v.startsWith(origin.replace("localhost", "127.0.0.1")));
  }, "http://localhost:8000");
  expect(direct).toEqual([]);
}

async function noBrokenImages(page: import("@playwright/test").Page) {
  const broken = await page.evaluate(() =>
    [...document.querySelectorAll("img")].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.src),
  );
  expect(broken).toEqual([]);
}

/** Every product card shows exactly one of: a loaded image, or the placeholder. */
async function everyCardImageOrPlaceholder(page: import("@playwright/test").Page) {
  const cards = page.locator("[data-card-image]");
  await expect(cards.first()).toBeVisible();
  await expect
    .poll(() =>
      cards.evaluateAll((all) =>
        all
          .map((card) => {
            const img = card.querySelector("img");
            const loaded = !!img && img.complete && img.naturalWidth > 0;
            const placeholder = !!card.querySelector("[data-image-placeholder]");
            return loaded !== placeholder ? null : card.closest("a")?.getAttribute("href");
          })
          .filter((href) => href !== null),
      ),
    )
    .toEqual([]);
}

test("product card shows the uploaded image via the storefront optimizer, as WebP", async ({ page }) => {
  const responses: { url: string; type: string | null; status: number }[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/_next/image")) responses.push({ url: r.url(), type: r.headers()["content-type"] ?? null, status: r.status() });
  });
  await page.goto("/en/products");
  const card = page.locator(`a[href="/en/products/${WITH_IMAGE}"]`);
  const img = card.locator("[data-card-image] img");
  await loaded(img);
  // The browser loads the image from the storefront, never from the ERP origin directly.
  await servedByStorefront(page, img);
  await noDirectErpReferences(page);
  await noBrokenImages(page);
  expect(responses.some((r) => r.status === 200 && r.type === "image/webp")).toBe(true);
  await everyCardImageOrPlaceholder(page);
});

test("product page shows the primary image (position 1) with real alt text", async ({ page }) => {
  await page.goto(`/en/products/${WITH_IMAGE}`);
  const main = page.locator("[data-gallery-main] img");
  await loaded(main);
  await servedByStorefront(page, main);
  expect((await main.getAttribute("alt"))?.length).toBeGreaterThan(0);
  await noDirectErpReferences(page);
  await noBrokenImages(page);
  // Open Graph points at the storefront's own image URL, not at the ERP.
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(new URL(og!).pathname).toBe("/_next/image");
});

test("the same image in Bangla", async ({ page }) => {
  await page.goto(`/bn/products/${WITH_IMAGE}`);
  await loaded(page.locator("[data-gallery-main] img"));
  await page.goto("/bn/products");
  await loaded(page.locator(`a[href="/bn/products/${WITH_IMAGE}"] [data-card-image] img`));
  await everyCardImageOrPlaceholder(page);
  await noBrokenImages(page);
});
