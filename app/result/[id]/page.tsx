"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { getResult, createTemplate, type TemplatePayload } from "@/lib/api"
import { useSession } from "@/context/SessionContext"
import { motion } from "framer-motion"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  Cell,
} from "recharts"
import { useChartColors } from "@/lib/chart-theme"

/* ---------- types ---------- */

interface AggregatedMetrics {
  total_vus: number
  total_requests: number
  avg_latency_ms: number
  med_latency_ms: number
  p90_latency_ms: number
  p95_latency_ms: number
  p99_latency_ms: number
  min_latency_ms: number
  max_latency_ms: number
  error_rate: number
  success_rate: number
  rps: number
  iterations: number
  data_received_bytes: number
  data_sent_bytes: number
  http_failures: number
  http_successes: number
  status_4xx?: number
  status_5xx?: number
  workers?: WorkerMetrics[]
  thresholds?: ThresholdResult[]
}

interface WorkerMetrics {
  address: string
  vus: number
  requests: number
  avg_latency_ms: number
  status: string
  error?: string
}

interface ThresholdResult {
  metric: string
  passed: boolean
}

interface MetricQualityFlag {
  key: string
  status: "exact" | "approximate" | "legacy" | "unavailable" | string
  source?: string
  scope?: string
  approximation_reason?: string
}

interface HTTPMetricsBlock {
  requests: number
  rps?: number
  successes: number
  failures: number
  success_rate: number
  error_rate: number
  status_2xx?: number
  status_4xx?: number
  status_5xx?: number
  other_failures?: number
  network_errors?: number
  data_received_bytes?: number
  data_sent_bytes?: number
}

interface MetricCounter {
  count: number
  rate?: number
}

interface CheckMetrics {
  passes: number
  fails: number
  pass_rate: number
  fail_rate: number
}

interface LatencyMetricBlock {
  metric: string
  scope: string
  avg_ms: number
  med_ms: number
  p90_ms: number
  p95_ms: number
  p99_ms: number
  min_ms: number
  max_ms: number
}

interface BreakdownMetricBlock {
  avg_ms: number
  p95_ms: number
  p99_ms: number
  max_ms: number
}

interface LatencyBreakdownBlock {
  blocked: BreakdownMetricBlock
  waiting: BreakdownMetricBlock
  sending: BreakdownMetricBlock
  receiving: BreakdownMetricBlock
  connecting: BreakdownMetricBlock
  tls_handshaking: BreakdownMetricBlock
}

interface WorkerMetricsV2 {
  address: string
  status: string
  error?: string
  requests: number
  business_requests: number
  auxiliary_requests: number
  avg_latency_ms: number
  p95_latency_ms: number
  p99_latency_ms: number
  error_rate: number
  active_duration_s?: number
}

interface MetricsV2 {
  http_total: HTTPMetricsBlock
  http_business: HTTPMetricsBlock
  http_auxiliary: HTTPMetricsBlock
  iterations: MetricCounter
  checks: CheckMetrics
  latency_primary: LatencyMetricBlock
  latency_breakdown?: LatencyBreakdownBlock
  workers?: WorkerMetricsV2[]
  thresholds?: ThresholdResult[]
  quality_flags?: MetricQualityFlag[]
}

interface TimePoint {
  t: number
  vus: number
  rps: number
  avg_ms: number
  p95_ms: number
  reqs: number
  business_reqs?: number
  err_rate: number
  status_4xx?: number
  status_5xx?: number
}

interface ThroughputPoint extends TimePoint {
  total_http_rps: number
  business_rps?: number
  auxiliary_rps?: number
  total_http_reqs: number
  business_http_reqs?: number
  auxiliary_http_reqs?: number
}

interface TestMetadata {
  started_at: string
  ended_at: string
  duration_s: number
  worker_count: number
  artifact_collection?: ArtifactCollectionMetadata
  stages?: { duration: string; target: number }[]
  script_url?: string
  payload?: PayloadMetadata
  auth?: AuthMetadata
}

interface ArtifactCollectionMetadata {
  status?: string
  expected_worker_count?: number
  received_worker_summary_count?: number
  missing_workers?: string[]
}

interface PayloadMetadata {
  http_method: string
  content_type: string
  payload_target_bytes: number
  payload_target_kib: number
  payload_target_kb: number
  payload_actual_bytes: number
  payload_actual_kib: number
  payload_actual_kb: number
}

interface StatusCodeCount {
  code: number
  count: number
}

interface AuthRuntimeMetrics {
  token_requests_total: number
  token_success_total: number
  token_failure_total: number
  token_success_rate: number
  token_request_avg_ms: number
  token_request_p95_ms: number
  token_request_p99_ms: number
  token_request_max_ms: number
  token_refresh_total: number
  token_reuse_hits_total: number
  response_status_codes?: StatusCodeCount[]
  abort_triggered?: boolean
  abort_cause?: string
  abort_reason?: string
  abort_http_status_codes?: number[]
  abort_retryable?: boolean
}

interface AuthMetadata {
  mode?: string
  token_url?: string
  client_auth_method?: string
  refresh_skew_seconds?: number
  secret_source?: string
  metrics_status?: string
  metrics_message?: string
  metrics?: AuthRuntimeMetrics
}

interface ConflictWarning {
  type: string
  message: string
}

interface ResultData {
  id: string
  project_name: string
  url: string
  status: string
  username: string
  created_at: string
  run_by?: { username?: string; id?: number }
  metrics?: AggregatedMetrics
  metrics_v2?: MetricsV2
  time_series?: TimePoint[]
  metadata?: TestMetadata
  warnings?: ConflictWarning[]
  script_content?: string
  config_content?: string
  payload_source_json?: string
  payload_content?: string
  http_method?: string
  content_type?: string
  executor?: string
  stages?: { duration: string; target: number }[]
  vus?: number
  duration?: string
  rate?: number
  time_unit?: string
  pre_allocated_vus?: number
  max_vus?: number
  sleep_seconds?: number
  summary_content?: string
  auth_summary_content?: string
}

function buildRerunCloneData(data: ResultData): Record<string, unknown> {
  const cloneData: Record<string, unknown> = {}
  const hasBuilderConfig =
    Boolean(data.url || data.executor || data.stages?.length) ||
    typeof data.vus === "number" ||
    typeof data.rate === "number" ||
    typeof data.pre_allocated_vus === "number" ||
    typeof data.max_vus === "number" ||
    typeof data.sleep_seconds === "number" ||
    typeof data.duration === "string"

  if (!hasBuilderConfig && data.script_content) cloneData.script_content = data.script_content
  if (data.config_content) cloneData.config_content = data.config_content
  if (data.url) cloneData.url = data.url
  if (data.executor) cloneData.executor = data.executor
  if (data.http_method || data.metadata?.payload?.http_method) {
    cloneData.http_method = data.metadata?.payload?.http_method ?? data.http_method
  }
  if (data.content_type || data.metadata?.payload?.content_type) {
    cloneData.content_type = data.metadata?.payload?.content_type ?? data.content_type
  }
  if (data.payload_source_json) cloneData.payload_json = data.payload_source_json
  if (data.metadata?.payload?.payload_target_kib) {
    cloneData.payload_target_kib = Math.round(data.metadata.payload.payload_target_kib)
  }
  if (Array.isArray(data.stages) && data.stages.length > 0) {
    cloneData.stages = data.stages
  } else if (Array.isArray(data.metadata?.stages) && data.metadata.stages.length > 0) {
    cloneData.stages = data.metadata.stages
  }
  if (typeof data.vus === "number") cloneData.vus = data.vus
  if (typeof data.duration === "string" && data.duration) cloneData.duration = data.duration
  if (typeof data.rate === "number") cloneData.rate = data.rate
  if (typeof data.time_unit === "string" && data.time_unit) cloneData.time_unit = data.time_unit
  if (typeof data.pre_allocated_vus === "number") cloneData.pre_allocated_vus = data.pre_allocated_vus
  if (typeof data.max_vus === "number") cloneData.max_vus = data.max_vus
  if (typeof data.sleep_seconds === "number") cloneData.sleep_seconds = data.sleep_seconds

  return cloneData
}

function qualityFlag(metrics: MetricsV2 | undefined, key: string): MetricQualityFlag | undefined {
  return metrics?.quality_flags?.find((flag) => flag.key === key)
}

function qualityBadge(flag?: MetricQualityFlag): string {
  if (!flag) return "status-badge status-badge--neutral"
  if (flag.status === "exact") return "status-badge status-badge--success"
  if (flag.status === "partial") return "status-badge status-badge--warning"
  if (flag.status === "approximate") return "status-badge status-badge--warning"
  if (flag.status === "legacy") return "status-badge status-badge--info"
  return "status-badge status-badge--neutral"
}

const METRIC_INFO: Record<string, string> = {
  "Duration": "Wall-clock runtime of the test run as tracked by the controller. This can differ slightly from worker-local active windows.",
  "Workers": "Number of generator workers participating in the run. Per-worker counts can still differ because workers may not contribute for exactly the same active window.",
  "Started": "Controller timestamp for when the run started.",
  "Ended": "Controller timestamp for when the run ended.",
  "Method": "HTTP method used for the generated business request.",
  "Content-Type": "Configured content type for the business request payload.",
  "Target Size": "Configured serialized payload size target. This is not the same as total network volume.",
  "Actual Size": "Measured UTF-8 byte size of the serialized business payload used by the run.",
  "Mode": "Authentication mode used by the run.",
  "Client Auth": "How client credentials were sent to the token endpoint, for example basic auth or request-body credentials.",
  "Secret Source": "Where the auth client secret came from for this run.",
  "Refresh Skew": "Safety margin before token expiry. Tokens are renewed slightly before they expire to avoid boundary failures.",
  "Token Requests": "Logical token acquisition attempts. This is not always identical to auxiliary HTTP requests because retries or proxy behavior can create more than one HTTP exchange.",
  "Token Success Rate": "Successful token acquisitions divided by logical token requests.",
  "Token Avg": "Average latency of logical token acquisition attempts.",
  "Refreshes": "Number of token refresh operations during the run.",
  "Reuse Events": "Diagnostic counter showing how often a cached token was reused. This can be much higher than token requests because reuse is counted across many business iterations.",
  "Response Codes": "Observed HTTP response codes returned by the auth endpoint. These help explain auth failures and may differ from logical token counts.",
  "Total HTTP Requests": "All on-wire HTTP requests seen by k6, including business traffic and auxiliary flows such as authentication.",
  "Business Requests": "Primary SUT requests instrumented as business traffic. This can be lower than Total HTTP Requests when auth or other auxiliary calls are present.",
  "Auxiliary HTTP Requests": "Derived non-business HTTP traffic. This usually equals total HTTP requests minus business requests, so it can differ from logical token requests.",
  "Iterations": "Completed scenario loop executions. This can differ slightly from Business Requests near test end because in-flight requests may finish after the last full iteration boundary.",
  "Business Req/s": "Business request throughput derived from business requests over the controller-visible run duration.",
  "Total HTTP Req/s": "Derived interval throughput for all HTTP traffic. This is calculated from the delta between cumulative request counts of consecutive time-series samples, not from the final executive summary average.",
  "Auxiliary Req/s": "Derived interval throughput for non-business HTTP traffic. Small values can appear even when logical token requests stay low because this reflects on-wire HTTP traffic, not logical auth operations.",
  "Total HTTP Requests (Cumulative)": "Running cumulative count of all HTTP requests over time. This should rise monotonically and is not itself a throughput value.",
  "Business Requests (Cumulative)": "Running cumulative count of business requests over time. It can finish slightly below the final summary when the last live poll happened before the summary artifacts were written.",
  "Auxiliary Requests (Cumulative)": "Running cumulative count of derived non-business HTTP traffic over time.",
  "Business Success Rate": "Successful business requests divided by total business requests. Auxiliary/auth traffic is excluded.",
  "Data Received": "Total bytes received across all HTTP traffic recorded by k6.",
  "Data Sent": "Total bytes sent across all HTTP traffic recorded by k6.",
  "Total HTTP": "All HTTP requests included in the HTTP performance section.",
  "Business 2xx": "Business requests that completed with a 2xx response. This should never be higher than Business Requests.",
  "Business 4xx": "Business requests that completed with a 4xx response.",
  "Business 5xx": "Business requests that completed with a 5xx response.",
  "Other Business Failures": "Business failures not classified as 4xx or 5xx, for example transport failures or other derived failure classes.",
  "Auth Failures": "Auxiliary/auth HTTP failures. These are shown separately so auth issues do not silently inflate business error metrics.",
  "Min": "Minimum observed value for the metric block shown here.",
  "Median": "50th percentile for the metric block shown here.",
  "Average": "Arithmetic mean for the metric block shown here.",
  "P90": "90th percentile for the metric block shown here.",
  "P95": "95th percentile for the metric block shown here.",
  "P99": "99th percentile for the metric block shown here.",
  "Max": "Maximum observed value for the metric block shown here.",
  "Avg": "Average value for the metric block shown here.",
  "Blocked": "Time spent waiting for a free connection slot or other client-side blocking before the request could proceed.",
  "Waiting": "Server processing and first-byte wait time. This is usually the strongest signal for backend response latency.",
  "Sending": "Time spent transmitting the request bytes to the server.",
  "Receiving": "Time spent receiving the response body from the server.",
  "Connecting": "Time spent establishing the TCP connection.",
  "TLS Handshaking": "Time spent in TLS negotiation before encrypted traffic could start.",
  "HTTP Requests": "Per-worker total on-wire HTTP requests.",
  "Business": "Per-worker business requests only.",
  "Auxiliary": "Per-worker non-business HTTP traffic. This can differ from logical token attempts for the same reasons as the global auxiliary metric.",
  "Error Rate": "Failure ratio for the metric block shown here.",
  "Active Window": "Approximate worker-local active duration derived from the worker summary rather than the controller wall-clock duration.",
}

function metricInfo(label: string): string | undefined {
  return METRIC_INFO[label]
}

function qualityInfo(label: string, flag?: MetricQualityFlag): string | undefined {
  if (!flag) return undefined
  return [
    `${label} is marked as ${flag.status}.`,
    flag.source ? `Source: ${flag.source}.` : "",
    flag.scope ? `Scope: ${flag.scope}.` : "",
    flag.approximation_reason ?? "",
  ].filter(Boolean).join(" ")
}

function safeIntervalRate(deltaCount: number, deltaSeconds: number): number {
  if (!Number.isFinite(deltaCount) || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0
  if (deltaCount <= 0) return 0
  return deltaCount / deltaSeconds
}

function buildThroughputSeries(points: TimePoint[]): ThroughputPoint[] {
  let sawBusiness = false

  const series = points.map((point, index) => {
    const previous = index > 0 ? points[index - 1] : undefined
    const totalRequests = Math.max(0, point.reqs ?? 0)
    const businessRequests = Math.max(0, point.business_reqs ?? 0)
    if (businessRequests > 0) {
      sawBusiness = true
    }
    const auxiliaryRequests = Math.max(0, totalRequests - businessRequests)

    const deltaSeconds = previous ? point.t - previous.t : point.t
    const totalDelta = previous ? totalRequests - Math.max(0, previous.reqs ?? 0) : totalRequests
    const businessDelta = previous ? businessRequests - Math.max(0, previous.business_reqs ?? 0) : businessRequests
    const auxiliaryDelta = previous
      ? auxiliaryRequests - Math.max(0, Math.max(0, previous.reqs ?? 0) - Math.max(0, previous.business_reqs ?? 0))
      : auxiliaryRequests

    return {
      ...point,
      total_http_rps: safeIntervalRate(totalDelta, deltaSeconds),
      business_rps: businessRequests > 0 || (previous?.business_reqs ?? 0) > 0 ? safeIntervalRate(businessDelta, deltaSeconds) : undefined,
      auxiliary_rps: auxiliaryRequests > 0 || previous ? safeIntervalRate(auxiliaryDelta, deltaSeconds) : undefined,
      total_http_reqs: totalRequests,
      business_http_reqs: businessRequests > 0 || (previous?.business_reqs ?? 0) > 0 ? businessRequests : undefined,
      auxiliary_http_reqs: auxiliaryRequests > 0 || previous ? auxiliaryRequests : undefined,
    }
  })

  if (!sawBusiness) {
    return series.map((point) => ({
      ...point,
      business_rps: undefined,
      business_http_reqs: undefined,
      auxiliary_rps: undefined,
      auxiliary_http_reqs: undefined,
    }))
  }

  return series
}

/* ---------- export helpers ---------- */

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportJSON(data: ResultData) {
  const sanitized = { ...data }
  // Pretty-print for readability
  downloadFile(
    `${data.project_name.replace(/\s+/g, "_")}_${data.id.slice(0, 8)}.json`,
    JSON.stringify(sanitized, null, 2),
    "application/json"
  )
}

function exportCSV(data: ResultData) {
  const lines: string[] = []

  // Summary row
  const m = data.metrics
  const m2 = data.metrics_v2
  const meta = data.metadata
  const auth = meta?.auth
  lines.push("# Summary")
  lines.push("project_name,id,status,url,http_method,content_type,payload_target_kib,payload_actual_bytes,payload_actual_kib,auth_mode,auth_client_auth_method,auth_metrics_status,auth_metrics_message,auth_response_status_codes,auth_abort_triggered,auth_abort_cause,auth_abort_reason,auth_abort_http_status_codes,auth_abort_retryable,auth_token_requests_total,auth_token_success_total,auth_token_failure_total,auth_token_success_rate,auth_token_request_avg_ms,auth_token_request_p95_ms,auth_token_request_p99_ms,auth_token_refresh_total,auth_token_reuse_events_total,duration_s,workers,total_http_requests,total_http_rps,business_requests,business_rps,business_successes,business_failures,business_success_rate,business_error_rate,aux_http_requests,aux_http_successes,aux_http_failures,iterations,primary_latency_avg_ms,primary_latency_p95_ms,primary_latency_p99_ms,data_received_bytes,data_sent_bytes,quality_http_business,quality_latency_primary")
  lines.push([
    csvVal(data.project_name), csvVal(data.id), csvVal(data.status), csvVal(data.url),
    csvVal(data.metadata?.payload?.http_method ?? data.http_method ?? ""),
    csvVal(data.metadata?.payload?.content_type ?? data.content_type ?? ""),
    data.metadata?.payload?.payload_target_kib ?? "",
    data.metadata?.payload?.payload_actual_bytes ?? "",
    data.metadata?.payload?.payload_actual_kib ?? "",
    csvVal(auth?.mode ?? ""),
    csvVal(auth?.client_auth_method ?? ""),
    csvVal(auth?.metrics_status ?? ""),
    csvVal(auth?.metrics_message ?? ""),
    csvVal(formatStatusCodeCounts(auth?.metrics?.response_status_codes)),
    auth?.metrics?.abort_triggered ?? "",
    csvVal(auth?.metrics?.abort_cause ?? ""),
    csvVal(auth?.metrics?.abort_reason ?? ""),
    csvVal((auth?.metrics?.abort_http_status_codes ?? []).join("|")),
    auth?.metrics?.abort_retryable ?? "",
    auth?.metrics?.token_requests_total ?? "",
    auth?.metrics?.token_success_total ?? "",
    auth?.metrics?.token_failure_total ?? "",
    auth?.metrics?.token_success_rate ?? "",
    auth?.metrics?.token_request_avg_ms ?? "",
    auth?.metrics?.token_request_p95_ms ?? "",
    auth?.metrics?.token_request_p99_ms ?? "",
    auth?.metrics?.token_refresh_total ?? "",
    auth?.metrics?.token_reuse_hits_total ?? "",
    meta?.duration_s ?? "", meta?.worker_count ?? "",
    m2?.http_total.requests ?? m?.total_requests ?? "",
    m2?.http_total.rps ?? m?.rps ?? "",
    m2?.http_business.requests ?? "",
    m2?.http_business.rps ?? "",
    m2?.http_business.successes ?? "",
    m2?.http_business.failures ?? "",
    m2?.http_business.success_rate ?? "",
    m2?.http_business.error_rate ?? "",
    m2?.http_auxiliary.requests ?? "",
    m2?.http_auxiliary.successes ?? "",
    m2?.http_auxiliary.failures ?? "",
    m2?.iterations.count ?? m?.iterations ?? "",
    m2?.latency_primary.avg_ms ?? m?.avg_latency_ms ?? "",
    m2?.latency_primary.p95_ms ?? m?.p95_latency_ms ?? "",
    m2?.latency_primary.p99_ms ?? m?.p99_latency_ms ?? "",
    m2?.http_total.data_received_bytes ?? m?.data_received_bytes ?? "",
    m2?.http_total.data_sent_bytes ?? m?.data_sent_bytes ?? "",
    csvVal(qualityFlag(m2, "http_business")?.status ?? ""),
    csvVal(qualityFlag(m2, "latency_primary")?.status ?? ""),
  ].join(","))
  lines.push("")

  // Time-series
  const ts = data.time_series ?? []
  if (ts.length > 0) {
    const throughputSeries = buildThroughputSeries(ts)
    lines.push("# Time Series")
    lines.push("elapsed_s,vus,total_http_req_per_sec,business_req_per_sec,auxiliary_req_per_sec,avg_latency_ms,p95_latency_ms,total_http_requests,business_requests,auxiliary_requests,error_rate,status_4xx,status_5xx")
    for (const p of throughputSeries) {
      lines.push([
        p.t,
        p.vus,
        p.total_http_rps,
        p.business_rps ?? "",
        p.auxiliary_rps ?? "",
        p.avg_ms,
        p.p95_ms,
        p.total_http_reqs,
        p.business_http_reqs ?? "",
        p.auxiliary_http_reqs ?? "",
        p.err_rate,
        p.status_4xx ?? 0,
        p.status_5xx ?? 0,
      ].join(","))
    }
    lines.push("")
  }

  // Worker breakdown
  const workers = m2?.workers ?? m?.workers ?? []
  if (workers.length > 0) {
    lines.push("# Workers")
    lines.push("address,status,requests,business_requests,auxiliary_requests,avg_latency_ms,p95_latency_ms,p99_latency_ms,error_rate,active_duration_s")
    for (const w of workers) {
      lines.push([
        csvVal((w as WorkerMetricsV2).address ?? (w as WorkerMetrics).address),
        csvVal((w as WorkerMetricsV2).status ?? (w as WorkerMetrics).status),
        (w as WorkerMetricsV2).requests ?? (w as WorkerMetrics).requests ?? "",
        (w as WorkerMetricsV2).business_requests ?? "",
        (w as WorkerMetricsV2).auxiliary_requests ?? "",
        (w as WorkerMetricsV2).avg_latency_ms ?? (w as WorkerMetrics).avg_latency_ms ?? "",
        (w as WorkerMetricsV2).p95_latency_ms ?? "",
        (w as WorkerMetricsV2).p99_latency_ms ?? "",
        (w as WorkerMetricsV2).error_rate ?? "",
        (w as WorkerMetricsV2).active_duration_s ?? "",
      ].join(","))
    }
  }

  downloadFile(
    `${data.project_name.replace(/\s+/g, "_")}_${data.id.slice(0, 8)}.csv`,
    lines.join("\n"),
    "text/csv"
  )
}

function csvVal(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function exportMarkdown(data: ResultData) {
  const m = data.metrics
  const m2 = data.metrics_v2
  const meta = data.metadata
  const lines: string[] = []

  lines.push(`# Load Test Report: ${data.project_name}`)
  lines.push("")
  lines.push(`| | |`)
  lines.push(`|---|---|`)
  lines.push(`| **ID** | \`${data.id}\` |`)
  lines.push(`| **URL** | ${data.url || "—"} |`)
  lines.push(`| **Status** | ${data.status} |`)
  lines.push(`| **Run by** | ${data.run_by?.username ?? data.username ?? "system"} |`)
  lines.push(`| **Date** | ${new Date(data.created_at).toISOString().replace("T", " ").slice(0, 19)} |`)
  if (meta) {
    lines.push(`| **Duration** | ${mdDuration(meta.duration_s)} |`)
    lines.push(`| **Workers** | ${meta.worker_count} |`)
  }
  lines.push("")

  if (meta?.stages && meta.stages.length > 0) {
    lines.push("## Ramp-up Profile")
    lines.push("| Stage | Duration | Target VUs |")
    lines.push("|-------|----------|------------|")
    meta.stages.forEach((s, i) => lines.push(`| ${i + 1} | ${s.duration} | ${s.target} |`))
    lines.push("")
  }

  if (meta?.payload || data.payload_content || data.payload_source_json) {
    const payload = meta?.payload
    lines.push("## Request Payload")
    lines.push("| Field | Value |")
    lines.push("|-------|-------|")
    lines.push(`| HTTP Method | ${payload?.http_method ?? data.http_method ?? "—"} |`)
    lines.push(`| Content-Type | ${payload?.content_type ?? data.content_type ?? "—"} |`)
    lines.push(`| Target Size | ${payload ? `${payload.payload_target_bytes} B / ${payload.payload_target_kb.toFixed(2)} KB / ${payload.payload_target_kib.toFixed(2)} KiB` : "—"} |`)
    lines.push(`| Actual Size | ${payload ? `${payload.payload_actual_bytes} B / ${payload.payload_actual_kb.toFixed(2)} KB / ${payload.payload_actual_kib.toFixed(2)} KiB` : "—"} |`)
    lines.push("")

    if (data.payload_source_json) {
      lines.push("### Source Payload JSON")
      lines.push("```json")
      try { lines.push(JSON.stringify(JSON.parse(data.payload_source_json), null, 2)) }
      catch { lines.push(data.payload_source_json) }
      lines.push("```")
      lines.push("")
    }

    if (data.payload_content) {
      lines.push("### Final Request Payload")
      lines.push("```json")
      try { lines.push(JSON.stringify(JSON.parse(data.payload_content), null, 2)) }
      catch { lines.push(data.payload_content) }
      lines.push("```")
      lines.push("")
    }
  }

  if (meta?.auth) {
    const authMetrics = meta.auth.metrics
    lines.push("## Authentication")
    lines.push("| Field | Value |")
    lines.push("|-------|-------|")
    lines.push(`| Mode | ${meta.auth.mode ?? "—"} |`)
    lines.push(`| Token URL | ${meta.auth.token_url ?? "—"} |`)
    lines.push(`| Client Auth Method | ${meta.auth.client_auth_method ?? "—"} |`)
    lines.push(`| Secret Source | ${meta.auth.secret_source ?? "—"} |`)
    lines.push(`| Refresh Skew | ${meta.auth.refresh_skew_seconds != null ? `${meta.auth.refresh_skew_seconds}s` : "—"} |`)
    lines.push(`| Metrics Status | ${meta.auth.metrics_status ?? "—"} |`)
    lines.push(`| Metrics Message | ${meta.auth.metrics_message ?? "—"} |`)
    lines.push(`| Response Status Codes | ${mdStatusCodeCounts(authMetrics?.response_status_codes)} |`)
    lines.push(`| Abort Triggered | ${authMetrics?.abort_triggered ? "yes" : "no"} |`)
    lines.push(`| Abort Cause | ${authMetrics?.abort_cause ?? "—"} |`)
    lines.push(`| Abort Reason | ${authMetrics?.abort_reason ?? "—"} |`)
    lines.push(`| Abort HTTP Status Codes | ${(authMetrics?.abort_http_status_codes ?? []).length > 0 ? authMetrics?.abort_http_status_codes?.join(", ") : "—"} |`)
    lines.push(`| Abort Retryable | ${authMetrics?.abort_retryable ? "yes" : "no"} |`)
    lines.push(`| Token Requests | ${authMetrics ? mdNum(authMetrics.token_requests_total) : "—"} |`)
    lines.push(`| Token Successes | ${authMetrics ? mdNum(authMetrics.token_success_total) : "—"} |`)
    lines.push(`| Token Failures | ${authMetrics ? mdNum(authMetrics.token_failure_total) : "—"} |`)
    lines.push(`| Token Success Rate | ${authMetrics ? mdPct(authMetrics.token_success_rate) : "—"} |`)
    lines.push(`| Token Request Avg | ${authMetrics ? mdMs(authMetrics.token_request_avg_ms) : "—"} |`)
    lines.push(`| Token Request P95 | ${authMetrics ? mdMs(authMetrics.token_request_p95_ms) : "—"} |`)
    lines.push(`| Token Request P99 | ${authMetrics ? mdMs(authMetrics.token_request_p99_ms) : "—"} |`)
    lines.push(`| Token Refreshes | ${authMetrics ? mdNum(authMetrics.token_refresh_total) : "—"} |`)
    lines.push(`| Token Reuse Events | ${authMetrics ? mdNum(authMetrics.token_reuse_hits_total) : "—"} |`)
    lines.push("")
  }

  if (m2 || m) {
    lines.push("## Executive Summary")
    lines.push("| Metric | Value |")
    lines.push("|--------|-------|")
    lines.push(`| Total HTTP Requests | ${mdNum(m2?.http_total.requests ?? m?.total_requests)} |`)
    lines.push(`| Business Requests | ${mdNum(m2?.http_business.requests)} |`)
    lines.push(`| Auxiliary HTTP Requests | ${mdNum(m2?.http_auxiliary.requests)} |`)
    lines.push(`| Business Requests/sec | ${m2?.http_business.rps?.toFixed(1) ?? m?.rps?.toFixed(1) ?? "—"} |`)
    lines.push(`| Iterations | ${mdNum(m2?.iterations.count ?? m?.iterations)} |`)
    lines.push(`| Business Success Rate | ${mdPct(m2?.http_business.success_rate ?? m?.success_rate)} |`)
    lines.push(`| Business Error Rate | ${mdPct(m2?.http_business.error_rate ?? m?.error_rate)} |`)
    lines.push(`| Data Received | ${mdBytes(m2?.http_total.data_received_bytes ?? m?.data_received_bytes)} |`)
    lines.push(`| Data Sent | ${mdBytes(m2?.http_total.data_sent_bytes ?? m?.data_sent_bytes)} |`)
    lines.push("")

    lines.push("## Primary Latency")
    lines.push("| Min | Median | Avg | P90 | P95 | P99 | Max |")
    lines.push("|-----|--------|-----|-----|-----|-----|-----|")
    lines.push(`| ${mdMs(m2?.latency_primary.min_ms ?? m?.min_latency_ms)} | ${mdMs(m2?.latency_primary.med_ms ?? m?.med_latency_ms)} | ${mdMs(m2?.latency_primary.avg_ms ?? m?.avg_latency_ms)} | ${mdMs(m2?.latency_primary.p90_ms ?? m?.p90_latency_ms)} | ${mdMs(m2?.latency_primary.p95_ms ?? m?.p95_latency_ms)} | ${mdMs(m2?.latency_primary.p99_ms ?? m?.p99_latency_ms)} | ${mdMs(m2?.latency_primary.max_ms ?? m?.max_latency_ms)} |`)
    lines.push("")

    lines.push("## HTTP Performance")
    const total = m2?.http_total.requests ?? ((m?.http_successes ?? 0) + (m?.http_failures ?? 0))
    const s2xx = m2?.http_business.status_2xx ?? m?.http_successes ?? 0
    const s4xx = m2?.http_business.status_4xx ?? m?.status_4xx ?? 0
    const s5xx = m2?.http_business.status_5xx ?? m?.status_5xx ?? 0
    const otherErr = m2?.http_business.other_failures ?? Math.max(0, (m?.http_failures ?? 0) - s4xx - s5xx)
    lines.push(`| Total | 2xx Success | 4xx Client | 5xx Server | Other Errors | Success Rate |`)
    lines.push(`|-------|-------------|------------|------------|--------------|--------------|`)
    lines.push(`| ${mdNum(total)} | ${mdNum(s2xx)} | ${mdNum(s4xx)} | ${mdNum(s5xx)} | ${mdNum(otherErr)} | ${mdPct(m2?.http_business.success_rate ?? m?.success_rate)} |`)
    lines.push("")

    if (m2?.workers && m2.workers.length > 0) {
      lines.push("## Worker Breakdown")
      lines.push("| Worker | Status | Requests | Business | Auxiliary | Avg | P95 | Error Rate |")
      lines.push("|--------|--------|----------|----------|-----------|-----|-----|------------|")
      for (const w of m2.workers) {
        lines.push(`| ${w.address} | ${w.status} | ${mdNum(w.requests)} | ${mdNum(w.business_requests)} | ${mdNum(w.auxiliary_requests)} | ${mdMs(w.avg_latency_ms)} | ${mdMs(w.p95_latency_ms)} | ${mdPct(w.error_rate)} |`)
      }
      lines.push("")
    }

    if ((m2?.thresholds?.length ?? 0) > 0 || (m?.thresholds?.length ?? 0) > 0) {
      lines.push("## k6 Thresholds")
      lines.push("| Metric | Result |")
      lines.push("|--------|--------|")
      for (const th of m2?.thresholds ?? m?.thresholds ?? []) {
        lines.push(`| ${th.metric} | ${th.passed ? "PASS" : "**FAIL**"} |`)
      }
      lines.push("")
    }

    if ((m2?.quality_flags?.length ?? 0) > 0) {
      lines.push("## Metric Quality")
      lines.push("| Key | Status | Source | Reason |")
      lines.push("|-----|--------|--------|--------|")
      for (const flag of m2?.quality_flags ?? []) {
        lines.push(`| ${flag.key} | ${flag.status} | ${flag.source ?? "—"} | ${flag.approximation_reason ?? "—"} |`)
      }
      lines.push("")
    }
  }

  if (data.warnings && data.warnings.length > 0) {
    lines.push("## Warnings")
    for (const w of data.warnings) {
      lines.push(`- **${w.type}**: ${w.message}`)
    }
    lines.push("")
  }

  if (data.script_content) {
    lines.push("## k6 Script")
    lines.push("```javascript")
    lines.push(data.script_content)
    lines.push("```")
    lines.push("")
  }

  if (data.config_content) {
    lines.push("## Config")
    lines.push("```json")
    try { lines.push(JSON.stringify(JSON.parse(data.config_content), null, 2)) }
    catch { lines.push(data.config_content) }
    lines.push("```")
    lines.push("")
  }

  lines.push("---")
  lines.push(`*Generated by Shiva on ${new Date().toISOString().slice(0, 10)}*`)

  downloadFile(
    `${data.project_name.replace(/\s+/g, "_")}_${data.id.slice(0, 8)}.md`,
    lines.join("\n"),
    "text/markdown"
  )
}

function mdNum(n: number | undefined | null): string {
  if (n == null) return "—"
  return Math.round(n).toLocaleString("de-DE")
}

function mdMs(ms: number | undefined | null): string {
  if (ms == null || isNaN(ms)) return "—"
  if (ms < 1) return `${(ms * 1000).toFixed(0)} us`
  if (ms < 1000) return `${ms.toFixed(1)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function mdPct(rate: number | undefined | null): string {
  if (rate == null) return "—"
  return `${(rate * 100).toFixed(2)}%`
}

function mdBytes(b: number | undefined | null): string {
  if (b == null) return "—"
  if (b === 0) return "0 B"
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`
  if (b >= 1_024) return `${(b / 1_024).toFixed(1)} KB`
  return `${b.toFixed(0)} B`
}

function mdDuration(s: number | undefined | null): string {
  if (s == null) return "—"
  if (s < 60) return `${s.toFixed(0)}s`
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`
}

function mdCodeList(codes: number[] | undefined): string {
  if (!codes || codes.length === 0) return "—"
  return codes.join(", ")
}

function mdStatusCodeCounts(entries: StatusCodeCount[] | undefined): string {
  if (!entries || entries.length === 0) return "—"
  return entries
    .filter((entry) => entry && entry.code > 0 && entry.count > 0)
    .map((entry) => `${entry.code} x ${mdNum(entry.count)}`)
    .join(", ")
}

/* ---------- helpers ---------- */

const ACCENT = "#E20074"

/* tooltipStyle is now generated dynamically via useChartColors() inside the component */

function fmtMs(ms: number | undefined | null): string {
  if (ms == null || isNaN(ms)) return "N/A"
  if (ms < 0.001) return "0 ms"
  if (ms < 1) return `${(ms * 1000).toFixed(0)} \u00B5s`
  if (ms < 1000) return `${ms.toFixed(1)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function fmtNum(n: number | undefined | null): string {
  if (n == null) return "N/A"
  return Math.round(n).toLocaleString("de-DE")
}

function fmtPct(rate: number | undefined | null): string {
  if (rate == null) return "N/A"
  return `${(rate * 100).toFixed(2)}%`
}

function fmtBytes(b: number | undefined | null): string {
  if (b == null) return "N/A"
  if (b === 0) return "0 B"
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`
  if (b >= 1_024) return `${(b / 1_024).toFixed(1)} KB`
  return `${b.toFixed(0)} B`
}

function fmtDuration(s: number | undefined | null): string {
  if (s == null) return "N/A"
  if (s < 60) return `${s.toFixed(0)}s`
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`
}

function fmtCodeList(codes: number[] | undefined): string {
  if (!codes || codes.length === 0) return "N/A"
  return codes.join(", ")
}

function formatStatusCodeCounts(entries: StatusCodeCount[] | undefined): string {
  if (!entries || entries.length === 0) return "N/A"
  return entries
    .filter((entry) => entry && entry.code > 0 && entry.count > 0)
    .map((entry) => `${entry.code} x ${fmtNum(entry.count)}`)
    .join(", ")
}

function fmtTime(label: number): string {
  const m = Math.floor(label / 60)
  const s = Math.round(label % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

/* ---------- component ---------- */

export default function ResultDetail() {
  const params = useParams()
  const id = params?.id as string
  const router = useRouter()
  const { user, token, initialized: ready } = useSession()
  const chart = useChartColors()
  const tooltipStyle = {
    background: chart.tooltipBg,
    border: `1px solid ${chart.tooltipBorder}`,
    color: chart.tooltipText,
    borderRadius: "8px",
    fontSize: "12px",
  }
  const [data, setData] = useState<ResultData | null>(null)
  const [loading, setLoading] = useState(true)
  const [templateSaving, setTemplateSaving] = useState(false)
  const [templateToast, setTemplateToast] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [stopping, setStopping] = useState(false)

  const loadResult = useCallback(async () => {
    if (!id || !token) return
    setLoading(true)
    try {
      const res = await getResult(id, token)
      setData(res as ResultData)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [id, token])
  useEffect(() => {
    if (!id || !token) return
    const timer = setTimeout(() => {
      void loadResult()
    }, 0)
    return () => clearTimeout(timer)
  }, [id, token, loadResult])
  // Poll for updates while test is running
  useEffect(() => {
    if (!id || !token || data?.status !== "running") return
    const interval = setInterval(async () => {
      try {
        const res = await getResult(id, token)
        setData(res as ResultData)
      } catch { /* ignore polling errors */ }
    }, 5000)
    return () => clearInterval(interval)
  }, [id, token, data?.status])

  useEffect(() => {
    if (ready && !user) router.replace("/login")
  }, [ready, user, router])

  const handleSaveAsTemplate = async () => {
    if (!data || !token) return
    setTemplateSaving(true)
    try {
      const hasBuilderConfig =
        Boolean(data.url || data.executor || data.stages?.length || data.metadata?.stages?.length) ||
        typeof data.vus === "number" ||
        typeof data.rate === "number" ||
        typeof data.pre_allocated_vus === "number" ||
        typeof data.max_vus === "number" ||
        typeof data.sleep_seconds === "number" ||
        typeof data.duration === "string"
      const templateMode: "builder" | "upload" = hasBuilderConfig ? "builder" : "upload"

      const payload: TemplatePayload = {
        name: data.project_name,
        description: `Created from test result ${data.id.slice(0, 8)}`,
        mode: templateMode,
        url: templateMode === "builder" ? data.url || undefined : undefined,
        stages: templateMode === "builder" ? (data.stages ?? data.metadata?.stages) : undefined,
        http_method: data.metadata?.payload?.http_method ?? data.http_method ?? undefined,
        content_type: data.metadata?.payload?.content_type ?? data.content_type ?? undefined,
        payload_json: data.payload_source_json || undefined,
        payload_target_kib: data.metadata?.payload?.payload_target_kib
          ? Math.round(data.metadata.payload.payload_target_kib)
          : undefined,
        script_content: templateMode === "upload" ? data.script_content || undefined : undefined,
        config_content: data.config_content || undefined,
      }
      await createTemplate(payload, token)
      setTemplateToast("Template saved successfully")
    } catch {
      setTemplateToast("Failed to save template")
    }
    setTemplateSaving(false)
    setTimeout(() => setTemplateToast(null), 3000)
  }

  const handleStopFromResult = async () => {
    setStopping(true)
    try {
      const res = await fetch("/api/backend/api/stop", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        // Delay reload to let backend persist final metrics
        setTimeout(() => window.location.reload(), 2000)
      }
    } catch {
      // Network error — try reload anyway
      setTimeout(() => window.location.reload(), 1000)
    }
    setStopping(false)
  }

  if (!ready || !user) return <Loading />
  if (loading) return <Loading text="Loading result..." />
  if (!data) return <Loading text="No result found." />

  const m = data.metrics
  const m2 = data.metrics_v2
  const ts = data.time_series ?? []
  const throughputSeries = buildThroughputSeries(ts)
  const hasBusinessThroughput = throughputSeries.some((point) => (point.business_rps ?? 0) > 0)
  const hasAuxiliaryThroughput = throughputSeries.some((point) => (point.auxiliary_rps ?? 0) > 0)
  const meta = data.metadata
  const httpBusinessQuality = qualityFlag(m2, "http_business")
  const latencyQuality = qualityFlag(m2, "latency_primary")
  const workerQuality = qualityFlag(m2, "workers")
  const workerArtifactQuality = qualityFlag(m2, "worker_artifacts")
  const checksQuality = qualityFlag(m2, "checks")
  const artifactCollection = meta?.artifact_collection
  const showArtifactCollectionWarning = Boolean(
    artifactCollection
    && artifactCollection.status
    && artifactCollection.status !== "complete",
  )

  const lat = m2
    ? {
        min: m2.latency_primary.min_ms,
        med: m2.latency_primary.med_ms,
        avg: m2.latency_primary.avg_ms,
        p90: m2.latency_primary.p90_ms,
        p95: m2.latency_primary.p95_ms,
        p99: m2.latency_primary.p99_ms,
        max: m2.latency_primary.max_ms,
      }
    : m
    ? {
        min: m.min_latency_ms,
        med: m.med_latency_ms,
        avg: m.avg_latency_ms,
        p90: m.p90_latency_ms,
        p95: m.p95_latency_ms,
        p99: m.p99_latency_ms,
        max: m.max_latency_ms,
      }
    : null

  const httpTotal = m2?.http_total.requests ?? ((m?.http_successes ?? 0) + (m?.http_failures ?? 0))
  const business2xx = m2?.http_business.status_2xx ?? m?.http_successes ?? 0
  const businessErr = m2?.http_business.failures ?? m?.http_failures ?? 0
  const business4xx = m2?.http_business.status_4xx ?? m?.status_4xx ?? 0
  const business5xx = m2?.http_business.status_5xx ?? m?.status_5xx ?? 0
  const businessOther = m2?.http_business.other_failures ?? Math.max(0, businessErr - business4xx - business5xx)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6 pb-10"
    >
      {/* ===== HEADER ===== */}
      <div className="relative z-[60]">
        <Section>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-text-primary section-heading">{data.project_name}</h1>
            {data.url && <p className="text-text-muted text-sm break-all mt-1">{data.url}</p>}
            {data.url && data.url.includes("target-lb") && (
              <p className="inline-alert inline-alert--warning text-xs mt-1 px-2.5 py-1 inline-block">
                This test ran against the built-in dummy service, not a real system under test.
              </p>
            )}
            <div className="flex flex-wrap gap-3 mt-3 text-xs text-text-muted">
              <span>Run ID: <span className="font-mono break-all">{data.id}</span></span>
              <span>Run by {data.run_by?.username ?? data.username ?? "system"}</span>
              <span>{new Date(data.created_at).toISOString().replace("T", " ").slice(0, 19)}</span>
              <StatusBadge status={data.status} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0 items-center">
            {templateToast && (
              <span className="inline-alert inline-alert--success px-3 py-1 text-xs font-medium">{templateToast}</span>
            )}
            <button
              onClick={() => router.push("/result")}
              className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
            >
              Back to Results
            </button>
            {/* Export Dropdown */}
            <div className="relative z-[70]">
              <button
                onClick={() => setExportOpen(!exportOpen)}
                className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition flex items-center gap-1.5"
              >
                Export
                <svg className={`w-3.5 h-3.5 transition-transform ${exportOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                  <div className="app-card absolute right-0 top-full mt-2 z-[80] border border-app-border rounded-xl shadow-lg py-1 min-w-[180px]">
                    <button
                      onClick={() => { exportJSON(data); setExportOpen(false) }}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-app-surface transition flex items-center gap-3"
                    >
                      <span className="status-badge status-badge--info px-1.5 py-0.5 text-xs font-mono">JSON</span>
                      <span>Full Data Export</span>
                    </button>
                    <button
                      onClick={() => { exportCSV(data); setExportOpen(false) }}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-app-surface transition flex items-center gap-3"
                    >
                      <span className="status-badge status-badge--success px-1.5 py-0.5 text-xs font-mono">CSV</span>
                      <span>Spreadsheet Data</span>
                    </button>
                    <button
                      onClick={() => { exportMarkdown(data); setExportOpen(false) }}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-app-surface transition flex items-center gap-3"
                    >
                      <span className="status-badge status-badge--warning px-1.5 py-0.5 text-xs font-mono">MD</span>
                      <span>Wiki / Confluence</span>
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={handleSaveAsTemplate}
              disabled={templateSaving}
              className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
            >
              {templateSaving ? "Saving..." : "Save as Template"}
            </button>
            <button
              onClick={() => {
                localStorage.setItem("k6-clone-test", JSON.stringify(buildRerunCloneData(data)))
                router.push("/load-test?clone=true")
              }}
              className="px-4 py-2 text-sm font-medium rounded-md bg-accent-primary text-white hover:bg-pink-700 transition disabled:opacity-50"
            >
              Re-Run Test
            </button>
            <button
              onClick={() => {
                const schedData: Record<string, unknown> = {
                  project_name: data.project_name,
                  name: data.project_name,
                }
                if (data.script_content) schedData.script_content = data.script_content
                if (data.config_content) schedData.config_content = data.config_content
                if (data.url) schedData.url = data.url
                if (!data.script_content) schedData.mode = "builder"
                if (data.metadata?.payload?.http_method || data.http_method) schedData.http_method = data.metadata?.payload?.http_method ?? data.http_method
                if (data.metadata?.payload?.content_type || data.content_type) schedData.content_type = data.metadata?.payload?.content_type ?? data.content_type
                if (data.payload_source_json) schedData.payload_json = data.payload_source_json
                if (data.metadata?.payload?.payload_target_kib) schedData.payload_target_kib = Math.round(data.metadata.payload.payload_target_kib)
                if (data.metadata?.stages) schedData.stages = data.metadata.stages
                localStorage.setItem("k6-schedule-test", JSON.stringify(schedData))
                router.push("/schedule/new?schedule=true")
              }}
              className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition"
            >
              Schedule
            </button>
          </div>
          </div>
        </Section>
      </div>

      {/* ===== TEST METADATA ===== */}
      {meta && (
        <Section title="Test Parameters">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Duration" value={fmtDuration(meta.duration_s)} />
            <Stat label="Workers" value={String(meta.worker_count)} />
            <Stat label="Started" value={new Date(meta.started_at).toLocaleTimeString()} />
            <Stat label="Ended" value={new Date(meta.ended_at).toLocaleTimeString()} />
          </div>
          {meta.payload && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider text-text-muted mb-2">Request Payload</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Method" value={meta.payload.http_method} />
                <Stat label="Content-Type" value={meta.payload.content_type} />
                <Stat label="Target Size" value={fmtBytes(meta.payload.payload_target_bytes)} />
                <Stat label="Actual Size" value={fmtBytes(meta.payload.payload_actual_bytes)} />
              </div>
            </div>
          )}
          {meta.auth && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider text-text-muted mb-2">Authentication</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Mode" value={meta.auth.mode ?? "N/A"} />
                <Stat label="Client Auth" value={meta.auth.client_auth_method ?? "N/A"} />
                <Stat label="Secret Source" value={meta.auth.secret_source ?? "N/A"} />
                <Stat label="Refresh Skew" value={meta.auth.refresh_skew_seconds != null ? `${meta.auth.refresh_skew_seconds}s` : "N/A"} />
              </div>
              {meta.auth.metrics_status && meta.auth.metrics_status !== "complete" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className={`status-badge ${
                    meta.auth.metrics_status === "aborted"
                      ? "status-badge--danger"
                      : meta.auth.metrics_status === "unavailable"
                        ? "status-badge--warning"
                        : "status-badge--neutral"
                  }`}>
                    {meta.auth.metrics_status}
                  </span>
                  {meta.auth.metrics_message && (
                    <span className="text-xs text-text-muted">{meta.auth.metrics_message}</span>
                  )}
                </div>
              )}
              {meta.auth.metrics?.abort_triggered && (
                <div className="mt-3 rounded-xl border border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] px-4 py-3 text-sm text-[var(--color-status-danger-text)]">
                  <div className="font-semibold">Authentication aborted the test run</div>
                  <div className="mt-1">
                    {meta.auth.metrics.abort_reason || "The token endpoint returned a terminal error and the run was stopped to protect the auth service."}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs">
                    <span>Cause: {meta.auth.metrics.abort_cause || "N/A"}</span>
                    <span>HTTP Status Codes: {fmtCodeList(meta.auth.metrics.abort_http_status_codes)}</span>
                    <span>Retryable: {meta.auth.metrics.abort_retryable ? "yes" : "no"}</span>
                  </div>
                </div>
              )}
              {meta.auth.metrics && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mt-4">
                  <Stat label="Token Requests" value={fmtNum(meta.auth.metrics.token_requests_total)} />
                  <Stat label="Token Success Rate" value={fmtPct(meta.auth.metrics.token_success_rate)} good={meta.auth.metrics.token_failure_total === 0 && meta.auth.metrics.token_requests_total > 0} bad={meta.auth.metrics.token_failure_total > 0} />
                  <Stat label="Token Avg" value={fmtMs(meta.auth.metrics.token_request_avg_ms)} />
                  <Stat label="Refreshes" value={fmtNum(meta.auth.metrics.token_refresh_total)} />
                  <Stat label="Reuse Events" value={fmtNum(meta.auth.metrics.token_reuse_hits_total)} />
                  <Stat label="Response Codes" value={formatStatusCodeCounts(meta.auth.metrics.response_status_codes)} bad={meta.auth.metrics.token_failure_total > 0} />
                </div>
              )}
              {meta.auth.token_url && (
                <div className="mt-3 text-xs text-text-muted break-all">{meta.auth.token_url}</div>
              )}
            </div>
          )}
          {meta.stages && meta.stages.length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider text-text-muted mb-2">Ramp-up Profile</div>
              <div className="flex flex-wrap gap-2">
                {meta.stages.map((s, i) => (
                  <span key={i} className="bg-app-surface px-3 py-1.5 rounded text-xs font-mono">
                    {s.duration} &rarr; {s.target} VUs
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {showArtifactCollectionWarning && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-950">
          <div className="flex flex-wrap items-center gap-2">
            <span className="status-badge status-badge--warning">
              {artifactCollection?.status === "partial" ? "partial worker artifacts" : "worker artifacts unavailable"}
            </span>
            {workerArtifactQuality && (
              <span className={qualityBadge(workerArtifactQuality)}>
                worker_artifacts: {workerArtifactQuality.status}
              </span>
            )}
          </div>
          <div className="mt-2 text-sm font-semibold">
            Worker summary artifacts are incomplete for this result.
          </div>
          <div className="mt-1 text-sm">
            Received {artifactCollection?.received_worker_summary_count ?? 0} of {artifactCollection?.expected_worker_count ?? meta?.worker_count ?? 0} expected worker summaries.
          </div>
          {artifactCollection?.missing_workers && artifactCollection.missing_workers.length > 0 && (
            <div className="mt-2 text-sm">
              Missing workers: <span className="font-mono">{artifactCollection.missing_workers.join(", ")}</span>
            </div>
          )}
          {workerArtifactQuality?.approximation_reason && (
            <div className="mt-2 text-xs text-amber-800">{workerArtifactQuality.approximation_reason}</div>
          )}
        </div>
      )}

      {m2 || m ? (
        <>
          <Section title="Executive Summary">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <Stat label="Total HTTP Requests" value={fmtNum(m2?.http_total.requests ?? m?.total_requests)} />
              <Stat label="Business Requests" value={fmtNum(m2?.http_business.requests ?? m?.total_requests)} />
              <Stat label="Auxiliary HTTP Requests" value={fmtNum(m2?.http_auxiliary.requests)} />
              <Stat label="Iterations" value={fmtNum(m2?.iterations.count ?? m?.iterations)} />
              <Stat label="Business Req/s" value={m2?.http_business.rps?.toFixed(1) ?? m?.rps?.toFixed(1) ?? "N/A"} />
              <Stat label="Business Success Rate" value={fmtPct(m2?.http_business.success_rate ?? m?.success_rate)} good={(m2?.http_business.error_rate ?? m?.error_rate ?? 0) === 0} bad={(m2?.http_business.error_rate ?? m?.error_rate ?? 0) > 0} />
              <Stat label="Data Received" value={fmtBytes(m2?.http_total.data_received_bytes ?? m?.data_received_bytes)} />
              <Stat label="Data Sent" value={fmtBytes(m2?.http_total.data_sent_bytes ?? m?.data_sent_bytes)} />
            </div>
          </Section>

          {httpTotal > 0 && (
            <Section title="HTTP Performance">
              {httpBusinessQuality && (
                <div className="mb-4 flex flex-wrap gap-2 text-xs">
                  <QualityPill label="http_business" flag={httpBusinessQuality} />
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
                <Stat label="Total HTTP" value={fmtNum(httpTotal)} />
                <Stat label="Business 2xx" value={fmtNum(business2xx)} good={business2xx > 0} />
                <Stat label="Business 4xx" value={fmtNum(business4xx)} bad={business4xx > 0} />
                <Stat label="Business 5xx" value={fmtNum(business5xx)} bad={business5xx > 0} />
                <Stat label="Other Business Failures" value={fmtNum(businessOther)} bad={businessOther > 0} />
                <Stat label="Auth Failures" value={fmtNum(m2?.http_auxiliary.failures ?? 0)} bad={(m2?.http_auxiliary.failures ?? 0) > 0} />
              </div>
              <div className="h-6 w-full rounded-full overflow-hidden flex bg-app-surface">
                {business2xx > 0 && (
                  <div
                    className="bg-green-500 h-full transition-all"
                    style={{ width: `${(business2xx / httpTotal) * 100}%` }}
                    title={`2xx: ${fmtNum(business2xx)}`}
                  />
                )}
                {business4xx > 0 && (
                  <div
                    className="bg-yellow-500 h-full transition-all"
                    style={{ width: `${(business4xx / httpTotal) * 100}%` }}
                    title={`4xx: ${fmtNum(business4xx)}`}
                  />
                )}
                {business5xx > 0 && (
                  <div
                    className="bg-red-500 h-full transition-all"
                    style={{ width: `${(business5xx / httpTotal) * 100}%` }}
                    title={`5xx: ${fmtNum(business5xx)}`}
                  />
                )}
                {businessOther > 0 && (
                  <div
                    className="h-full transition-all"
                    style={{ width: `${(businessOther / httpTotal) * 100}%`, background: ACCENT }}
                    title={`Other: ${fmtNum(businessOther)}`}
                  />
                )}
              </div>
              <div className="flex flex-wrap gap-4 mt-2 text-xs text-text-muted">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> 2xx ({fmtPct(httpTotal > 0 ? business2xx / httpTotal : 0)})</span>
                {business4xx > 0 && <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-yellow-500 inline-block" /> 4xx ({fmtPct(httpTotal > 0 ? business4xx / httpTotal : 0)})</span>}
                {business5xx > 0 && <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> 5xx ({fmtPct(httpTotal > 0 ? business5xx / httpTotal : 0)})</span>}
                {businessOther > 0 && <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: ACCENT }} /> Other ({fmtPct(httpTotal > 0 ? businessOther / httpTotal : 0)})</span>}
              </div>
            </Section>
          )}

          {lat && (
            <Section title="Primary Latency">
              {latencyQuality && (
                <div className="mb-4 flex flex-wrap gap-2 text-xs">
                  <QualityPill label="latency_primary" flag={latencyQuality} />
                </div>
              )}
              {latencyQuality?.approximation_reason && (
                <p className="text-xs text-text-muted mb-4">{latencyQuality.approximation_reason}</p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
                <Stat label="Min" value={fmtMs(lat.min)} />
                <Stat label="Median" value={fmtMs(lat.med)} />
                <Stat label="Average" value={fmtMs(lat.avg)} />
                <Stat label="P90" value={fmtMs(lat.p90)} />
                <Stat label="P95" value={fmtMs(lat.p95)} />
                <Stat label="P99" value={fmtMs(lat.p99)} />
                <Stat label="Max" value={fmtMs(lat.max)} />
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={[
                    { name: "Min", v: lat.min, fill: "#10B981" },
                    { name: "Med", v: lat.med, fill: "#6366F1" },
                    { name: "Avg", v: lat.avg, fill: "#3B82F6" },
                    { name: "P90", v: lat.p90, fill: "#F59E0B" },
                    { name: "P95", v: lat.p95, fill: "#F97316" },
                    { name: "P99", v: lat.p99, fill: "#EF4444" },
                    { name: "Max", v: lat.max, fill: "#7C3AED" },
                  ]}
                  barSize={36}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                  <XAxis dataKey="name" stroke={chart.axis} fontSize={11} />
                  <YAxis stroke={chart.axis} fontSize={11} tickFormatter={(v: number) => `${v.toFixed(0)}`} unit=" ms" />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toFixed(2)} ms`, "Latency"]} />
                  <Bar dataKey="v" radius={[4, 4, 0, 0]}>
                    {[
                      "#10B981", "#6366F1", "#3B82F6", "#F59E0B", "#F97316", "#EF4444", "#7C3AED",
                    ].map((c, i) => (
                      <Cell key={i} fill={c} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Section>
          )}

          {m2?.latency_breakdown && (
            <Section title="Latency Breakdown">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                <LatencyBreakdownCard title="Blocked" metric={m2.latency_breakdown.blocked} />
                <LatencyBreakdownCard title="Waiting" metric={m2.latency_breakdown.waiting} />
                <LatencyBreakdownCard title="Sending" metric={m2.latency_breakdown.sending} />
                <LatencyBreakdownCard title="Receiving" metric={m2.latency_breakdown.receiving} />
                <LatencyBreakdownCard title="Connecting" metric={m2.latency_breakdown.connecting} />
                <LatencyBreakdownCard title="TLS Handshaking" metric={m2.latency_breakdown.tls_handshaking} />
              </div>
            </Section>
          )}

          {ts.length > 2 && (
            <>
              <Section title="Latency Over Time">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={ts}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                    <XAxis dataKey="t" tickFormatter={fmtTime} stroke={chart.axis} fontSize={11} />
                    <YAxis stroke={chart.axis} fontSize={11} unit=" ms" />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(v: number) => `Time: ${fmtTime(v)}`}
                      formatter={(v: number, name: string) => [`${v.toFixed(1)} ms`, name]}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="avg_ms" name="Avg" stroke="#3B82F6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="p95_ms" name="P95" stroke="#F59E0B" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Section>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Section title="Request Rate Over Time">
                  <p className="text-xs text-text-muted mb-4">
                    Rates are derived from the delta between consecutive cumulative request counts. This makes the chart comparable to the final summary and avoids mixing a live snapshot rate with a cumulative counter.
                  </p>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={throughputSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                      <XAxis dataKey="t" tickFormatter={fmtTime} stroke={chart.axis} fontSize={11} />
                      <YAxis stroke={ACCENT} fontSize={11} tickFormatter={(v: number) => v.toFixed(0)} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(v: number) => fmtTime(v)}
                        formatter={(v: number, name: string) => [v.toFixed(1), name]}
                      />
                      <Legend />
                      <Line yAxisId={0} type="monotone" dataKey="total_http_rps" name="Total HTTP Req/s" stroke={ACCENT} strokeWidth={2} dot={false} />
                      {hasBusinessThroughput && (
                        <Line yAxisId={0} type="monotone" dataKey="business_rps" name="Business Req/s" stroke="#6366F1" strokeWidth={2} dot={false} />
                      )}
                      {hasAuxiliaryThroughput && (
                        <Line yAxisId={0} type="monotone" dataKey="auxiliary_rps" name="Auxiliary Req/s" stroke="#10B981" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </Section>

                <Section title="Cumulative Requests Over Time">
                  <p className="text-xs text-text-muted mb-4">
                    These counters are monotonic totals. They are useful for sanity-checking the run volume, but they should not be read as throughput.
                  </p>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={throughputSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                      <XAxis dataKey="t" tickFormatter={fmtTime} stroke={chart.axis} fontSize={11} />
                      <YAxis stroke={chart.axis} fontSize={11} tickFormatter={(v: number) => fmtNum(v)} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(v: number) => fmtTime(v)}
                        formatter={(v: number, name: string) => [fmtNum(v), name]}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="total_http_reqs" name="Total HTTP Requests (Cumulative)" stroke="#6366F1" strokeWidth={2} dot={false} />
                      {hasBusinessThroughput && (
                        <Line type="monotone" dataKey="business_http_reqs" name="Business Requests (Cumulative)" stroke={ACCENT} strokeWidth={2} dot={false} />
                      )}
                      {hasAuxiliaryThroughput && (
                        <Line type="monotone" dataKey="auxiliary_http_reqs" name="Auxiliary Requests (Cumulative)" stroke="#10B981" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </Section>
              </div>

              <Section title="Virtual Users Over Time">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={ts}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                    <XAxis dataKey="t" tickFormatter={fmtTime} stroke={chart.axis} fontSize={11} />
                    <YAxis stroke={chart.axis} fontSize={11} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(v: number) => fmtTime(v)} />
                    <Line type="monotone" dataKey="vus" name="VUs" stroke="#10B981" strokeWidth={2} dot={false} fill="#10B981" fillOpacity={0.1} />
                  </LineChart>
                </ResponsiveContainer>
              </Section>

              {/* Error Distribution Over Time — only when 4xx/5xx data exists */}
              {ts.some(p => (p.status_4xx ?? 0) > 0 || (p.status_5xx ?? 0) > 0) && (
                <Section title="Error Distribution Over Time">
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={ts}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                      <XAxis dataKey="t" tickFormatter={fmtTime} stroke={chart.axis} fontSize={11} />
                      <YAxis yAxisId="count" stroke={chart.axis} fontSize={11} />
                      <YAxis yAxisId="rate" orientation="right" stroke={chart.axis} fontSize={11} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(v: number) => `Time: ${fmtTime(v)}`}
                        formatter={(v: number, name: string) => {
                          if (name === "Error Rate") return [`${(v * 100).toFixed(2)}%`, name]
                          return [Math.round(v).toLocaleString("de-DE"), name]
                        }}
                      />
                      <Legend />
                      <Line yAxisId="count" type="monotone" dataKey="status_4xx" name="4xx" stroke="#EAB308" strokeWidth={2} dot={false} />
                      <Line yAxisId="count" type="monotone" dataKey="status_5xx" name="5xx" stroke="#EF4444" strokeWidth={2} dot={false} />
                      <Line yAxisId="rate" type="monotone" dataKey="err_rate" name="Error Rate" stroke={ACCENT} strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                    </LineChart>
                  </ResponsiveContainer>
                </Section>
              )}
            </>
          )}

          {(m2?.thresholds?.length ?? 0) > 0 && (
            <Section title="k6 Thresholds">
              {checksQuality && (
                <div className="mb-4 flex flex-wrap gap-2 text-xs">
                  <QualityPill label="checks" flag={checksQuality} />
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                {m2!.thresholds!.map((th) => (
                  <span
                    key={th.metric}
                    className={`status-badge inline-flex items-center gap-1.5 px-3 py-1.5 text-xs ${
                      th.passed ? "status-badge--success" : "status-badge--danger"
                    }`}
                  >
                    {th.passed ? "\u2713" : "\u2717"} {th.metric}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {(m2?.workers?.length ?? 0) > 0 && (
            <Section title="Worker Breakdown">
              {(workerQuality || workerArtifactQuality) && (
                <div className="mb-4 flex flex-wrap gap-2 text-xs">
                  {workerQuality && <QualityPill label="workers" flag={workerQuality} />}
                  {workerArtifactQuality && <QualityPill label="worker_artifacts" flag={workerArtifactQuality} />}
                </div>
              )}
              {workerQuality?.approximation_reason && (
                <p className="text-xs text-text-muted mb-4">{workerQuality.approximation_reason}</p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-text-muted uppercase text-xs tracking-wider border-b border-app-border">
                      <th className="pb-3 pr-4"><InfoLabel label="Worker" info="Worker identity for the generator node that produced this summary row." /></th>
                      <th className="pb-3 pr-4"><InfoLabel label="Status" info="Worker health as seen by the controller when the summary was built." /></th>
                      <th className="pb-3 pr-4"><InfoLabel label="HTTP Requests" /></th>
                      <th className="pb-3 pr-4"><InfoLabel label="Business" /></th>
                      <th className="pb-3 pr-4"><InfoLabel label="Auxiliary" /></th>
                      <th className="pb-3 pr-4"><InfoLabel label="Avg" /></th>
                      <th className="pb-3 pr-4"><InfoLabel label="P95" /></th>
                      <th className="pb-3 pr-4"><InfoLabel label="Error Rate" /></th>
                      <th className="pb-3 pr-4"><InfoLabel label="Active Window" /></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-app-border">
                    {m2!.workers!.map((w) => (
                      <tr key={w.address}>
                        <td className="py-3 pr-4 font-mono text-xs">{w.address.replace(/:6565$/, "")}</td>
                        <td className="py-3 pr-4">
                          <span className={`status-badge px-2 py-0.5 text-xs ${
                            w.status === "ok" || w.status === "running" ? "status-badge--success" : "status-badge--neutral"
                          }`}>
                            {w.status}
                          </span>
                        </td>
                        <td className="py-3 pr-4">{fmtNum(w.requests)}</td>
                        <td className="py-3 pr-4">{fmtNum(w.business_requests)}</td>
                        <td className="py-3 pr-4">{fmtNum(w.auxiliary_requests)}</td>
                        <td className="py-3 pr-4">{fmtMs(w.avg_latency_ms)}</td>
                        <td className="py-3 pr-4">{fmtMs(w.p95_latency_ms)}</td>
                        <td className="py-3 pr-4">{fmtPct(w.error_rate)}</td>
                        <td className="py-3 pr-4">{fmtDuration(w.active_duration_s)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </>
      ) : (
        <Section>
          {data.status === "running" ? (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-text-muted text-sm">
                  Test is still running. Metrics will appear once complete.
                </span>
              </div>
              <button
                onClick={handleStopFromResult}
                disabled={stopping}
                className="px-4 py-2 text-sm font-medium rounded-md text-white hover:opacity-90 transition disabled:opacity-50"
                style={{ background: "#E20074" }}
              >
                {stopping ? "Stopping..." : "Stop Test"}
              </button>
            </div>
          ) : (
            <div className="text-text-muted text-sm">
              No metrics data available for this test.
            </div>
          )}
        </Section>
      )}

      {/* ===== CONFLICT WARNINGS ===== */}
      {data.warnings && data.warnings.length > 0 && (
        <div className="surface-panel surface-panel--warning p-5 space-y-2">
          <h2 className="text-sm font-semibold mb-2">Conflict Warnings</h2>
          {data.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="status-badge status-badge--warning shrink-0 mt-0.5 w-4 h-4 px-0 flex items-center justify-center font-bold text-[10px]">!</span>
              <div>
                <span className="font-medium uppercase text-[10px] tracking-wider">{w.type}</span>
                <span className="ml-1">{w.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== K6 SUMMARY (Parsed Visualization) ===== */}
      {data.summary_content && <SummaryView content={data.summary_content} />}

      {/* ===== SCRIPT & CONFIG SNAPSHOTS ===== */}
      {(data.script_content || data.config_content || data.payload_source_json || data.payload_content || data.auth_summary_content) && (
        <Section title="Test Artifacts">
          <div className="space-y-4">
            {data.script_content && (
              <SnapshotBlock title="k6 Script" content={data.script_content} language="javascript" />
            )}
            {data.config_content && (
              <SnapshotBlock
                title="Config (JSON)"
                content={(() => {
                  try { return JSON.stringify(JSON.parse(data.config_content), null, 2) }
                  catch { return data.config_content }
                })()}
                language="json"
              />
            )}
            {data.payload_source_json && (
              <SnapshotBlock
                title="Payload Source (JSON)"
                content={(() => {
                  try { return JSON.stringify(JSON.parse(data.payload_source_json), null, 2) }
                  catch { return data.payload_source_json }
                })()}
                language="json"
              />
            )}
            {data.payload_content && (
              <SnapshotBlock
                title="Final Request Payload (JSON)"
                content={(() => {
                  try { return JSON.stringify(JSON.parse(data.payload_content), null, 2) }
                  catch { return data.payload_content }
                })()}
                language="json"
              />
            )}
            {data.auth_summary_content && (
              <SnapshotBlock
                title="Authentication Summary (JSON)"
                content={data.auth_summary_content}
                language="json"
              />
            )}
          </div>
        </Section>
      )}
    </motion.div>
  )
}

/* ---------- sub-components ---------- */

function Loading({ text = "Loading..." }: { text?: string }) {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="text-sm text-text-muted">{text}</div>
    </div>
  )
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="app-card border border-app-border shadow-card p-6 rounded-xl">
      {title && <h2 className="text-lg font-semibold mb-4 text-accent-primary">{title}</h2>}
      {children}
    </div>
  )
}

function InfoLabel({ label, info }: { label: string; info?: string }) {
  const resolvedInfo = info ?? metricInfo(label)
  if (!resolvedInfo) {
    return <>{label}</>
  }

  return (
    <span className="group/metric-info relative inline-flex items-center gap-1">
      <span>{label}</span>
      <span className="status-badge status-badge--info h-4 min-w-4 px-1 text-[10px] leading-none">i</span>
      <span className="pointer-events-none absolute left-0 top-full z-[90] mt-2 hidden w-72 rounded-xl border border-app-border bg-[var(--color-chart-tooltip-bg)] px-3 py-2 text-left text-[11px] normal-case font-normal tracking-normal text-[var(--color-chart-tooltip-text)] shadow-lg group-hover/metric-info:block">
        {resolvedInfo}
      </span>
    </span>
  )
}

function QualityPill({ label, flag }: { label: string; flag: MetricQualityFlag }) {
  const info = qualityInfo(label, flag)
  return (
    <span className={`group/quality relative ${qualityBadge(flag)} px-2 py-1`}>
      {label}: {flag.status}
      {info && (
        <span className="pointer-events-none absolute left-0 top-full z-[90] mt-2 hidden w-80 rounded-xl border border-app-border bg-[var(--color-chart-tooltip-bg)] px-3 py-2 text-left text-[11px] normal-case font-normal tracking-normal text-[var(--color-chart-tooltip-text)] shadow-lg group-hover/quality:block">
          {info}
        </span>
      )}
    </span>
  )
}

function Stat({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  let color = "text-accent-primary"
  if (good) color = "status-text--success"
  if (bad) color = "status-text--danger"
  return (
    <div className="bg-app-surface rounded-lg p-3">
      <div className="text-xs uppercase tracking-wider text-text-muted mb-1">
        <InfoLabel label={label} />
      </div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  )
}

function SnapshotBlock({ title, content, language }: { title: string; content: string; language: string }) {
  const [expanded, setExpanded] = useState(false)
  const lines = content.split("\n")
  const preview = lines.slice(0, 15).join("\n")
  const needsExpand = lines.length > 15

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wider text-text-muted">{title}</div>
        {needsExpand && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-accent-primary hover:underline"
          >
            {expanded ? "Collapse" : `Show all (${lines.length} lines)`}
          </button>
        )}
      </div>
      <pre className="border border-app-border bg-app-surface text-text-primary font-mono text-xs p-4 rounded-md overflow-auto max-h-96">
        {expanded ? content : preview}
        {!expanded && needsExpand && "\n..."}
      </pre>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "completed"
      ? "status-badge status-badge--success"
      : status === "error"
      ? "status-badge status-badge--danger"
      : "status-badge status-badge--warning"
  return <span className={`px-2 py-0.5 font-semibold ${cls}`}>{status}</span>
}

function LatencyBreakdownCard({ title, metric }: { title: string; metric: BreakdownMetricBlock }) {
  return (
    <div className="bg-app-surface rounded-lg p-4 border border-app-border">
      <div className="text-xs uppercase tracking-wider text-text-muted mb-2">
        <InfoLabel label={title} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Avg" value={fmtMs(metric.avg_ms)} />
        <Stat label="P95" value={fmtMs(metric.p95_ms)} />
        <Stat label="P99" value={fmtMs(metric.p99_ms)} />
        <Stat label="Max" value={fmtMs(metric.max_ms)} />
      </div>
    </div>
  )
}

/* ---------- SummaryView: parsed k6 handleSummary visualization ---------- */

interface K6SummaryMetric {
  type: string
  contains: string
  values: Record<string, number>
  thresholds?: Record<string, { ok: boolean }>
}

interface K6SummaryCheck {
  name: string
  path: string
  passes: number
  fails: number
}

interface K6SummaryGroup {
  name: string
  path: string
  groups: K6SummaryGroup[]
  checks: K6SummaryCheck[]
}

interface K6SummaryWorker {
  name: string
  metrics: Record<string, K6SummaryMetric>
  root_group: K6SummaryGroup
  state: { testRunDurationMs: number }
}

function parseSummaryContent(content: string): K6SummaryWorker[] {
  const workers: K6SummaryWorker[] = []
  const blocks = content.split(/^--- (\S+) ---$/m)
  // blocks: ["", "worker1", "{json}", "", "worker2", "{json}", ...]
  for (let i = 1; i < blocks.length; i += 2) {
    const name = blocks[i]?.trim()
    const json = blocks[i + 1]?.trim()
    if (!name || !json) continue
    try {
      const parsed = JSON.parse(json)
      workers.push({ name, ...parsed })
    } catch { /* skip unparseable */ }
  }
  return workers
}

function collectChecks(group: K6SummaryGroup): K6SummaryCheck[] {
  const checks = [...group.checks]
  for (const g of group.groups) {
    checks.push(...collectChecks(g))
  }
  return checks
}

function SummaryView({ content }: { content: string }) {
  const [showRaw, setShowRaw] = useState(false)
  const workers = parseSummaryContent(content)

  if (workers.length === 0) {
    return (
      <Section title="k6 Summary">
        <SnapshotBlock title="Raw Output" content={content} language="json" />
      </Section>
    )
  }

  // Aggregate checks across all workers
  const allChecks = new Map<string, { passes: number; fails: number }>()
  for (const w of workers) {
    for (const c of collectChecks(w.root_group)) {
      const prev = allChecks.get(c.name) ?? { passes: 0, fails: 0 }
      allChecks.set(c.name, { passes: prev.passes + c.passes, fails: prev.fails + c.fails })
    }
  }

  // Aggregate thresholds across workers (all workers have the same thresholds)
  const thresholds: { name: string; metric: string; ok: boolean }[] = []
  const seenThresholds = new Set<string>()
  for (const w of workers) {
    for (const [metricName, metric] of Object.entries(w.metrics)) {
      if (!metric.thresholds) continue
      for (const [thName, th] of Object.entries(metric.thresholds)) {
        const key = `${metricName}:${thName}`
        if (seenThresholds.has(key)) {
          // If any worker fails the threshold, mark as failed
          const existing = thresholds.find(t => t.name === thName && t.metric === metricName)
          if (existing && !th.ok) existing.ok = false
          continue
        }
        seenThresholds.add(key)
        thresholds.push({ name: thName, metric: metricName, ok: th.ok })
      }
    }
  }

  // Per-worker latency comparison data
  const workerComparison = workers.map(w => {
    const dur = w.metrics["http_req_duration"]
    const reqs = w.metrics["http_reqs"]
    const failed = w.metrics["http_req_failed"]
    return {
      name: w.name,
      requests: reqs?.values?.count ?? 0,
      rps: reqs?.values?.rate ?? 0,
      avg: dur?.values?.avg ?? 0,
      med: dur?.values?.med ?? 0,
      min: dur?.values?.min ?? 0,
      max: dur?.values?.max ?? 0,
      p90: dur?.values?.["p(90)"] ?? 0,
      p95: dur?.values?.["p(95)"] ?? 0,
      p99: dur?.values?.["p(99)"] ?? 0,
      errorRate: failed?.values?.rate ?? 0,
      duration: w.state?.testRunDurationMs ?? 0,
    }
  })

  return (
    <>
      <Section title="k6 Summary Drilldown">
        <div className="text-xs text-text-muted mb-4">
          Parsed worker-level handleSummary artifacts. This section is a drilldown and no longer computes competing global KPIs.
        </div>

        {allChecks.size > 0 && (
          <div className="mb-6">
            <div className="text-xs uppercase tracking-wider text-text-muted mb-3">Checks</div>
            <div className="flex flex-wrap gap-2">
              {Array.from(allChecks.entries()).map(([name, { passes, fails }]) => {
                const total = passes + fails
                const passed = fails === 0
                return (
                  <div
                    key={name}
                    className={`status-badge flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${
                      passed ? "status-badge--success" : "status-badge--danger"
                    }`}
                  >
                    <span className="text-sm">{passed ? "\u2713" : "\u2717"}</span>
                    <span>{name}</span>
                    <span className="text-[10px] opacity-70">
                      {passes}/{total}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {thresholds.length > 0 && (
          <div className="mb-6">
            <div className="text-xs uppercase tracking-wider text-text-muted mb-3">Thresholds</div>
            <div className="flex flex-wrap gap-2">
              {thresholds.map((th, i) => (
                <div
                  key={i}
                  className={`status-badge flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${
                    th.ok ? "status-badge--success" : "status-badge--danger"
                  }`}
                >
                  <span className="text-sm">{th.ok ? "\u2713" : "\u2717"}</span>
                  <span className="font-mono">{th.name}</span>
                  <span className="text-[10px] opacity-60">({th.metric.replace("http_req_", "").replace(/_/g, " ")})</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {workerComparison.length > 0 && (
          <div className="mb-4">
            <div className="text-xs uppercase tracking-wider text-text-muted mb-3">Per-Worker Comparison</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted uppercase text-xs tracking-wider border-b border-app-border">
                    <th className="pb-3 pr-4">Worker</th>
                    <th className="pb-3 pr-4 text-right">Requests</th>
                    <th className="pb-3 pr-4 text-right">Req/s</th>
                    <th className="pb-3 pr-4 text-right">Avg</th>
                    <th className="pb-3 pr-4 text-right">Med</th>
                    <th className="pb-3 pr-4 text-right">P90</th>
                      <th className="pb-3 pr-4 text-right">P95</th>
                      <th className="pb-3 pr-4 text-right">P99</th>
                      <th className="pb-3 pr-4 text-right">Max</th>
                      <th className="pb-3 pr-4 text-right">Errors</th>
                      <th className="pb-3 pr-4 text-right">Active Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-app-border">
                  {workerComparison.map(w => (
                    <tr key={w.name}>
                      <td className="py-3 pr-4 font-mono text-xs font-medium">{w.name}</td>
                      <td className="py-3 pr-4 text-right">{fmtNum(w.requests)}</td>
                      <td className="py-3 pr-4 text-right">{w.rps.toFixed(1)}</td>
                      <td className="py-3 pr-4 text-right">{fmtMs(w.avg)}</td>
                      <td className="py-3 pr-4 text-right">{fmtMs(w.med)}</td>
                      <td className="py-3 pr-4 text-right">{fmtMs(w.p90)}</td>
                      <td className="py-3 pr-4 text-right">{fmtMs(w.p95)}</td>
                      <td className="py-3 pr-4 text-right">{fmtMs(w.p99)}</td>
                      <td className="py-3 pr-4 text-right">{fmtMs(w.max)}</td>
                      <td className="py-3 pr-4 text-right">
                        <span className={w.errorRate > 0 ? "status-text--danger font-semibold" : "status-text--success"}>
                          {fmtPct(w.errorRate)}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right">{fmtDuration(w.duration / 1000)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-xs text-accent-primary hover:underline"
          >
            {showRaw ? "Hide raw JSON" : "Show raw JSON"}
          </button>
          {showRaw && (
            <pre className="mt-2 border border-app-border bg-app-surface text-text-primary font-mono text-xs p-4 rounded-md overflow-auto max-h-96">
              {content}
            </pre>
          )}
        </div>
      </Section>
    </>
  )
}

