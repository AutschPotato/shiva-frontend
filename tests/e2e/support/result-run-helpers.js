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

async function waitForResultPage(page, timeoutMs = 180000) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    await page.waitForLoadState("domcontentloaded")
    const bodyText = await page.locator("body").innerText()

    const finished =
      /Executive Summary/i.test(bodyText) ||
      /Authentication aborted the test run/i.test(bodyText)

    if (finished && !/Running Load Test/i.test(bodyText)) {
      return
    }

    await page.waitForTimeout(2000)
    await page.reload()
  }

  throw new Error("Timed out waiting for result page")
}

async function login(page) {
  await page.goto("/login")
  await page.getByRole("textbox", { name: "user@example.com" }).fill("admin")
  await page.getByRole("textbox", { name: "Enter your password" }).fill("changeme")
  await page.getByRole("button", { name: "Sign In" }).click()
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible()
}

async function openBuilderRun(page, projectName) {
  await page.getByRole("link", { name: "Run Test" }).click()
  await page.getByRole("textbox", { name: "My Load Test" }).fill(projectName)
  await page.getByRole("textbox", { name: "http://target-lb:" }).fill("http://target-lb:8090")
  await page.getByRole("checkbox", { name: "Enable" }).check()
  await page.getByRole("textbox", { name: "loadtest-client" }).fill("dummy-client")
  await page.getByRole("textbox", { name: "Enter client secret" }).fill("dummy-secret")
  await page.getByRole("button", { name: "Constant Load Fixed number of" }).click()
  await page.getByRole("spinbutton").nth(3).fill("0")
}

async function startAuthRun(page, projectName, tokenUrl) {
  await login(page)
  await openBuilderRun(page, projectName)
  await page.getByRole("textbox", { name: "http://target-lb:8090/api/" }).fill(tokenUrl)
  await page.getByRole("button", { name: "Run Load Test" }).click()
  await expect(page.getByRole("heading", { name: "Running Load Test" })).toBeVisible()
  await waitForResultPage(page)
}

async function getStatValue(page, label) {
  const stat = page.locator("div").filter({
    has: page.locator(`text="${label}"`),
  }).first()

  await expect(stat).toBeVisible()

  const text = await stat.innerText()
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const labelIndex = lines.findIndex((line) => line.toLowerCase() === label.toLowerCase())
  if (labelIndex >= 0 && lines[labelIndex + 1]) {
    return lines[labelIndex + 1]
  }

  return lines[lines.length - 1]
}

async function expectAuthAbort(page, expectedCodePattern) {
  await expect(page.getByText("Authentication")).toBeVisible()
  await expect(page.getByText("Authentication aborted the test run")).toBeVisible()

  const tokenRequests = parseLocalizedNumber(await getStatValue(page, "Token Requests"))
  const responseCodes = await getStatValue(page, "Response Codes")
  const businessRequests = parseLocalizedNumber(await getStatValue(page, "Business Requests"))
  const bodyText = await page.locator("body").innerText()

  expect(tokenRequests).toBeGreaterThan(0)
  expect(businessRequests).toBe(0)
  expect(bodyText).toMatch(/Abort Cause/i)
  expect(bodyText).toMatch(/Abort Reason/i)

  if (expectedCodePattern) {
    expect(responseCodes).toMatch(expectedCodePattern)
    expect(bodyText).toMatch(expectedCodePattern)
  }
}

module.exports = {
  
  expectAuthAbort,
  getStatValue,
  login,
  openBuilderRun,
  parseLocalizedNumber,
  startAuthRun,
  waitForResultPage,
}
