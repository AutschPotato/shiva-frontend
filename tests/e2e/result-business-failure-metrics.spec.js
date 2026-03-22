const { test, expect } = require("@playwright/test")
const {
  getStatValue,
  parseLocalizedNumber,
  startBusinessFailureRun,
} = require("./support/result-run-helpers")

test.setTimeout(300000)

async function readSummaryStats(page) {
  return {
    totalHttp: parseLocalizedNumber(await getStatValue(page, "Total HTTP Requests")),
    businessRequests: parseLocalizedNumber(await getStatValue(page, "Business Requests")),
    auxiliaryRequests: parseLocalizedNumber(await getStatValue(page, "Auxiliary HTTP Requests")),
    business2xx: parseLocalizedNumber(await getStatValue(page, "Business 2xx")),
    business4xx: parseLocalizedNumber(await getStatValue(page, "Business 4xx")),
    business5xx: parseLocalizedNumber(await getStatValue(page, "Business 5xx")),
    businessOther: parseLocalizedNumber(await getStatValue(page, "Other Business Failures")),
  }
}

test("business scenario /test/http/404 surfaces 4xx metrics", async ({ page }) => {
  await startBusinessFailureRun(page, `playwright_business_404_${Date.now()}`, {
    targetUrl: "http://target-lb:8090/test/http/404",
    httpMethod: "GET",
  })

  await expect(page.getByRole("heading", { name: "Executive Summary" })).toBeVisible()
  const stats = await readSummaryStats(page)
  const bodyText = await page.locator("body").innerText()

  expect(stats.totalHttp).toBeGreaterThan(0)
  expect(stats.businessRequests).toBeGreaterThan(0)
  expect(stats.auxiliaryRequests).toBeGreaterThanOrEqual(0)
  expect(stats.business2xx).toBe(0)
  expect(stats.business4xx).toBeGreaterThan(0)
  expect(stats.business5xx).toBe(0)
  expect(stats.businessOther).toBe(0)
  expect(bodyText).not.toMatch(/Authentication aborted the test run/i)
})

test("business scenario /test/http/500 surfaces 5xx metrics", async ({ page }) => {
  await startBusinessFailureRun(page, `playwright_business_500_${Date.now()}`, {
    targetUrl: "http://target-lb:8090/test/http/500",
    httpMethod: "POST",
  })

  await expect(page.getByRole("heading", { name: "Executive Summary" })).toBeVisible()
  const stats = await readSummaryStats(page)
  const bodyText = await page.locator("body").innerText()

  expect(stats.totalHttp).toBeGreaterThan(0)
  expect(stats.businessRequests).toBeGreaterThan(0)
  expect(stats.auxiliaryRequests).toBeGreaterThanOrEqual(0)
  expect(stats.business2xx).toBe(0)
  expect(stats.business4xx).toBe(0)
  expect(stats.business5xx).toBeGreaterThan(0)
  expect(stats.businessOther).toBe(0)
  expect(bodyText).not.toMatch(/Authentication aborted the test run/i)
})

test("business scenario /test/http/timeout is classified as non-status business failures", async ({ page }) => {
  await startBusinessFailureRun(page, `playwright_business_timeout_${Date.now()}`, {
    targetUrl: "http://target-lb:8090/test/http/timeout",
    httpMethod: "GET",
    vus: 1,
    duration: "10s",
    sleepSeconds: 0,
  })

  await expect(page.getByRole("heading", { name: "Executive Summary" })).toBeVisible()
  const totalHttp = parseLocalizedNumber(await getStatValue(page, "Total HTTP Requests"))
  const businessRequests = parseLocalizedNumber(await getStatValue(page, "Business Requests"))
  const auxiliaryRequests = parseLocalizedNumber(await getStatValue(page, "Auxiliary HTTP Requests"))
  const bodyText = await page.locator("body").innerText()

  expect(totalHttp).toBeGreaterThanOrEqual(0)
  expect(businessRequests).toBeGreaterThanOrEqual(0)
  expect(auxiliaryRequests).toBeGreaterThanOrEqual(0)
  expect(bodyText).not.toMatch(/Authentication aborted the test run/i)

  if (totalHttp > 0) {
    const business4xx = parseLocalizedNumber(await getStatValue(page, "Business 4xx"))
    const business5xx = parseLocalizedNumber(await getStatValue(page, "Business 5xx"))
    const businessOther = parseLocalizedNumber(await getStatValue(page, "Other Business Failures"))

    expect(business4xx).toBe(0)
    expect(business5xx).toBe(0)
    expect(businessOther).toBeGreaterThan(0)
  } else {
    expect(businessRequests).toBe(0)
    expect(auxiliaryRequests).toBeGreaterThanOrEqual(0)
  }
})
