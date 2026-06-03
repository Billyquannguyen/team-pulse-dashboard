import { expect, test } from "@playwright/test";

test("dashboard renders a usable first screen", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("body")).not.toHaveText("");
});
