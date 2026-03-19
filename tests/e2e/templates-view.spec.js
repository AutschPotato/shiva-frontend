const { test, expect } = require("@playwright/test")
const { login } = require("./support/result-run-helpers")

test("templates view exposes heading and template sections", async ({ page }) => {
  await login(page)
  await page.goto("/templates")

  await expect(page.getByRole("heading", { name: "Templates" })).toBeVisible()
  await expect(page.getByText(/Save and reuse test configurations/i)).toBeVisible()

  const bodyText = await page.locator("body").innerText()
  expect(bodyText).toMatch(/No templates yet|System Templates|My Templates|User Templates/i)
})