const { expect } = require("@playwright/test")

function parseLocalizedNumber(raw) {
  if (!raw) return NaN
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".")
  return Number(cleaned)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function locatorForLabeledField(page, label, tagName) {
  const exactLabel = label instanceof RegExp ? label : new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`)
  return page
    .locator("label")
    .filter({ hasText: exactLabel })
    .locator(`xpath=following-sibling::${tagName}[1]`)
}

async function fillInputByLabel(page, label, value) {
  const input = locatorForLabeledField(page, label, "input")
  await expect(input).toBeVisible()
  await input.fill(String(value))
}

async function expectInputValueByLabel(page, label, expectedValue) {
  const input = locatorForLabeledField(page, label, "input")
  await expect(input).toBeVisible()
  await expect(input).toHaveValue(String(expectedValue))
}

async function selectByLabel(page, label, value) {
  const select = locatorForLabeledField(page, label, "select")
  await expect(select).toBeVisible()
  await select.selectOption(value)
}

async function waitForResultPage(page, timeoutMs = 180000) {
  await page.waitForURL(/\/result\/[0-9a-f-]+$/i, { timeout: timeoutMs })
  await page.waitForLoadState("domcontentloaded")
  await Promise.any([
    page.getByText("Executive Summary").waitFor({ state: "visible", timeout: timeoutMs }),
    page.getByText("Authentication aborted the test run").waitFor({ state: "visible", timeout: timeoutMs }),
  ])
}

async function waitForRunProgress(page, timeoutMs = 15000) {
  await Promise.any([
    page.getByRole("heading", { name: /Generating Load|Collecting Final Results/i }).waitFor({ state: "visible", timeout: timeoutMs }),
    page.getByText("Executive Summary").waitFor({ state: "visible", timeout: timeoutMs }),
    page.getByText("Authentication aborted the test run").waitFor({ state: "visible", timeout: timeoutMs }),
  ])
}

async function clickRunLoadTest(page) {
  const dialogPromise = page
    .waitForEvent("dialog", { timeout: 1500 })
    .then(async (dialog) => {
      await dialog.accept()
      return true
    })
    .catch(() => false)

  await page.getByRole("button", { name: "Run Load Test" }).click()
  await dialogPromise
}

async function openCompletedResult(page, projectName, timeoutMs = 240000) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    await page.goto("/result")
    await page.waitForLoadState("domcontentloaded")

    const search = page.getByPlaceholder("Search by Run ID or Test Run Name")
    await expect(search).toBeVisible()
    await search.fill(projectName)
    await page.waitForTimeout(1000)

    const row = page.locator("tr").filter({ hasText: projectName }).first()
    if (await row.count()) {
      const rowText = await row.innerText()
      if (/completed/i.test(rowText)) {
        await row.getByRole("link", { name: "View" }).click()
        return
      }
    }

    await page.waitForTimeout(2000)
  }

  throw new Error(`Timed out waiting for completed result row for ${projectName}`)
}

async function login(page) {
  await page.goto("/login")
  await page.getByRole("textbox", { name: "user@example.com" }).fill("admin")
  await page.getByRole("textbox", { name: "Enter your password" }).fill("changeme")
  await page.getByRole("button", { name: "Sign In" }).click()
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible()
}

async function openBuilder(page, projectName, targetUrl = "http://target-lb:8090") {
  await page.getByRole("link", { name: "Run Test" }).click()
  await expect(page.getByRole("heading", { name: "Run Test" })).toBeVisible()
  await fillInputByLabel(page, "Test Run Name", projectName)
  await fillInputByLabel(page, "Target URL", targetUrl)
}

async function openBuilderRun(page, projectName) {
  await openBuilder(page, projectName)
  await page.getByRole("checkbox", { name: "Enable" }).check()
  await page.getByRole("textbox", { name: "loadtest-client" }).fill("dummy-client")
  await page.getByRole("textbox", { name: "Enter client secret" }).fill("dummy-secret")
  await page.getByRole("button", { name: "Constant Load Fixed number of" }).click()
  await fillInputByLabel(page, "Virtual Users", 10)
  await fillInputByLabel(page, "Duration", "30s")
  await fillInputByLabel(page, /Think-Time/i, 0)
}

async function startAuthRun(page, projectName, tokenUrl) {
  const runName = `${projectName}-${Date.now()}`
  await login(page)
  await openBuilderRun(page, runName)
  await page.getByRole("textbox", { name: "http://target-lb:8090/api/" }).fill(tokenUrl)
  await clickRunLoadTest(page)
  await waitForRunProgress(page)
  try {
    await waitForResultPage(page, 30000)
  } catch {
    await openCompletedResult(page, runName, 240000)
    await waitForResultPage(page, 60000)
  }
  return runName
}

async function startNativeArrivalRateRun(page, projectName, options = {}) {
  const runName = `${projectName}-${Date.now()}`
  const settings = {
    targetUrl: "http://target-lb:8090/health",
    httpMethod: "GET",
    rate: 200,
    timeUnit: "1s",
    duration: "20s",
    preAllocatedVUs: 10,
    maxVUs: 20,
    ...options,
  }

  await login(page)
  await openBuilder(page, runName, settings.targetUrl)
  const authToggle = page.getByRole("checkbox", { name: "Enable" })
  if (await authToggle.isChecked()) {
    await authToggle.uncheck()
  }
  await selectByLabel(page, "HTTP Method", settings.httpMethod)
  await page.getByRole("button", { name: /^Fixed Throughput/i }).click()
  await fillInputByLabel(page, "Rate (iterations)", settings.rate)
  await selectByLabel(page, "Time Unit", settings.timeUnit)
  await fillInputByLabel(page, "Duration", settings.duration)
  await fillInputByLabel(page, "Pre-allocated VUs", settings.preAllocatedVUs)
  await fillInputByLabel(page, "Max VUs", settings.maxVUs)
  await clickRunLoadTest(page)
  await waitForRunProgress(page)
  await openCompletedResult(page, runName, 240000)
  await waitForResultPage(page, 60000)
  return runName
}

async function startConstantVusRun(page, projectName, options = {}) {
  const runName = `${projectName}-${Date.now()}`
  const settings = {
    targetUrl: "http://target-lb:8090/health",
    httpMethod: "GET",
    vus: 18,
    duration: "45s",
    sleepSeconds: 1.5,
    ...options,
  }

  await login(page)
  await openBuilder(page, runName, settings.targetUrl)
  const authToggle = page.getByRole("checkbox", { name: "Enable" })
  if (await authToggle.isChecked()) {
    await authToggle.uncheck()
  }
  await selectByLabel(page, "HTTP Method", settings.httpMethod)
  await page.getByRole("button", { name: /^Constant Load/i }).click()
  await fillInputByLabel(page, "Virtual Users", settings.vus)
  await fillInputByLabel(page, "Duration", settings.duration)
  await fillInputByLabel(page, /Think-Time/i, settings.sleepSeconds)
  await clickRunLoadTest(page)
  await waitForRunProgress(page)
  await openCompletedResult(page, runName, 240000)
  await waitForResultPage(page, 60000)
  return runName
}

async function startBusinessFailureRun(page, projectName, options = {}) {
  return startConstantVusRun(page, projectName, {
    targetUrl: "http://target-lb:8090/test/http/404",
    httpMethod: "GET",
    vus: 4,
    duration: "20s",
    sleepSeconds: 0,
    ...options,
  })
}

async function openRerunFormFromResult(page) {
  await page.getByRole("button", { name: "Re-Run Test" }).click()
  await page.waitForURL(/\/load-test\?clone=true$/i, { timeout: 30000 })
  await expect(page.getByRole("heading", { name: "Run Test" })).toBeVisible()
}

async function expectScenarioSelected(page, label) {
  await expect(page.getByRole("button", { name: label })).toHaveClass(/border-accent-primary/)
}

async function getStatValue(page, label) {
  const stat = page.locator("div.bg-app-surface").filter({
    has: page.getByText(label, { exact: true }).first(),
  }).first()

  await expect(stat).toBeVisible()
  const value = stat.locator(":scope > div").nth(1)
  await expect(value).toBeVisible()
  return (await value.innerText()).trim()
}

async function waitForAuthAbortArtifacts(page, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const abortBannerVisible = await page
      .getByText(/^Authentication aborted the test run\.?$/)
      .first()
      .isVisible()
      .catch(() => false)

    const tokenRequests = parseLocalizedNumber(await getStatValue(page, "Token Requests"))
    const responseCodes = await getStatValue(page, "Response Codes")
    const hasTokenData = Number.isFinite(tokenRequests) && tokenRequests > 0
    const hasResponseCodes = !/^(-|—|N\/A)$/i.test(responseCodes)

    if (abortBannerVisible && hasTokenData && hasResponseCodes) {
      return
    }

    const bodyText = await page.locator("body").innerText()
    if (!/worker_artifacts:\s*partial/i.test(bodyText)) {
      return
    }

    await page.waitForTimeout(3000)
    await page.reload({ waitUntil: "domcontentloaded" })
  }
}

async function expectAuthAbort(page, expectedCodePattern) {
  await expect(page.getByText("Authentication", { exact: true }).first()).toBeVisible()
  await waitForAuthAbortArtifacts(page)
  await expect(page.getByText(/^Authentication aborted the test run\.?$/).first()).toBeVisible()

  const tokenRequests = parseLocalizedNumber(await getStatValue(page, "Token Requests"))
  const responseCodes = await getStatValue(page, "Response Codes")
  const businessRequests = parseLocalizedNumber(await getStatValue(page, "Business Requests"))
  const bodyText = await page.locator("body").innerText()

  expect(tokenRequests).toBeGreaterThan(0)
  expect(businessRequests).toBe(0)
  expect(bodyText).toMatch(/Cause:/i)
  expect(bodyText).toMatch(/HTTP Status Codes:/i)
  expect(bodyText).toMatch(/Retryable:/i)

  if (expectedCodePattern) {
    expect(responseCodes).toMatch(expectedCodePattern)
    expect(bodyText).toMatch(expectedCodePattern)
  }
}

module.exports = {
  expectAuthAbort,
  expectInputValueByLabel,
  expectScenarioSelected,
  getStatValue,
  login,
  openRerunFormFromResult,
  openBuilderRun,
  parseLocalizedNumber,
  startAuthRun,
  startBusinessFailureRun,
  startConstantVusRun,
  startNativeArrivalRateRun,
  waitForResultPage,
}








