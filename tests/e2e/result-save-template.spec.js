const { test, expect } = require("@playwright/test")
const { startConstantVusRun } = require("./support/result-run-helpers")

test.setTimeout(300000)

test("result detail saves builder run as builder template", async ({ page }) => {
  const runName = await startConstantVusRun(page, `playwright_result_template_${Date.now()}`, {
    duration: "20s",
    vus: 6,
    sleepSeconds: 0.2,
  })

  const createTemplateRequestPromise = page.waitForRequest((request) =>
    request.method() === "POST" && request.url().includes("/api/backend/api/templates"),
  )
  const createTemplateResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/api/backend/api/templates"),
  )

  await page.getByRole("button", { name: "Save as Template" }).click()

  const createTemplateRequest = await createTemplateRequestPromise
  const requestBody = createTemplateRequest.postDataJSON()
  expect(requestBody.mode).toBe("builder")
  expect(requestBody.url).toContain("target-lb:8090")
  expect(requestBody.script_content).toBeUndefined()

  const createTemplateResponse = await createTemplateResponsePromise
  expect(createTemplateResponse.status()).toBe(201)
  await expect(page.getByText("Template saved successfully")).toBeVisible()

  await page.getByRole("link", { name: "Templates" }).click()
  await expect(page.getByRole("heading", { name: "Templates" })).toBeVisible()
  await expect(page.getByText(runName, { exact: false }).first()).toBeVisible()
})
