const { test, expect } = require("@playwright/test")

test("result detail warns when worker summary artifacts are incomplete", async ({ page }) => {
  const resultID = "partial-worker-artifacts"
  await page.addInitScript(() => {
    window.localStorage.setItem("ent-session", JSON.stringify({
      token: "playwright-token",
      user: {
        id: "1",
        username: "admin",
        email: "admin@example.com",
        role: "admin",
      },
    }))
  })

  await page.route(`**/api/backend/api/result/${resultID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: resultID,
        project_name: "partial_worker_artifacts",
        url: "http://target-lb:8090/health",
        status: "completed",
        username: "admin",
        created_at: "2026-03-21T10:00:00Z",
        metadata: {
          started_at: "2026-03-21T10:00:00Z",
          ended_at: "2026-03-21T10:01:00Z",
          duration_s: 60,
          worker_count: 3,
          artifact_collection: {
            status: "partial",
            expected_worker_count: 3,
            received_worker_summary_count: 2,
            missing_workers: ["worker3"],
          },
        },
        metrics_v2: {
          http_total: {
            requests: 120,
            rps: 2,
            successes: 120,
            failures: 0,
            success_rate: 1,
            error_rate: 0,
          },
          http_business: {
            requests: 120,
            rps: 2,
            successes: 120,
            failures: 0,
            success_rate: 1,
            error_rate: 0,
            status_2xx: 120,
          },
          http_auxiliary: {
            requests: 0,
            successes: 0,
            failures: 0,
            success_rate: 0,
            error_rate: 0,
          },
          iterations: {
            count: 120,
            rate: 2,
          },
          checks: {
            passes: 120,
            fails: 0,
            pass_rate: 1,
            fail_rate: 0,
          },
          latency_primary: {
            metric: "http_req_duration",
            scope: "http_total",
            avg_ms: 25,
            med_ms: 24,
            p90_ms: 30,
            p95_ms: 32,
            p99_ms: 35,
            min_ms: 20,
            max_ms: 40,
          },
          workers: [
            {
              address: "worker1:6565",
              status: "ok",
              requests: 60,
              business_requests: 60,
              auxiliary_requests: 0,
              avg_latency_ms: 24,
              p95_latency_ms: 31,
              p99_latency_ms: 34,
              error_rate: 0,
              active_duration_s: 60,
            },
            {
              address: "worker2:6565",
              status: "ok",
              requests: 60,
              business_requests: 60,
              auxiliary_requests: 0,
              avg_latency_ms: 26,
              p95_latency_ms: 33,
              p99_latency_ms: 36,
              error_rate: 0,
              active_duration_s: 60,
            },
          ],
          quality_flags: [
            {
              key: "workers",
              status: "approximate",
              source: "summary_worker_metrics",
              scope: "per_worker",
              approximation_reason: "Per-worker latency percentiles are taken from worker summaries; global worker timing windows remain controller-based.",
            },
            {
              key: "worker_artifacts",
              status: "partial",
              source: "summary_artifact_collection",
              scope: "per_worker",
              approximation_reason: "Received 2 of 3 expected worker summaries. Missing workers: worker3.",
            },
          ],
        },
        time_series: [],
      }),
    })
  })

  await page.goto(`/result/${resultID}`)

  await expect(page.getByText("Worker summary artifacts are incomplete for this result.")).toBeVisible()
  await expect(page.getByText("Received 2 of 3 expected worker summaries.", { exact: true })).toBeVisible()
  await expect(page.getByText("Missing workers: worker3", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Worker Breakdown" })).toBeVisible()
})
