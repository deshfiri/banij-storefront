import { type Browser, expect, type Page, test } from "@playwright/test";

/**
 * UI redesign S0–S1: responsive foundations, header, search, navigation drawer, category bar, cart
 * indicator, footer, and accessibility basics. Browsing only — no cart writes, no checkout.
 */
const BASE = process.env.E2E_BASE_URL ?? "http://karimtraders.localhost:3000";
const THEMES = ["classic", "modern", "minimal"] as const;
const PAGES = ["/en", "/bn", "/en/products", "/bn/products", "/en/products/sylhet-premium-black-tea-400g", "/bn/cart"];

/** Real overflow test: compare with the DEVICE width, not the (possibly widened) layout viewport. */
async function overflowAt(page: Page, width: number): Promise<number> {
  return page.evaluate((w) => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - w, width);
}

async function mobilePage(browser: Browser, width: number, theme?: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });
  if (theme) await context.addCookies([{ name: "bsf_theme_preview", value: theme, url: BASE }]);
  return context.newPage();
}

test.describe("responsive foundations", () => {
  // Creates its own 360/390/414 and desktop contexts, so it runs once (in the desktop project).
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "desktop", "creates its own contexts");
  });

  for (const width of [360, 390, 414]) {
    test(`no horizontal overflow at ${width}px — every theme, both languages`, async ({ browser }) => {
      for (const theme of THEMES) {
        const page = await mobilePage(browser, width, theme);
        for (const path of PAGES) {
          await page.goto(BASE + path);
          await expect(page.locator("main")).toBeVisible();
          expect(await overflowAt(page, width), `${theme} ${path} @${width}px`).toBeLessThanOrEqual(0);
        }
        await page.context().close();
      }
    });
  }

  test("no horizontal overflow on desktop (1280, 1440)", async ({ browser }) => {
    for (const width of [1280, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      for (const path of PAGES) {
        await page.goto(BASE + path);
        expect(await overflowAt(page, width), `${path} @${width}px`).toBeLessThanOrEqual(0);
      }
      await context.close();
    }
  });
});

test.describe("header", () => {
  test("brand, search, language, cart and this browser's orders — no sign-in", async ({ page, isMobile }) => {
    await page.goto("/en");
    const header = page.locator("header").first();
    await expect(header.getByRole("link", { name: "Karim Traders Shop" })).toBeVisible();
    await expect(header.getByRole("search")).toBeVisible();
    await expect(header.getByRole("link", { name: /^Cart, \d+ items$/ })).toBeVisible();
    await expect(header.getByRole("link", { name: "বাংলা" })).toBeVisible();
    // The person icon opens the orders this browser placed; there are no customer accounts to sign in to.
    // On phones it lives in the menu drawer, so the shop name keeps its room in the header row.
    if (isMobile) {
      await header.getByRole("button", { name: "Open menu" }).click();
      await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Your orders" })).toHaveAttribute("href", "/en/orders");
    } else {
      await expect(header.getByRole("link", { name: "Your orders" })).toHaveAttribute("href", "/en/orders");
    }
    await expect(page.getByRole("link", { name: /account|sign in|log in/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /account|sign in|log in/i })).toHaveCount(0);
  });

  test("a long shop name never pushes search, language or cart off a 390px screen", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto("http://karimtraders.localhost:3000/en");
    const header = page.locator("header").first();
    // Simulate a much longer name in the same header (display only).
    await header.locator("[data-brand-name]").evaluate((el) => (el.textContent = "Karim Traders Wholesale and Retail Fashion House of Dhaka"));
    for (const control of [header.getByRole("searchbox"), header.getByRole("link", { name: "বাংলা" }), header.getByRole("link", { name: /^Cart, / })]) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await context.close();
  });

  test("'Your orders' with no orders from this browser shows the empty state", async ({ page }) => {
    await page.goto("/en/orders");
    await expect(page.getByRole("heading", { level: 1, name: "Your orders" })).toBeVisible();
    await expect(page.getByText(/No orders from this browser yet/)).toBeVisible();
  });

  test("search submits to the catalogue and keeps the query", async ({ page }) => {
    await page.goto("/en");
    const search = page.locator("header").getByRole("searchbox");
    await search.fill("tea");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/en\/products\?q=tea$/);
    await expect(page.getByRole("link", { name: /Sylhet Premium Black Tea/ })).toBeVisible();
    await expect(page.locator("header").getByRole("searchbox")).toHaveValue("tea");
  });

  test("language switch stays on the same page", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop header control");
    await page.goto("/en/products?sort=name");
    await page.locator("header").getByRole("link", { name: "বাংলা" }).click();
    await expect(page).toHaveURL(/\/bn\/products\?sort=name$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  });

  test("category bar: 'All products' is current on the catalogue; a category filters real ERP results", async ({ page }) => {
    await page.goto("/en/products");
    const bar = page.getByRole("navigation", { name: "Categories" });
    await expect(bar.getByRole("link", { name: "All products" })).toHaveAttribute("aria-current", "page");
    const grocery = bar.getByRole("link", { name: "Grocery" });
    await grocery.click();
    await expect(page).toHaveURL(/\/en\/products\?category=grocery$/);
    await expect(bar.getByRole("link", { name: "Grocery" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: /Sylhet Premium Black Tea/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Cotton Panjabi/ })).toHaveCount(0);
    // The filter form keeps the category, so sorting stays within it.
    await expect(page.locator('form[aria-label="Filters"] input[name="category"]')).toHaveValue("grocery");
  });
});

test.describe("mobile navigation drawer", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile only");

  test("opens with its button, traps focus, closes on Esc and returns focus", async ({ page }) => {
    await page.goto("/en");
    const open = page.getByRole("button", { name: "Open menu" });
    await open.click();
    const drawer = page.getByRole("dialog", { name: "Menu" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: "All products" })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Grocery" })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "বাংলা" })).toBeVisible();
    // Focus never reaches the page behind the open dialog (it is inert). A native modal dialog may hand
    // focus to the browser's own UI after its last control (activeElement is then <body>), then back.
    let insideAtLeastOnce = false;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() =>
        document.activeElement?.closest("dialog") ? "dialog" : document.activeElement === document.body ? "browser" : "page",
      );
      expect(where).not.toBe("page");
      insideAtLeastOnce ||= where === "dialog";
    }
    expect(insideAtLeastOnce).toBe(true);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(open).toBeFocused();
  });

  test("navigating from the drawer closes it", async ({ page }) => {
    await page.goto("/en");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Grocery" }).click();
    await expect(page).toHaveURL(/\/en\/products\?category=grocery$/);
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeHidden();
  });

  test("Bangla drawer labels", async ({ page }) => {
    await page.goto("/bn");
    await page.getByRole("button", { name: "মেনু খুলুন" }).click();
    await expect(page.getByRole("dialog", { name: "মেনু" }).getByRole("link", { name: "সব পণ্য" })).toBeVisible();
  });
});

test.describe("footer", () => {
  test("structured columns from ERP and content data; COD only when the ERP enables it", async ({ page, isMobile }) => {
    await page.goto("/en");
    const footer = page.locator("footer");
    if (isMobile) {
      const shop = footer.locator("details").filter({ hasText: "Shop" });
      await expect(shop.getByRole("link", { name: "All products" })).toBeHidden();
      await shop.locator("summary").click();
      await expect(shop.getByRole("link", { name: "All products" })).toBeVisible();
    } else {
      await expect(footer.getByRole("link", { name: "All products" }).first()).toBeVisible();
      await expect(footer.getByRole("link", { name: "New arrivals" }).first()).toBeVisible();
    }
    await expect(footer.getByText("Cash on delivery")).toBeVisible();
    await expect(footer.getByText(/© \d{4} Karim Traders Shop/)).toBeVisible();
  });
});

test.describe("accessibility basics", () => {
  for (const path of ["/en", "/bn/products", "/en/products/sylhet-premium-black-tea-400g", "/en/cart"]) {
    test(`${path}: landmarks, one h1, names on every control, alt on images`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", /^(en|bn)$/);
      await expect(page.locator("header")).toHaveCount(1);
      await expect(page.locator("main#main")).toHaveCount(1);
      await expect(page.locator("footer")).toHaveCount(1);
      await expect(page.locator("main h1")).toHaveCount(1);
      const unnamed = await page.evaluate(() =>
        [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select")]
          .filter((el) => (el as HTMLElement).offsetParent !== null || el.closest("header"))
          .filter((el) => {
            const name =
              el.getAttribute("aria-label") ||
              (el.getAttribute("aria-labelledby") && document.getElementById(el.getAttribute("aria-labelledby")!)?.textContent) ||
              (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) ||
              el.closest("label")?.textContent ||
              (el as HTMLInputElement).placeholder ||
              el.textContent;
            return !name || !name.trim();
          })
          .map((el) => el.outerHTML.slice(0, 120)),
      );
      expect(unnamed).toEqual([]);
      expect(await page.locator("img:not([alt])").count()).toBe(0);
    });
  }

  test("skip link is the first stop and moves focus to the content", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard");
    await page.goto("/en");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });

  test("keyboard focus is visible", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard");
    await page.goto("/en");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThanOrEqual(2);
  });
});
