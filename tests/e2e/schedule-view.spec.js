const { test, expect } = require("@playwright/test")
const { login } = require("./support/result-run-helpers")

test("schedule view exposes heading, search, and view toggle", async ({ page }) => {
  await login(page)
  await page.goto("/schedule")

  await expect(page.getByRole("heading", { name: "Schedules" })).toBeVisible()
  await expect(page.getByPlaceholder("Search by schedule, test run, owner, timezone, or status")).toBeVisible()
  await expect(page.getByRole("button", { name: /Timeline/i })).toBeVisible()
  await expect(page.getByRole("button", { name: /List/i })).toBeVisible()
  await expect(page.getByRole("link", { name: /New Schedule/i })).toBeVisible()

  await page.getByRole("button", { name: /List/i }).click()
  const bodyText = await page.locator("body").innerText()
  expect(bodyText).toMatch(/No schedules match the current search|No scheduled tests yet|schedule visible|schedules visible/i)
})