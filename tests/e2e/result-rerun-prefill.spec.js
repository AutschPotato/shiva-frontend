const { test, expect } = require("@playwright/test")
const {
  expectInputValueByLabel,
  expectScenarioSelected,
  openRerunFormFromResult,
  startConstantVusRun,
  startNativeArrivalRateRun,
} = require("./support/result-run-helpers")

test.setTimeout(300000)

test("rerun preserves fixed-throughput execution settings from result detail", async ({ page }) => {
  await startNativeArrivalRateRun(page, `playwright_rerun_arrival_${Date.now()}`, {
    rate: 240,
    timeUnit: "1s",
    duration: "30s",
    preAllocatedVUs: 12,
    maxVUs: 24,
  })

  await openRerunFormFromResult(page)

  await expectScenarioSelected(page, "Fixed Throughput")
  await expect(page.locator("label").filter({ hasText: /^Rate \(iterations\)$/ })).toBeVisible()
  await expect(page.locator("label").filter({ hasText: /^Virtual Users$/ })).toHaveCount(0)
  await expectInputValueByLabel(page, "Rate (iterations)", 240)
  await expect(page.locator("label").filter({ hasText: /^Time Unit$/ }).locator("xpath=following-sibling::select[1]")).toHaveValue("1s")
  await expectInputValueByLabel(page, "Duration", "30s")
  await expectInputValueByLabel(page, "Pre-allocated VUs", 12)
  await expectInputValueByLabel(page, "Max VUs", 24)
})

test("rerun preserves constant-load execution settings from result detail", async ({ page }) => {
  await startConstantVusRun(page, `playwright_rerun_vus_${Date.now()}`, {
    vus: 18,
    duration: "45s",
    sleepSeconds: 1.5,
  })

  await openRerunFormFromResult(page)

  await expectScenarioSelected(page, "Constant Load")
  await expect(page.locator("label").filter({ hasText: /^Virtual Users$/ })).toBeVisible()
  await expect(page.locator("label").filter({ hasText: /^Rate \(iterations\)$/ })).toHaveCount(0)
  await expectInputValueByLabel(page, "Virtual Users", 18)
  await expectInputValueByLabel(page, "Duration", "45s")
  await expectInputValueByLabel(page, /Think-Time/i, 1.5)
})

test("rerun preserves manual overrides for generated builder env keys", async ({ page }) => {
  await startConstantVusRun(page, `playwright_rerun_env_override_${Date.now()}`, {
    vus: 6,
    duration: "20s",
    sleepSeconds: 0.2,
    envOverrides: {
      K6_WEB_DASHBOARD: "true",
    },
  })

  await openRerunFormFromResult(page)

  await expect(page.getByText("overrides generated key")).toBeVisible()
  await expect(page.locator("input[placeholder='KEY'][value='K6_WEB_DASHBOARD']")).toBeVisible()
  await expect(page.locator("input[placeholder='value'][value='true']")).toBeVisible()

  let capturedRunBody = null
  await page.route("**/api/backend/api/metrics/live", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ test_id: "", status: "idle", phase: "idle", message: "no test is currently running" }),
    })
  })
  await page.route("**/api/backend/api/run*", async (route) => {
    capturedRunBody = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ test_id: "rerun-env-override", controllable: false }),
    })
  })

  await page.locator("#project-name-input").fill(`playwright_rerun_env_submit_${Date.now()}`)
  await page.getByRole("button", { name: "Run Load Test", exact: true }).click()
  await expect.poll(() => capturedRunBody !== null).toBe(true)

  const parsedConfig = JSON.parse(capturedRunBody?.config_content || "{}")
  expect(parsedConfig?.env?.K6_WEB_DASHBOARD).toBe("true")
})
