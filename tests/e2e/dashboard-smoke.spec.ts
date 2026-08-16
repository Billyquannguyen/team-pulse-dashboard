import { expect, test } from "@playwright/test";

test("dashboard renders a usable first screen", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("body")).not.toHaveText("");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
});
