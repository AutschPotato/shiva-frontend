const { test, expect } = require("@playwright/test")
const { login } = require("./support/result-run-helpers")

test.setTimeout(180000)

test("run form focuses missing required fields from bottom submit", async ({ page }) => {
  await login(page)
  await page.getByRole("link", { name: "Run Test", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Run Test", exact: true })).toBeVisible()

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.getByRole("button", { name: "Run Load Test", exact: true }).click()
  await expect(page.locator("#project-name-input")).toBeFocused()

  await page.locator("#project-name-input").fill(`playwright_ux_required_${Date.now()}`)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.getByRole("button", { name: "Run Load Test", exact: true }).click()
  await expect(page.locator("#target-url-input")).toBeFocused()
})

test("run form scrolls to top when startup modal appears", async ({ page }) => {
  let runStarted = false

  await page.route("**/api/backend/api/metrics/live", async (route) => {
    const payload = runStarted
      ? { test_id: "ux-scroll-run", status: "running", phase: "script" }
      : { test_id: "", status: "idle", phase: "idle", message: "no test is currently running" }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) })
  })
  await page.route("**/api/backend/api/run", async (route) => {
    runStarted = true
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ test_id: "ux-scroll-run", controllable: false }),
    })
  })

  await login(page)
  await page.getByRole("link", { name: "Run Test", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Run Test", exact: true })).toBeVisible()

  await page.locator("#project-name-input").fill(`playwright_ux_modal_${Date.now()}`)
  await page.locator("#target-url-input").fill("http://target-lb:8090/health")
  await page.getByRole("button", { name: /^Constant Load/i }).click()

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(page.locator("#project-name-input")).not.toBeInViewport()

  await page.getByRole("button", { name: "Run Load Test", exact: true }).click()
  await expect(page.getByRole("heading", { name: /Generating Load|Collecting Final Results/i })).toBeVisible()
  await expect(page.locator("#project-name-input")).toBeInViewport()
})

test("run form scrolls to top when run start fails and error toast is shown", async ({ page }) => {
  await page.route("**/api/backend/api/metrics/live", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ test_id: "", status: "idle", phase: "idle", message: "no test is currently running" }),
    })
  })
  await page.route("**/api/backend/api/run", async (route) => {
    await route.fulfill({ status: 502, contentType: "text/plain", body: "backend unavailable" })
  })

  await login(page)
  await page.getByRole("link", { name: "Run Test", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Run Test", exact: true })).toBeVisible()

  await page.locator("#project-name-input").fill(`playwright_ux_error_${Date.now()}`)
  await page.locator("#target-url-input").fill("http://target-lb:8090/health")
  await page.getByRole("button", { name: /^Constant Load/i }).click()

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(page.locator("#project-name-input")).not.toBeInViewport()

  await page.getByRole("button", { name: "Run Load Test", exact: true }).click()
  await expect(page.getByText("backend unavailable")).toBeVisible()
  await expect(page.locator("#project-name-input")).toBeInViewport()
})
