import fs from "node:fs/promises"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

import { chromium } from "@playwright/test"

const require = createRequire(import.meta.url)
const { startNativeArrivalRateRun, waitForResultPage } = require("../tests/e2e/support/result-run-helpers.js")

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..")
const screenshotRoot = path.join(repoRoot, "docs", "screenshots", "webui")
const baseURL = process.env.SHIVA_FRONTEND_BASE_URL || "http://localhost:3001"

function timestampLabel() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)
}

async function ensureCleanOutput() {
  await fs.rm(screenshotRoot, { recursive: true, force: true })
  await fs.mkdir(path.join(screenshotRoot, "public"), { recursive: true })
  await fs.mkdir(path.join(screenshotRoot, "workspace"), { recursive: true })
}

async function waitForText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 30000 })
}

async function capture(page, relativePath) {
  const targetPath = path.join(screenshotRoot, relativePath)
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(700)
  await page.screenshot({ path: targetPath, animations: "disabled" })
  console.log(`saved ${path.relative(repoRoot, targetPath)}`)
}

async function gotoAndCapture(page, url, waitText, relativePath) {
  await page.goto(url, { waitUntil: "domcontentloaded" })
  if (waitText) {
    await waitForText(page, waitText)
  }
  await capture(page, relativePath)
}

async function readSessionToken(page) {
  const session = await page.evaluate(() => {
    const raw = window.localStorage.getItem("ent-session")
    return raw ? JSON.parse(raw) : null
  })

  if (!session?.token) {
    throw new Error("No session token available after login")
  }

  return session.token
}

async function apiRequest(page, method, endpoint, payload) {
  const token = await readSessionToken(page)
  const response = await page.context().request.fetch(`${baseURL}/api/backend${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: payload ? JSON.stringify(payload) : undefined,
  })

  if (!response.ok()) {
    throw new Error(`${method} ${endpoint} failed with ${response.status()}: ${await response.text()}`)
  }

  return response.json()
}

async function createDocumentationTemplate(page, suffix) {
  return apiRequest(page, "POST", "/api/templates", {
    name: `README Demo Template ${suffix}`,
    description: "Reusable builder preset for the README screenshot tour.",
    mode: "builder",
    url: "http://target-lb:8090/health",
    http_method: "GET",
    stages: [
      { duration: "30s", target: 25 },
      { duration: "30s", target: 40 },
    ],
  })
}

async function createDocumentationSchedule(page, suffix) {
  const scheduledAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
  const recurrenceEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  const payload = {
    name: `README Demo Schedule ${suffix}`,
    project_name: `README Demo Series ${suffix}`,
    url: "http://target-lb:8090/health",
    mode: "builder",
    executor: "ramping-vus",
    stages: [
      { duration: "30s", target: 20 },
      { duration: "30s", target: 35 },
    ],
    http_method: "GET",
    scheduled_at: scheduledAt.toISOString(),
    estimated_duration_s: 900,
    timezone: "Europe/Berlin",
    recurrence_type: "daily",
    recurrence_end: recurrenceEnd.toISOString(),
  }

  return apiRequest(page, "POST", "/api/schedules", payload)
}

async function prepareWorkerDashboardMocks(page) {
  await page.route("**/api/backend/api/admin/workers/dashboards*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        active_test: "docs-demo-run",
        phase: "running",
        dashboards: [
          {
            name: "worker1",
            address: "worker1:6565",
            worker_status: "running",
            dashboard_enabled: true,
            availability: "available",
            message: "Serving a live dashboard for the active documentation run.",
            active_test_id: "docs-demo-run",
          },
          {
            name: "worker2",
            address: "worker2:6565",
            worker_status: "running",
            dashboard_enabled: true,
            availability: "available",
            message: "Ready to inspect.",
            active_test_id: "docs-demo-run",
          },
          {
            name: "worker3",
            address: "worker3:6565",
            worker_status: "idle",
            dashboard_enabled: true,
            availability: "not_running",
            message: "No live dashboard because this worker is idle.",
            active_test_id: "",
          },
        ],
      }),
    })
  })

  await page.route("**/api/backend/api/admin/workers/worker1/dashboard/ui/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>worker1 dashboard</title>
    <style>
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, sans-serif;
        background: linear-gradient(180deg, #f7f4ee 0%, #efe6d6 100%);
        color: #312014;
      }
      .shell {
        padding: 24px 28px;
      }
      .hero {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: 16px;
      }
      .card {
        background: rgba(255,255,255,0.72);
        border: 1px solid rgba(49,32,20,0.12);
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 12px 32px rgba(49,32,20,0.08);
      }
      .kpis {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-top: 16px;
      }
      .metric {
        font-size: 13px;
        color: #6e5542;
      }
      .metric strong {
        display: block;
        margin-top: 6px;
        font-size: 24px;
        color: #312014;
      }
      .bars {
        display: grid;
        gap: 10px;
        margin-top: 10px;
      }
      .bar {
        height: 12px;
        border-radius: 999px;
        background: linear-gradient(90deg, #cc2b5e, #f1736f);
      }
      .chart {
        margin-top: 16px;
        height: 240px;
        border-radius: 18px;
        background:
          linear-gradient(to top, rgba(49,32,20,0.08) 1px, transparent 1px) 0 0 / 100% 48px,
          linear-gradient(to right, rgba(49,32,20,0.05) 1px, transparent 1px) 0 0 / 72px 100%,
          linear-gradient(180deg, rgba(255,255,255,0.9), rgba(250,244,236,0.85));
        position: relative;
        overflow: hidden;
      }
      .line {
        position: absolute;
        inset: 0;
      }
      svg {
        width: 100%;
        height: 100%;
      }
      h1, h2, p {
        margin: 0;
      }
      .eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 11px;
        color: #9b7255;
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="hero">
        <div class="card">
          <p class="eyebrow">Live worker dashboard</p>
          <h1>worker1</h1>
          <p style="margin-top:10px;color:#6e5542;">Sample dashboard content embedded for README documentation.</p>
          <div class="chart">
            <div class="line">
              <svg viewBox="0 0 800 260" preserveAspectRatio="none">
                <polyline fill="none" stroke="#cc2b5e" stroke-width="5" points="0,190 80,180 160,150 240,158 320,120 400,128 480,92 560,100 640,72 720,80 800,54"></polyline>
                <polyline fill="none" stroke="#312014" stroke-width="4" opacity="0.55" points="0,210 80,205 160,188 240,176 320,170 400,150 480,136 560,122 640,110 720,104 800,95"></polyline>
              </svg>
            </div>
          </div>
        </div>
        <div class="card">
          <p class="eyebrow">Current load</p>
          <div class="kpis">
            <div class="metric">RPS<strong>584</strong></div>
            <div class="metric">VUs<strong>40</strong></div>
            <div class="metric">P95<strong>148 ms</strong></div>
            <div class="metric">Errors<strong>0.3%</strong></div>
          </div>
          <div class="bars">
            <div class="bar" style="width: 82%;"></div>
            <div class="bar" style="width: 68%;"></div>
            <div class="bar" style="width: 91%;"></div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`,
    })
  })
}

async function main() {
  await ensureCleanOutput()

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1600, height: 1000 },
  })
  const page = await context.newPage()

  try {
    await gotoAndCapture(page, "/login", "Sign In", path.join("public", "login.png"))
    await gotoAndCapture(page, "/forgot-password", "Request reset link", path.join("public", "forgot-password.png"))
    await gotoAndCapture(page, "/reset-password?token=docs-demo-token", "Set new password", path.join("public", "reset-password.png"))

    const suffix = timestampLabel()
    const resultRunName = `README Demo Run ${suffix}`
    await startNativeArrivalRateRun(page, resultRunName, {
      duration: "12s",
      rate: 120,
      preAllocatedVUs: 8,
      maxVUs: 16,
    })

    await waitForResultPage(page, 60000)
    const resultId = page.url().split("/result/")[1]?.split("?")[0]
    if (!resultId) {
      throw new Error("Could not determine result id from result detail URL")
    }

    const template = await createDocumentationTemplate(page, suffix)
    const schedule = await createDocumentationSchedule(page, suffix)

    await gotoAndCapture(page, "/", "Overview", path.join("workspace", "overview.png"))
    await gotoAndCapture(page, "/load-test", "Run Test", path.join("workspace", "run-test.png"))

    await page.goto("/schedule", { waitUntil: "domcontentloaded" })
    await waitForText(page, "Schedules")
    await page.getByPlaceholder("Search by schedule, test run, owner, timezone, or status").fill(schedule.name)
    await page.waitForTimeout(800)
    await capture(page, path.join("workspace", "schedules.png"))

    await page.goto("/schedule/new", { waitUntil: "domcontentloaded" })
    await waitForText(page, "Schedule Details")
    const loadTemplateButton = page.getByRole("button", { name: /Load Template/i })
    if (await loadTemplateButton.count()) {
      await loadTemplateButton.click()
      await page.getByText(template.name, { exact: false }).waitFor({ state: "visible", timeout: 15000 }).catch(() => {})
    }
    await capture(page, path.join("workspace", "schedule-create.png"))

    await gotoAndCapture(
      page,
      `/schedule/${schedule.id}?occurrence=${encodeURIComponent(schedule.scheduled_at)}`,
      "Schedule Details",
      path.join("workspace", "schedule-detail.png"),
    )

    await page.goto("/templates", { waitUntil: "domcontentloaded" })
    await waitForText(page, "Templates")
    await page.getByText(template.name, { exact: false }).waitFor({ state: "visible", timeout: 15000 }).catch(() => {})
    await capture(page, path.join("workspace", "templates.png"))

    await page.goto("/result", { waitUntil: "domcontentloaded" })
    await waitForText(page, "Results")
    await page.getByPlaceholder("Search by Run ID or Test Run Name").fill(resultRunName)
    await page.waitForTimeout(1000)
    await capture(page, path.join("workspace", "results.png"))

    await gotoAndCapture(page, `/result/${resultId}`, "Executive Summary", path.join("workspace", "result-detail.png"))

    await prepareWorkerDashboardMocks(page)
    await gotoAndCapture(page, "/worker-dashboards", "Worker Dashboards", path.join("workspace", "worker-dashboards.png"))
    await gotoAndCapture(page, "/worker-dashboards/worker1", "worker1", path.join("workspace", "worker-dashboard-detail.png"))

    await gotoAndCapture(page, "/users", "Users", path.join("workspace", "users.png"))
    await gotoAndCapture(page, "/profile", "Profile", path.join("workspace", "profile.png"))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
