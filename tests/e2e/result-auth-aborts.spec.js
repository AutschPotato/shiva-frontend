const { test, expect } = require("@playwright/test")
const {
  expectAuthAbort,
  getStatValue,
  parseLocalizedNumber,
  startAuthRun,
} = require("./support/result-run-helpers")

test.setTimeout(240000)

test("result view shows auth abort reason and response code for HTTP 401", async ({ page }) => {
  await startAuthRun(
    page,
    "playwright_auth_abort_401",
    "http://target-lb:8090/api/auth/token/401",
  )

  await expectAuthAbort(page, /\b401\b/)
})

test("result view shows auth abort reason and response code for HTTP 503", async ({ page }) => {
  await startAuthRun(
    page,
    "playwright_auth_abort_503",
    "http://target-lb:8090/api/auth/token/503",
  )

  await expectAuthAbort(page, /\b503\b/)
})

test("result view shows auth abort diagnostics for auth timeout", async ({ page }) => {
  await startAuthRun(
    page,
    "playwright_auth_abort_timeout",
    "http://target-lb:8090/api/auth/token/timeout",
  )

  await expect(page.getByText("Authentication", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Authentication aborted the test run")).toBeVisible()

  const tokenRequests = parseLocalizedNumber(await getStatValue(page, "Token Requests"))
  const responseCodes = await getStatValue(page, "Response Codes")
  const businessRequests = parseLocalizedNumber(await getStatValue(page, "Business Requests"))
  const bodyText = await page.locator("body").innerText()

  expect(tokenRequests).toBeGreaterThan(0)
  expect(businessRequests).toBe(0)
  expect(bodyText).toMatch(/Cause:/i)
  expect(bodyText).toMatch(/HTTP Status Codes:/i)
  expect(bodyText).toMatch(/Retryable:/i)

  const has504 = /\b504\b/.test(responseCodes) || /\b504\b/.test(bodyText)
  const hasTimeoutText = /timeout|timed out/i.test(responseCodes) || /timeout|timed out/i.test(bodyText)

  expect(has504 || hasTimeoutText).toBeTruthy()
})
