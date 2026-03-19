const { test, expect } = require("@playwright/test")
const { getStatValue, parseLocalizedNumber, startAuthRun } = require("./support/result-run-helpers")

test.setTimeout(240000)

test("result view shows consistent metrics for a successful auth run", async ({ page }) => {
  await startAuthRun(
    page,
    "playwright_auth_success_metrics",
    "http://target-lb:8090/api/auth/token",
  )

  await expect(page.getByText("Authentication", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("heading", { name: "Executive Summary" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "HTTP Performance" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Primary Latency" })).toBeVisible()

  const totalHttp = parseLocalizedNumber(await getStatValue(page, "Total HTTP Requests"))
  const businessRequests = parseLocalizedNumber(await getStatValue(page, "Business Requests"))
  const auxiliaryHttp = parseLocalizedNumber(await getStatValue(page, "Auxiliary HTTP Requests"))
  const iterations = parseLocalizedNumber(await getStatValue(page, "Iterations"))
  const tokenRequests = parseLocalizedNumber(await getStatValue(page, "Token Requests"))
  const responseCodes = await getStatValue(page, "Response Codes")

  expect(totalHttp).toBeGreaterThan(0)
  expect(businessRequests).toBeGreaterThan(0)
  expect(iterations).toBeGreaterThan(0)
  expect(tokenRequests).toBeGreaterThan(0)

  expect(totalHttp).toBeGreaterThanOrEqual(businessRequests)
  expect(totalHttp).toBeGreaterThanOrEqual(iterations)
  expect(auxiliaryHttp).toBeGreaterThanOrEqual(0)
  expect(totalHttp - businessRequests).toBe(auxiliaryHttp)

  expect(responseCodes).not.toMatch(/^(-|—|N\/A)$/i)
  expect(responseCodes).toMatch(/\b200\b/)

  const bodyText = await page.locator("body").innerText()
  const business2xx = parseLocalizedNumber(await getStatValue(page, "Business 2xx"))
  expect(business2xx).toBeLessThanOrEqual(businessRequests)
  expect(business2xx).toBeLessThanOrEqual(businessRequests)

})



