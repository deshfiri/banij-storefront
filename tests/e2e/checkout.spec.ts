import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

function smsCodeFor(logPath: string, reference: string): string | null {
  const lines = readFileSync(logPath, "utf8").split("\n").filter((line) => line.includes(`order ${reference} is`));
  return /order \S+ is (\d{6})/.exec(lines.at(-1) ?? "")?.[1] ?? null;
}

/** Writes ERP orders: run deliberately, against the development ERP only. */
test.describe.configure({ mode: "serial" });

test("browse, cart, quote and place one COD order", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop" && !process.env.E2E_ORDER_ON_MOBILE, "one order per run");
  // Placing an order writes ERP data: require an explicit opt-in, otherwise stop at the quote.
  if (!process.env.ALLOW_ERP_ORDERS) {
    process.env.E2E_NO_ORDER = "1";
  }

  await page.goto("/");
  await expect(page).toHaveURL(/\/(en|bn)$/);
  await page.goto("/en/products");
  await expect(page.getByRole("heading", { name: "All products" })).toBeVisible();
  await page.getByRole("link", { name: /Sylhet Premium Black Tea/ }).click();
  await page.waitForURL(/\/en\/products\/sylhet-premium-black-tea-400g$/);
  await expect(page.getByRole("heading", { level: 1, name: /Sylhet Premium Black Tea/ })).toBeVisible();
  await expect(page.getByText("● In stock")).toBeVisible();

  await page.getByLabel("Quantity").fill("2");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to cart")).toBeVisible();

  await page.goto("/en/cart");
  await expect(page.getByText(/৳320\.00 × 2 = ৳640\.00/)).toBeVisible();
  await page.getByRole("link", { name: "Proceed to checkout" }).click();
  await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();

  await page.getByLabel("Full name").fill("E2E Test Customer");
  await page.getByLabel("Mobile number").fill("01712345678");
  await page.getByLabel("Address", { exact: true }).fill("House 1, Road 2, Dhanmondi");
  await page.getByLabel("City / Thana").fill("Dhaka");
  const division = page.getByLabel("Division");
  await expect(division.locator("option")).not.toHaveCount(1);
  await division.selectOption({ index: 1 });

  await page.getByRole("button", { name: "Calculate total" }).click();
  // Subtotal 640.00 + flat delivery from the ERP — the figure is the ERP's, not computed here.
  await expect(page.getByText("৳640.00").first()).toBeVisible();
  const placeButton = page.getByRole("button", { name: /Place order · ৳/ });
  await expect(placeButton).toBeEnabled();

  // E2E_NO_ORDER: stop at the authoritative quote, so the run writes nothing in the ERP.
  if (process.env.E2E_NO_ORDER) {
    await expect(page.getByText(/Delivery/).first()).toBeVisible();
    return;
  }

  // A double click must still produce exactly one order.
  await placeButton.dblclick();
  await expect(page).toHaveURL(/\/en\/orders\/[0-9A-Z]{26}$/, { timeout: 30_000 });
  await expect(page.getByText("Thank you — your order is placed")).toBeVisible();
  await expect(page.getByText(/Awaiting your confirmation/)).toBeVisible();
  const orderUrl = page.url();
  const reference = (await page.locator("strong.tabular").first().textContent())?.trim() ?? "";
  console.log(`E2E_ORDER ${orderUrl.split("/").pop()} ${reference}`);

  // COD confirmation. DEVELOPMENT ONLY: the ERP's SMS log driver is the only place the code exists.
  if (process.env.E2E_SMS_LOG) {
    await page.getByLabel("Confirmation code").fill("000000");
    await page.getByRole("button", { name: "Confirm order" }).click();
    await expect(page.getByText("That code was not accepted")).toBeVisible();

    const code = await expect
      .poll(() => smsCodeFor(process.env.E2E_SMS_LOG!, reference), { timeout: 15_000 })
      .not.toBeNull()
      .then(() => smsCodeFor(process.env.E2E_SMS_LOG!, reference));
    await page.getByLabel("Confirmation code").fill(code!);
    await page.getByRole("button", { name: "Confirm order" }).click();
    await expect(page.getByText("Your order is confirmed").first()).toBeVisible();
    await expect(page.getByText(/Status: Confirmed/)).toBeVisible();
  }

  // Cart is emptied after placement.
  await page.goto("/en/cart");
  await expect(page.getByText("Your cart is empty.")).toBeVisible();

  // Another browser (no session) cannot open the order: same 404 as an unknown id.
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  const response = await strangerPage.goto(orderUrl);
  await expect(strangerPage.getByText("Page not found")).toBeVisible();
  expect(response?.status()).toBeLessThan(500);
  await stranger.close();
});

test("catalogue and product pages render on this viewport", async ({ page }) => {
  await page.goto("/bn/products");
  await expect(page.getByRole("heading", { name: "সব পণ্য" })).toBeVisible();
  await page.goto("/en/products?q=panjabi");
  await expect(page.getByRole("link", { name: /Cotton Panjabi/ })).toBeVisible();
  await page.getByRole("link", { name: /Cotton Panjabi/ }).click();
  await page.waitForURL(/\/en\/products\/cotton-panjabi/);
  // The out-of-stock size is shown and cannot be bought.
  await page.locator("label", { hasText: "XL" }).click();
  await expect(page.getByText("Out of stock")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to cart" })).toBeDisabled();
  const overflow = await page.evaluate((w) => document.documentElement.scrollWidth > w, page.viewportSize()!.width);
  expect(overflow).toBe(false);
});
