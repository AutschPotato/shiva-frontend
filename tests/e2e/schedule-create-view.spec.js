const { test, expect } = require("@playwright/test")
const { login } = require("./support/result-run-helpers")

test("schedule creation view exposes the core builder fields", async ({ page }) => {
  await login(page)
  await page.goto("/schedule/new")

  await expect(page.getByText(/Schedule Details/i)).toBeVisible()
  await expect(page.getByText(/^Schedule Name$/i)).toBeVisible()
  await expect(page.getByText(/^Test Run Name$/i)).toBeVisible()
  await expect(page.getByText(/Start Date & Time/i)).toBeVisible()
  await expect(page.getByPlaceholder(/Nightly Load Test/i)).toBeVisible()
  await expect(page.getByPlaceholder(/Nightly checkout flow/i)).toBeVisible()

  await page.getByRole("button", { name: "Builder", exact: true }).click()
  await expect(page.getByPlaceholder(/https:\/\/api\.example\.com\/orders/i)).toBeVisible()
  await expect(page.getByText(/Target URL/i)).toBeVisible()
  await expect(page.getByRole("button", { name: /Create Schedule/i })).toBeVisible()
})
