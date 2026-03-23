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

function buildOverlappingScheduleTimes() {
  const now = new Date()
  const startA = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 15, 0, 0)
  const endA = new Date(startA.getTime() + 10 * 60 * 1000)
  const startB = new Date(startA.getTime() + 5 * 60 * 1000)
  const endB = new Date(startB.getTime() + 10 * 60 * 1000)

  return {
    scheduledAtA: startA.toISOString(),
    scheduledAtB: startB.toISOString(),
    startA: startA.toISOString(),
    endA: endA.toISOString(),
    startB: startB.toISOString(),
    endB: endB.toISOString(),
  }
}

test("schedule view exposes heading, search, and view toggle", async ({ page }) => {
  await seedSession(page)

  await page.route("**/api/backend/api/schedules", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schedules: [],
      }),
    })
  })

  await page.route("**/api/backend/api/schedules/calendar*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        events: [],
      }),
    })
  })

  await page.goto("/schedule")

  await expect(page.getByRole("heading", { name: "Schedules" })).toBeVisible()
  await expect(page.getByPlaceholder("Search by schedule, test run, owner, timezone, or status")).toBeVisible()
  await expect(page.getByRole("button", { name: /Timeline/i })).toBeVisible()
  await expect(page.getByRole("button", { name: /List/i })).toBeVisible()
  await expect(page.getByRole("link", { name: /New Schedule/i })).toBeVisible()
})

test("timeline places overlapping schedule entries in separate lanes", async ({ page }) => {
  await seedSession(page)
  const overlap = buildOverlappingScheduleTimes()

  await page.route("**/api/backend/api/schedules", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schedules: [
          {
            id: "sched-a",
            name: "Overlap A",
            project_name: "Series A",
            url: "http://target",
            mode: "builder",
            executor: "ramping-vus",
            scheduled_at: overlap.scheduledAtA,
            estimated_duration_s: 300,
            timezone: "UTC",
            recurrence_type: "once",
            status: "scheduled",
            paused: false,
            user_id: 1,
            username: "admin",
            created_at: "2026-03-15T12:00:00Z",
            updated_at: "2026-03-15T12:00:00Z",
          },
          {
            id: "sched-b",
            name: "Overlap B",
            project_name: "Series B",
            url: "http://target",
            mode: "builder",
            executor: "ramping-vus",
            scheduled_at: overlap.scheduledAtB,
            estimated_duration_s: 300,
            timezone: "UTC",
            recurrence_type: "once",
            status: "scheduled",
            paused: false,
            user_id: 1,
            username: "admin",
            created_at: "2026-03-15T12:00:00Z",
            updated_at: "2026-03-15T12:00:00Z",
          },
        ],
      }),
    })
  })

  await page.route("**/api/backend/api/schedules/calendar*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        events: [
          {
            id: "sched-a",
            name: "Overlap A",
            project_name: "Series A",
            start: overlap.startA,
            end: overlap.endA,
            occurrence_start: overlap.startA,
            status: "scheduled",
            recurrence_type: "once",
            username: "admin",
            user_id: 1,
          },
          {
            id: "sched-b",
            name: "Overlap B",
            project_name: "Series B",
            start: overlap.startB,
            end: overlap.endB,
            occurrence_start: overlap.startB,
            status: "scheduled",
            recurrence_type: "once",
            username: "admin",
            user_id: 1,
          },
        ],
      }),
    })
  })

  await page.goto("/schedule")

  const first = page.getByRole("link", { name: /Overlap A/i })
  const second = page.getByRole("link", { name: /Overlap B/i })

  await expect(first).toBeVisible()
  await expect(second).toBeVisible()

  const firstLeft = await first.evaluate((node) => node.style.left)
  const secondLeft = await second.evaluate((node) => node.style.left)
  const firstWidth = await first.evaluate((node) => node.style.width)
  const secondWidth = await second.evaluate((node) => node.style.width)

  expect(firstLeft).not.toBe(secondLeft)
  expect(firstWidth).toBe(secondWidth)
})
