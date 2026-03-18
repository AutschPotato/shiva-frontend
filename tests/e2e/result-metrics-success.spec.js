const { test, expect } = require("@playwright/test")
const { getStatValue, parseLocalizedNumber, startAuthRun } = require("./support/result-run-helpers")

test.setTimeout(240000)

test("result view shows consistent metrics for a successful auth run", async ({ page }) => {
  await startAuthRun(
    page,
    "playwright_auth_success_metrics",
    "http://target-lb:8090/api/auth/token",
  )

  await expect(page.getByText("Authentication")).toBeVisible()
  await expect(page.getByText("Executive Summary")).toBeVisible()
  await expect(page.getByText("HTTP Performance")).toBeVisible()
  await expect(page.getByText("Primary Latency")).toBeVisible()

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
  const business2xxMatch = bodyText.match(/Business 2xx\s+([\d.,]+)/i)
  if (!business2xxMatch) throw new Error("Could not extract Business 2xx")

  const business2xx = parseLocalizedNumber(business2xxMatch[1])
  expect(business2xx).toBeLessThanOrEqual(businessRequests)

  const minLatencyMatch = bodyText.match(/Primary Latency[\s\S]*?Min\s+([\d.,]+)\s*(ms|s|us|µs)/i)
  if (!minLatencyMatch) throw new Error("Could not extract primary latency min")

  const minLatency = parseLocalizedNumber(minLatencyMatch[1])
  expect(minLatency).toBeGreaterThan(0)
})
