import { expect, test } from "@playwright/test";

/**
 * The product page's mobile sticky purchase bar and the cart's quantity stepper. Both only touch the
 * storefront's own cart (Redis) and the ERP's read-only quote; no order is ever placed here.
 */
const TEA = "/en/products/sylhet-premium-black-tea-400g";

test("mobile sticky bar appears once the main buttons scroll away, and adds the chosen quantity", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the bar is a phone layout");
  await page.goto(TEA);
  const bar = page.locator("[data-sticky-buy]");
  // While the main buttons are on screen the bar is out of the way and out of the accessibility tree.
  await expect(bar).toHaveAttribute("inert", "");
  await page.getByRole("button", { name: "Add one" }).click();
  await expect(page.getByLabel("Quantity")).toHaveValue("2");

  await page.locator("footer").scrollIntoViewIfNeeded();
  await expect(bar).not.toHaveAttribute("inert");
  await expect(bar).toBeInViewport();
  await expect(bar.getByText("৳320.00")).toBeVisible();
  const add = bar.getByRole("button", { name: "Add 2 to cart" });
  await add.click();
  await expect(page.locator("header [data-cart-count]")).toHaveAttribute("data-cart-count", "2");
  await expect(bar.getByRole("link", { name: /Cart \(2\)/ })).toBeVisible();

  // Buy now from the bar goes to checkout with the cart — the order itself is never submitted here.
  await bar.getByRole("button", { name: "Buy now" }).click();
  await expect(page).toHaveURL(/\/en\/checkout$/);
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
});

test("no sticky bar on desktop", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop layout");
  await page.goto(TEA);
  await page.locator("footer").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-sticky-buy]")).toBeHidden();
});

test("cart stepper changes the quantity and the ERP's totals follow", async ({ page }) => {
  await page.goto(TEA);
  await page.locator("main").getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to cart")).toBeVisible();
  await page.goto("/en/cart");
  await expect(page.getByText(/৳320\.00 × 1 = ৳320\.00/)).toBeVisible();

  const line = page.getByRole("group", { name: /Quantity: Sylhet Premium Black Tea/ });
  await expect(line.getByRole("button", { name: /^Remove one/ })).toBeDisabled();
  await line.getByRole("button", { name: /^Add one/ }).click();
  await expect(page.getByText(/৳320\.00 × 2 = ৳640\.00/)).toBeVisible();
  await expect(page.locator("header [data-cart-count]")).toHaveAttribute("data-cart-count", "2");

  await page.getByRole("group", { name: /Quantity: Sylhet Premium Black Tea/ }).getByRole("button", { name: /^Remove one/ }).click();
  await expect(page.getByText(/৳320\.00 × 1 = ৳320\.00/)).toBeVisible();

  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Your cart is empty.")).toBeVisible();
});
