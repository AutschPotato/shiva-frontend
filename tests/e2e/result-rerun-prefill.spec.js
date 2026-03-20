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
