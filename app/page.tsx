"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { getResultsList, getWorkersStatus, getLiveMetrics, getHealth } from "@/lib/api"
import { motion } from "framer-motion"
import { staggerContainer, revealItem } from "@/lib/motion-variants"
import { useChartColors } from "@/lib/chart-theme"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts"
import Link from "next/link"
import { useSession } from "@/context/SessionContext"

interface ResultItem {
  id: string
  project_name: string
  url: string
  status: string
  created_at: string
  error_rate?: number | null
  total_requests?: number | null
  avg_latency_ms?: number | null
  p95_latency_ms?: number | null
  duration_s?: number | null
  total_vus?: number | null
  run_by?: {
    id?: string
    username?: string
  }
}

interface WorkerInfo {
  address: string
  status: string
  vus?: number
}

interface LiveMetricsData {
  test_id: string
  status: string
  phase: string
  message?: string
  metrics?: {
    total_vus: number
    rps: number
    avg_latency_ms: number
    p95_latency_ms: number
    error_rate: number
    total_requests: number
    elapsed_seconds: number
    status_4xx?: number
    status_5xx?: number
  }
}

function fmtNum(n: number | undefined | null): string {
  if (n == null) return "—"
  return Math.round(n).toLocaleString("de-DE")
}

function fmtLatency(ms: number | undefined | null): string {
  if (ms == null) return "—"
  return `${Math.round(ms)} ms`
}

function fmtDuration(s: number | undefined | null): string {
  if (s == null) return "—"
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const rest = Math.round(s % 60)
  return rest > 0 ? `${m}m ${rest}s` : `${m}m`
}

function formatLivePhaseLabel(phase?: string): string {
  switch ((phase || "").toLowerCase()) {
    case "script":
      return "Preparing script"
    case "workers":
      return "Preparing workers"
    case "running":
      return "Generating load"
    case "collecting":
      return "Collecting final results"
    case "done":
      return "Completed"
    case "error":
      return "Failed"
    default:
      return phase || "Unknown"
  }
}

function describeLivePhase(phase?: string, message?: string): string {
  const normalized = (phase || "").toLowerCase()
  if (normalized === "collecting") {
    return "Load generation has finished. The controller is waiting for worker summaries and final metrics."
  }
  if (message) return message
  return ""
}

const statusDot: Record<string, string> = {
  online: "bg-green-500",
  running: "bg-blue-500",
  paused: "bg-yellow-500",
  done: "bg-green-400",
  unreachable: "bg-red-500",
}

const statusLabel: Record<string, string> = {
  online: "idle",
  running: "running",
  paused: "paused",
  done: "done",
  unreachable: "unreachable",
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, token, initialized: ready } = useSession()
  const [results, setResults] = useState<ResultItem[]>([])
  const [workers, setWorkers] = useState<WorkerInfo[]>([])
  const [activeTestId, setActiveTestId] = useState<string | null>(null)
  const [liveMetrics, setLiveMetrics] = useState<LiveMetricsData | null>(null)
  const [healthOk, setHealthOk] = useState<boolean | null>(null)
  const chart = useChartColors()

  useEffect(() => {
    if (!token) return

    let cancelled = false
    let prevStatus: string | null = null

    const poll = async () => {
      const [workersRes, healthRes, metricsRes, resultsRes] = await Promise.allSettled([
        getWorkersStatus(token),
        getHealth(),
        getLiveMetrics(token),
        getResultsList({ limit: 15, offset: 0 }, token),
      ])

      if (cancelled) return

      if (workersRes.status === "fulfilled") {
        const res = workersRes.value
        if (Array.isArray(res)) {
          setWorkers(res)
        } else if (res?.workers) {
          setWorkers(res.workers)
          setActiveTestId(res.active_test || null)
        }
      }

      if (healthRes.status === "fulfilled") {
        setHealthOk(healthRes.value?.status === "ok")
      } else {
        setHealthOk(false)
      }

      if (metricsRes.status === "fulfilled") {
        const data = metricsRes.value as LiveMetricsData
        setLiveMetrics(data)
        const newStatus = data.status || null

        if (data.status === "completed") {
          setActiveTestId(null)
          if (prevStatus === "running") {
            setTimeout(async () => {
              if (cancelled) return
              try {
                const res = await getResultsList({ limit: 15, offset: 0 }, token)
                setResults((res.results ?? res.items ?? []) as ResultItem[])
              } catch { /* ignore */ }
            }, 2500)
          }
        } else {
          setActiveTestId(data.test_id || null)
        }

        prevStatus = newStatus
      } else {
        setLiveMetrics(null)
        prevStatus = null
      }

      if (resultsRes.status === "fulfilled") {
        const res = resultsRes.value
        setResults((res.results ?? res.items ?? []) as ResultItem[])
      }
    }

    poll()
    const interval = setInterval(poll, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [token])

  useEffect(() => {
    if (ready && !user) {
      router.replace("/login")
    }
  }, [ready, user, router])

  const trendData = useMemo(() => {
    return results
      .filter((r) => r.p95_latency_ms != null || r.error_rate != null)
      .slice(0, 10)
      .reverse()
      .map((r) => ({
        name: r.project_name.length > 12 ? r.project_name.slice(0, 12) + "…" : r.project_name,
        p95: r.p95_latency_ms ?? 0,
        error_pct: r.error_rate != null ? +(r.error_rate * 100).toFixed(1) : 0,
      }))
  }, [results])

  const workersOnline = workers.filter((w) => w.status !== "unreachable").length
  const workersRunning = workers.filter((w) => w.status === "running").length
  const isTestRunning = liveMetrics?.status === "running" ||
    (activeTestId != null && liveMetrics?.status !== "completed")

  if (!ready || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-text-muted">Loading...</div>
      </div>
    )
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="enter"
      className="space-y-8 pb-10"
    >
      <motion.div variants={revealItem}>
        <h1 className="text-2xl font-bold text-text-primary section-heading">Overview</h1>
        <p className="text-text-muted text-sm mt-1">System status, recent tests, and worker health</p>
      </motion.div>

      {/* ── 1. SYSTEM STATUS ── */}
      <motion.div variants={revealItem} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          title="Controller"
          value={healthOk === true ? "Online" : healthOk === false ? "Offline" : "…"}
          accent={healthOk === true ? "green" : healthOk === false ? "red" : "gray"}
        />
        <KpiCard
          title="Workers"
          value={`${workersOnline} / ${workers.length}`}
          subtitle={workersRunning > 0 ? `${workersRunning} running` : "idle"}
          accent={workersOnline === workers.length && workers.length > 0 ? "green" : "yellow"}
        />
        <KpiCard
          title="Active Test"
          value={activeTestId ? activeTestId.slice(0, 8) + "…" : "None"}
          accent={activeTestId ? "blue" : "gray"}
        />
      </motion.div>

      {/* Worker Detail */}
      {workers.length > 0 && (
        <motion.div
          variants={revealItem}
          className="border border-app-border shadow-card p-4 rounded-xl"
          style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)", borderTop: "1px solid var(--color-card-border-top)" }}
        >
          <h2 className="section-heading text-sm font-semibold text-accent-primary mb-3 uppercase tracking-wider">
            Worker Nodes
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {workers.map((w) => (
              <div
                key={w.address}
                className="flex items-center gap-3 p-3 border border-app-border rounded-lg"
              >
                <span className={`w-2.5 h-2.5 rounded-full ${statusDot[w.status] || "bg-gray-400"}`} />
                <div>
                  <div className="font-mono text-xs">{w.address}</div>
                  <div className="text-xs text-text-muted capitalize">
                    {statusLabel[w.status] || w.status}
                    {w.vus != null && w.vus > 0 ? ` · ${w.vus} VUs` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── 2. LIVE TEST / SPECTATOR ── */}
      {isTestRunning && (
        <motion.div
          variants={revealItem}
          className="surface-panel surface-panel--info shadow-card p-4 sm:p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
            <h2 className="text-lg font-semibold">
              Live Test — {(liveMetrics?.test_id || activeTestId || "").slice(0, 8)}…
            </h2>
            {liveMetrics?.phase && (
              <span className="status-badge status-badge--info ml-auto px-2 py-1 text-xs font-medium">
                {formatLivePhaseLabel(liveMetrics.phase)}
              </span>
            )}
          </div>

          {liveMetrics?.metrics ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <MetricBox label="VUs" value={fmtNum(liveMetrics.metrics.total_vus)} />
                <MetricBox label="HTTP RPS" value={liveMetrics.metrics.rps?.toFixed(1) ?? "—"} />
                <MetricBox label="HTTP Requests" value={fmtNum(liveMetrics.metrics.total_requests)} />
                <MetricBox label="HTTP Avg Latency" value={fmtLatency(liveMetrics.metrics.avg_latency_ms)} />
                <MetricBox label="HTTP P95 Latency" value={fmtLatency(liveMetrics.metrics.p95_latency_ms)} />
                <MetricBox
                  label="Error Rate"
                  value={`${((liveMetrics.metrics.error_rate ?? 0) * 100).toFixed(1)}%`}
                  warn={liveMetrics.metrics.error_rate > 0.05}
                />
              </div>

              {((liveMetrics.metrics.status_4xx ?? 0) > 0 || (liveMetrics.metrics.status_5xx ?? 0) > 0) && (
                <div className="mt-3 flex gap-4 text-xs">
                  {(liveMetrics.metrics.status_4xx ?? 0) > 0 && (
                    <span className="status-badge status-badge--warning px-2 py-1 text-xs font-medium">
                      4xx: {fmtNum(liveMetrics.metrics.status_4xx)}
                    </span>
                  )}
                  {(liveMetrics.metrics.status_5xx ?? 0) > 0 && (
                    <span className="status-badge status-badge--danger px-2 py-1 text-xs font-medium">
                      5xx: {fmtNum(liveMetrics.metrics.status_5xx)}
                    </span>
                  )}
                </div>
              )}

              {liveMetrics.metrics.elapsed_seconds != null && (
                <div className="mt-3 text-xs">
                  Elapsed: {fmtDuration(liveMetrics.metrics.elapsed_seconds)}
                  {describeLivePhase(liveMetrics.phase, liveMetrics.message) && ` · ${describeLivePhase(liveMetrics.phase, liveMetrics.message)}`}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm py-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
              Waiting for metrics…
            </div>
          )}
        </motion.div>
      )}

      {/* ── 3. TREND CHART (P95 + Error Rate) ── */}
      {trendData.length >= 2 && (
        <motion.div
          variants={revealItem}
          className="border border-app-border shadow-card p-4 sm:p-6 rounded-xl"
          style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)", borderTop: "1px solid var(--color-card-border-top)" }}
        >
          <h2 className="section-heading text-lg font-semibold mb-4 text-accent-primary">
            P95 Latency & Error Rate Trend
          </h2>

          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
              <XAxis dataKey="name" stroke={chart.axis} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" stroke="#E20074" tick={{ fontSize: 11 }} label={{ value: "P95 (ms)", angle: -90, position: "insideLeft", style: { fontSize: 11 } }} />
              <YAxis yAxisId="right" orientation="right" stroke="#DC2626" tick={{ fontSize: 11 }} domain={[0, "auto"]} label={{ value: "Error %", angle: 90, position: "insideRight", style: { fontSize: 11 } }} />
              <Tooltip
                contentStyle={{
                  background: chart.tooltipBg,
                  border: `1px solid ${chart.tooltipBorder}`,
                  color: chart.tooltipText,
                  borderRadius: "8px",
                }}
              />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="p95"
                name="P95 Latency (ms)"
                stroke="#E20074"
                strokeWidth={2}
                dot={{ r: 3 }}
                animationDuration={1000}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="error_pct"
                name="Error Rate (%)"
                stroke="#DC2626"
                strokeWidth={2}
                dot={{ r: 3 }}
                animationDuration={1000}
              />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>
      )}

      {/* ── 4. RECENT TESTS ── */}
      <motion.div
        variants={revealItem}
        className="border border-app-border shadow-card rounded-xl overflow-hidden"
        style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)", borderTop: "1px solid var(--color-card-border-top)" }}
      >
        <div className="px-4 sm:px-6 py-4 border-b border-app-border">
          <h2 className="section-heading text-lg font-semibold text-accent-primary">Recent Tests</h2>
        </div>

        {results.length === 0 ? (
          <div className="p-6 text-text-muted text-sm">No tests yet.</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead className="bg-app-surface text-left text-text-muted uppercase text-xs tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Test Run</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">HTTP Requests</th>
                    <th className="px-4 py-3 text-right">P95</th>
                    <th className="px-4 py-3 text-right">Error Rate</th>
                    <th className="px-4 py-3">Run By</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-app-border">
                  {results.slice(0, 8).map((r) => {
                    const statusClass =
                      r.status === "completed"
                        ? "status-badge status-badge--success"
                        : r.status === "running"
                        ? "status-badge status-badge--info"
                        : r.status === "failed"
                        ? "status-badge status-badge--danger"
                        : "status-badge status-badge--neutral"

                    return (
                      <tr key={r.id} className="hover:bg-app-surface-alt">
                        <td className="px-4 py-3 font-semibold text-accent-primary">
                          {r.project_name}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 text-xs font-medium ${statusClass}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtNum(r.total_requests)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtLatency(r.p95_latency_ms)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {r.error_rate != null && r.error_rate > 0.05 ? (
                            <span className="status-text--danger font-semibold">
                              {(r.error_rate * 100).toFixed(1)}%
                            </span>
                          ) : r.error_rate != null ? (
                            `${(r.error_rate * 100).toFixed(1)}%`
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-text-muted">
                          {r.run_by?.username || "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-text-muted">
                          {new Date(r.created_at).toISOString().replace("T", " ").slice(0, 16)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/result/${r.id}`}
                            className="text-accent-primary hover:underline text-xs font-medium"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <div className="md:hidden divide-y divide-app-border">
              {results.slice(0, 5).map((r) => (
                <Link
                  key={r.id}
                  href={`/result/${r.id}`}
                  className="block p-4 hover:bg-app-surface-alt transition"
                >
                  <div className="flex justify-between items-start">
                    <div className="font-semibold text-accent-primary">{r.project_name}</div>
                    <span className="text-xs text-text-muted">{r.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-text-muted">
                          {fmtNum(r.total_requests)} HTTP req · P95 {fmtLatency(r.p95_latency_ms)} · {r.run_by?.username || "—"}
                  </div>
                </Link>
              ))}
            </div>

            {results.length > 8 && (
              <div className="px-4 py-3 border-t border-app-border">
                <Link href="/result" className="text-sm text-accent-primary hover:underline font-medium">
                  View all results →
                </Link>
              </div>
            )}
          </>
        )}
      </motion.div>

      {/* ── 5. ENDPOINT INVENTORY ── */}
      <motion.div
        variants={revealItem}
        className="border border-app-border shadow-card p-4 sm:p-6 rounded-xl"
        style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)", borderTop: "1px solid var(--color-card-border-top)" }}
      >
        <h2 className="section-heading text-lg font-semibold mb-4 text-accent-primary">
          API Endpoint Inventory
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-text-muted mb-2">REST Endpoints</h3>
            <div className="space-y-1.5 text-sm font-mono">
              <EndpointRow method="POST" path="/api/run" desc="Start test" />
              <EndpointRow method="POST" path="/api/stop" desc="Stop test" />
              <EndpointRow method="POST" path="/api/pause" desc="Pause test" />
              <EndpointRow method="POST" path="/api/resume" desc="Resume test" />
              <EndpointRow method="POST" path="/api/scale" desc="Scale VUs" />
              <EndpointRow method="GET" path="/api/metrics/live" desc="Live metrics" />
              <EndpointRow method="GET" path="/api/workers/status" desc="Worker status" />
              <EndpointRow method="GET" path="/api/result/list" desc="Result list" />
              <EndpointRow method="GET" path="/api/result/{id}" desc="Result detail" />
              <EndpointRow method="GET" path="/api/health" desc="Health check" />
            </div>
          </div>
          <div>
            <h3 className="text-xs uppercase tracking-wider text-text-muted mb-2">Dummy Service Endpoints</h3>
            <div className="space-y-3">
              <div className="space-y-1.5 text-sm font-mono">
                <BaseUrlRow label="Load Balancer Base" value="http://target-lb:8090" />
                <BaseUrlRow label="Single Dummy Base" value="http://dummy1:8090" />
              </div>

              <div className="space-y-1.5 text-sm font-mono">
                <EndpointRow method="POST" path="/" desc="Catch-all dummy JSON response" />
                <EndpointRow method="GET" path="/health" desc="Health check" />
                <EndpointRow method="GET" path="/metrics" desc="Prometheus metrics" />
                <EndpointRow method="GET" path="/api/stats" desc="Runtime counters" />
                <EndpointRow method="GET" path="/api/users" desc="JSON users list" />
                <EndpointRow method="POST" path="/api/users" desc="Create user from JSON payload" />
                <EndpointRow method="GET" path="/api/products" desc="JSON products list" />
                <EndpointRow method="POST" path="/api/orders" desc="Create order" />
                <EndpointRow method="GET" path="/api/events" desc="SSE event stream" />
                <EndpointRow method="POST" path="/api/auth/token" desc="OAuth client credentials token" />
                <EndpointRow method="POST" path="/api/auth/token/{scenario}" desc="Forced auth response or timeout" />
                <EndpointRow method="GET" path="/test/http/{scenario}" desc="Forced business HTTP response or timeout" />
                <EndpointRow method="POST" path="/test/http/{scenario}" desc="Forced business HTTP response or timeout" />
                <EndpointRow method="PUT" path="/test/http/{scenario}" desc="Forced business HTTP response or timeout" />
                <EndpointRow method="PATCH" path="/test/http/{scenario}" desc="Forced business HTTP response or timeout" />
                <EndpointRow method="DELETE" path="/test/http/{scenario}" desc="Forced business HTTP response or timeout" />
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function KpiCard({
  title,
  value,
  subtitle,
  accent = "gray",
}: {
  title: string
  value: string | number
  subtitle?: string
  accent?: "green" | "yellow" | "red" | "blue" | "gray"
}) {
  const accentColors: Record<string, string> = {
    green: "border-l-green-500",
    yellow: "border-l-yellow-500",
    red: "border-l-red-500",
    blue: "border-l-blue-500",
    gray: "border-l-gray-300 dark:border-l-gray-600",
  }

  return (
    <div
      className={`border border-app-border border-l-2 ${accentColors[accent]} p-4 sm:p-5 rounded-xl shadow-[0_0_16px_rgba(226,0,116,0.06)] dark:shadow-[0_0_20px_rgba(226,0,116,0.12)]`}
      style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)" }}
    >
      <div className="text-xs uppercase tracking-widest text-text-muted mb-2">{title}</div>
      <div className="text-xl sm:text-2xl font-bold text-accent-primary">{value}</div>
      {subtitle && <div className="text-xs text-text-muted mt-1">{subtitle}</div>}
    </div>
  )
}

function MetricBox({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="text-center">
      <div className="text-xs status-text--info uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold font-mono ${warn ? "status-text--danger" : "text-text-primary"}`}>
        {value}
      </div>
    </div>
  )
}

function EndpointRow({ method, path, desc }: { method: string; path: string; desc: string }) {
  const methodColors: Record<string, string> = {
    GET: "status-badge status-badge--success",
    POST: "status-badge status-badge--info",
    PUT: "status-badge status-badge--warning",
    PATCH: "status-badge status-badge--info",
    DELETE: "status-badge status-badge--danger",
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`px-1.5 py-0.5 text-xs font-bold ${methodColors[method] || "status-badge status-badge--neutral"}`}>
        {method}
      </span>
      <span className="text-accent-primary">{path}</span>
      <span className="text-text-muted text-xs ml-auto hidden sm:inline">{desc}</span>
    </div>
  )
}

function BaseUrlRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-app-border bg-app-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{label}</div>
      <div className="mt-1 break-all text-sm font-mono text-text-primary">{value}</div>
    </div>
  )
}
