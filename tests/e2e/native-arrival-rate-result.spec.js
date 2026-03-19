const { test, expect } = require("@playwright/test")
const {
  getStatValue,
  parseLocalizedNumber,
  startNativeArrivalRateRun,
} = require("./support/result-run-helpers")

test.setTimeout(300000)

test("native arrival-rate run completes with full summary sections", async ({ page }) => {
  await startNativeArrivalRateRun(page, `playwright_native_arrival_${Date.now()}`, {
    rate: 200,
    timeUnit: "1s",
    duration: "20s",
    preAllocatedVUs: 10,
    maxVUs: 20,
  })

  await expect(page.getByRole("heading", { name: "Executive Summary" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "HTTP Performance" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "k6 Thresholds" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Worker Breakdown" })).toBeVisible()

  const totalHttp = parseLocalizedNumber(await getStatValue(page, "Total HTTP Requests"))
  const iterations = parseLocalizedNumber(await getStatValue(page, "Iterations"))

  expect(totalHttp).toBeGreaterThan(0)
  expect(iterations).toBeGreaterThan(0)

  const bodyText = await page.locator("body").innerText()
  expect(bodyText).toMatch(/Run ID:\s+[0-9a-f-]{36}/i)
  expect(bodyText).not.toMatch(/Authentication aborted the test run/i)
})




