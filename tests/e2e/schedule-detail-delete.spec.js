const { test, expect } = require("@playwright/test")

const session = {
  user: {
    id: "1",
    username: "admin",
    email: "admin@example.com",
    role: "admin",
  },
  token: "test-token",
}

async function seedSession(page) {
  await page.addInitScript((persistedSession) => {
    window.localStorage.setItem("ent-session", JSON.stringify(persistedSession))
  }, session)
}

test("recurring schedule detail offers occurrence and future-series delete options", async ({ page }) => {
  await seedSession(page)

  const occurrenceIso = "2099-03-24T09:00:00Z"
  const recurrenceEndIso = "2099-03-30T09:00:00Z"

  let deleteRequestUrl = ""

  await page.route("**/api/backend/api/schedules/calendar*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: [] }),
    })
  })

  await page.route("**/api/backend/api/schedules", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ schedules: [] }),
    })
  })

  await page.route("**/api/backend/api/schedules/sched-recurring/executions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        executions: [
          {
            id: "exec-1",
            schedule_id: "sched-recurring",
            load_test_id: "result-1",
            status: "completed",
            scheduled_at: "2099-03-22T09:00:00Z",
            started_at: "2099-03-22T09:00:00Z",
            ended_at: "2099-03-22T09:05:00Z",
            created_at: "2099-03-22T09:05:00Z",
          },
        ],
      }),
    })
  })

  await page.route("**/api/backend/api/schedules/sched-recurring*", async (route) => {
    if (route.request().method() === "DELETE") {
      deleteRequestUrl = route.request().url()
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "updated", scope: "future" }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "sched-recurring",
        name: "Recurring Cleanup",
        project_name: "Nightly Cleanup",
        url: "http://target",
        mode: "builder",
        executor: "ramping-vus",
        scheduled_at: occurrenceIso,
        estimated_duration_s: 1800,
        timezone: "UTC",
        recurrence_type: "daily",
        recurrence_end: recurrenceEndIso,
        status: "scheduled",
        paused: false,
        user_id: 1,
        username: "admin",
        created_at: "2099-03-20T09:00:00Z",
        updated_at: "2099-03-20T09:00:00Z",
      }),
    })
  })

  await page.goto(`/schedule/sched-recurring?occurrence=${occurrenceIso}`)

  await expect(page.getByText("Selected Occurrence")).toBeVisible()

  await page.getByRole("button", { name: /^Delete$/i }).click()

  await expect(page.getByRole("button", { name: "Delete This Occurrence" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Delete Future Series" })).toBeVisible()

  await page.getByRole("button", { name: "Delete Future Series" }).click()
  await page.waitForURL(/\/schedule$/)

  expect(deleteRequestUrl).toContain("scope=future")
  expect(deleteRequestUrl).toContain(`occurrence=${encodeURIComponent(occurrenceIso)}`)
})
