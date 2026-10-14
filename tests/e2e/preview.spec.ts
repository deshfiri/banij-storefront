import { expect, test } from "@playwright/test";

/**
 * Read-only preview in a real browser, against a LOCAL preview test instance started by
 * dev/preview-runtime-check.sh (port 3201; the browser maps the shop's host to it). Places no order:
 * there is no way to — which is what these tests prove from the customer's side.
 */
test.skip(!process.env.E2E_PREVIEW, "runs only via dev/preview-runtime-check.sh");

test.use({
  baseURL: "http://karimtraders.feriwala.shop",
  launchOptions: { args: ["--host-resolver-rules=MAP karimtraders.feriwala.shop 127.0.0.1:3201"] },
});

test("banner on every page, in English and Bangla", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator("[data-preview-banner]")).toContainText("PREVIEW — UNDER DEVELOPMENT");
  await expect(page.locator("[data-preview-banner]")).toContainText("Ordering is disabled");
  await page.goto("/en/products");
  await expect(page.locator("[data-preview-banner]")).toBeVisible();
  await page.goto("/bn/products");
  await expect(page.locator("[data-preview-banner]")).toContainText("প্রিভিউ — নির্মাণাধীন");
  await expect(page.getByRole("heading", { name: "সব পণ্য" })).toBeVisible();
});

for (const path of ["/en", "/en/products", "/en/products?sort=name", "/en/products/sylhet-premium-black-tea-400g", "/bn/products", "/en/cart"]) {
  test(`${path} is marked noindex (header and meta)`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
  });
}

test("browse, add to cart, and find checkout disabled", async ({ page }) => {
  await page.goto("/en/products");
  await page.getByRole("link", { name: /Sylhet Premium Black Tea/ }).click();
  await page.waitForURL(/\/en\/products\/sylhet-premium-black-tea-400g$/);
  await expect(page.getByText("● In stock")).toBeVisible();
  await page.getByLabel("Quantity").fill("2");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to cart")).toBeVisible();

  await page.goto("/en/cart");
  // Each line shows the product's own ERP price; no quote, no total computed in the storefront.
  await expect(page.locator("[data-preview-price]")).toHaveText(/৳320\.00 × 2/);
  await expect(page.locator("[data-preview-cart-note]")).toBeVisible();
  await expect(page.getByText("Subtotal")).toHaveCount(0);

  await page.getByRole("link", { name: "Proceed to checkout" }).click();
  await expect(page.locator("[data-preview-checkout]")).toContainText("Ordering is disabled in this preview");
  await expect(page.getByRole("button", { name: /Place order|Calculate total/ })).toHaveCount(0);
  await expect(page.locator("form input[name=phone]")).toHaveCount(0);
});

test("order pages do not exist in a preview", async ({ page }) => {
  const response = await page.goto("/en/orders/01M4T0960T4XYMZ2T4PM0DBYR4");
  expect(response?.status()).toBe(404);
});

test("themes and language switch still work", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", /classic|modern|minimal/);
  // The header switch (the footer offers the same languages).
  await page.locator("header").getByRole("link", { name: "বাংলা" }).click();
  await expect(page).toHaveURL(/\/bn$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
});
