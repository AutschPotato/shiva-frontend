const { test, expect } = require("@playwright/test")
const { login } = require("./support/result-run-helpers")

test("worker dashboards launcher is visible for admins", async ({ page }) => {
  await login(page)
  await page.goto("/worker-dashboards")

  await expect(page.getByRole("heading", { name: "Worker Dashboards", exact: true })).toBeVisible()
  await expect(page.getByText(/Admin Workspace/i)).toBeVisible()
  await expect(page.getByRole("heading", { name: /Live worker dashboards/i })).toBeVisible()

  const bodyText = await page.locator("body").innerText()
  expect(bodyText).toMatch(/No worker dashboard metadata is available yet|Open in new tab|Available|Running workers/i)
})
