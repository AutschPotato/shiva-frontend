const { test, expect } = require("@playwright/test")
const { login } = require("./support/result-run-helpers")

async function openScheduleCreate(page) {
  await page.route("**/api/backend/api/templates", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ templates: [], total: 0 }),
  }))

  await login(page)
  await page.goto("/schedule/new")
  await page.getByRole("button", { name: "Builder", exact: true }).click()
  await page.getByPlaceholder(/Nightly Load Test/i).fill("Overlap guard")
  await page.getByPlaceholder(/Nightly checkout flow/i).fill("Overlap guard run")
  await page.getByPlaceholder(/https:\/\/api\.example\.com\/orders/i).fill("https://api.example.com/orders")
  await page.locator('input[type="datetime-local"]').first().fill("2026-03-20T10:00")
}

test("schedule creation prevents submitting known overlaps", async ({ page }) => {
  await page.route("**/api/backend/api/schedules/check-conflict", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      conflict: true,
      conflicting_schedule: {
        schedule_id: "sched-2",
        schedule_name: "Existing overlap",
        start: "2026-03-20T09:00:00Z",
        end: "2026-03-20T09:02:30Z",
        type: "scheduled",
      },
    }),
  }))

  await openScheduleCreate(page)

  await expect(page.getByText(/Conflicts with "Existing overlap"/i)).toBeVisible()
  await expect(page.getByRole("button", { name: /Create Schedule/i })).toBeDisabled()
})

test("schedule creation surfaces backend overlap races as conflicts", async ({ page }) => {
  let createCalls = 0

  await page.route("**/api/backend/api/schedules/check-conflict", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ conflict: false }),
  }))

  await page.route("**/api/backend/api/schedules", async route => {
    if (route.request().method() !== "POST") {
      await route.continue()
      return
    }
    createCalls += 1

    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "schedule conflicts with existing test",
        conflict: {
          schedule_id: "sched-3",
          schedule_name: "Race overlap",
          start: "2026-03-20T09:00:00Z",
          end: "2026-03-20T09:02:30Z",
          type: "scheduled",
        },
      }),
    })
  })

  await openScheduleCreate(page)

  await expect(page.getByText(/No conflicts/i)).toBeVisible()
  await page.getByRole("button", { name: /Create Schedule/i }).click()

  await expect.poll(() => createCalls).toBe(1)
  await expect(page.getByText(/Resolve the schedule conflict first/i)).toBeVisible()
  await expect(page.getByText(/Conflicts with "Race overlap"/i)).toBeVisible()
  await expect(page.getByRole("button", { name: /Create Schedule/i })).toBeDisabled()
})
