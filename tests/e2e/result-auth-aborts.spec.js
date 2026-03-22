const { test, expect } = require("@playwright/test")
const { expectAuthAbort, startAuthRun } = require("./support/result-run-helpers")

test.setTimeout(240000)

test("result view shows auth abort reason and response code for HTTP 401", async ({ page }) => {
  await startAuthRun(
    page,
    "playwright_auth_abort_401",
    "http://target-lb:8090/api/auth/token/401",
  )

  await expectAuthAbort(page, /\b401\b/)
})

test("result view shows auth abort reason and response code for HTTP 404", async ({ page }) => {
  await startAuthRun(
    page,
    "playwright_auth_abort_404",
    "http://target-lb:8090/api/auth/token/404",
  )

  await expectAuthAbort(page, /\b404\b/)
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

  await expectAuthAbort(page)
  await expect(page.locator("body")).toContainText(/timeout|timed out/i)
})
