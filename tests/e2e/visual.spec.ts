import { expect, test } from "@playwright/test";

/**
 * Visual review: every theme preset on the key pages, at the viewport of the running project.
 * The theme comes from the ERP's branding; `bsf_theme_preview` is a development-only override.
 * Screenshots land in test-results/visual/ for a human to look at. No orders are placed.
 */
const THEMES = ["classic", "modern", "minimal"] as const;
const PAGES = [
  ["home", "/en"],
  ["catalogue", "/en/products"],
  ["product", "/en/products/cotton-panjabi-off-white"],
  ["empty-search", "/en/products?q=zzzz-nothing"],
  ["bangla", "/bn/products"],
] as const;

for (const theme of THEMES) {
  test(`theme ${theme}`, async ({ page, context, baseURL }, info) => {
    await context.addCookies([{ name: "bsf_theme_preview", value: theme, url: baseURL! }]);
    for (const [name, path] of PAGES) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("main")).toBeVisible();
      // Wait for streamed sections, not their skeletons, before judging the page.
      await expect(page.locator("main .skeleton")).toHaveCount(0, { timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate((w) => document.documentElement.scrollWidth > w, page.viewportSize()!.width);
      expect(overflow, `${name} overflows horizontally`).toBe(false);
      await page.screenshot({ path: `test-results/visual/${info.project.name}-${theme}-${name}.png`, fullPage: name !== "home" });
    }
    await expect(page.getByRole("heading", { level: 1, name: "সব পণ্য" })).toBeVisible();
  });
}

test("empty search shows the empty state", async ({ page }) => {
  await page.goto("/en/products?q=zzzz-nothing");
  await expect(page.getByText("No products match these filters.")).toBeVisible();
});

test("empty cart and checkout without a cart", async ({ page }) => {
  await page.goto("/en/cart");
  await expect(page.getByText("Your cart is empty.")).toBeVisible();
  await page.goto("/en/checkout");
  await expect(page).toHaveURL(/\/en\/cart$/);
});

test("unknown product renders the not-found state with a 404", async ({ page }) => {
  const response = await page.goto("/en/products/does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Page not found")).toBeVisible();
});

test("cart cookie is host-only, HttpOnly and SameSite=Lax", async ({ page, context }) => {
  await page.goto("/en/products/sylhet-premium-black-tea-400g");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to cart")).toBeVisible();
  const cart = (await context.cookies()).find((cookie) => cookie.name === "bsf_cart");
  expect(cart).toBeDefined();
  expect(cart!.httpOnly).toBe(true);
  expect(cart!.sameSite).toBe("Lax");
  // Host-only: the browser records the exact host, never a parent domain.
  expect(cart!.domain).toBe("karimtraders.localhost");
  expect(cart!.value).toMatch(/^[A-Za-z0-9_-]{22}$/);
});
