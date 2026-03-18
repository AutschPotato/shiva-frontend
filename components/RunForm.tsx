"use client"

import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "@/context/SessionContext"
import {
  AuthConfigSection,
  buildAuthPayload,
  createDefaultAuthInput,
  hydrateAuthInput,
  validateAuthInput,
} from "@/components/AuthConfigSection"
import { FormSubSection, FormSubSectionContent, FormSubSectionTitle } from "@/components/FormSubSection"
import { listTemplates, createTemplate, type AuthInput, type Template, type TemplatePayload } from "@/lib/api"

const API_BASE = "/api/backend"

interface Stage {
  duration: string
  target: number
}

interface ThresholdResult {
  metric: string
  passed: boolean
}

interface ActiveRunNotice {
  testId: string
  phase: string
}

type StepState = "pending" | "running" | "done" | "error"
type RunSteps = Record<string, StepState>

type ExecutorType = "ramping-vus" | "constant-vus" | "constant-arrival-rate" | "ramping-arrival-rate"
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
type EnvVarEntry = { key: string; value: string }

const VALID_EXECUTORS: ExecutorType[] = [
  "ramping-vus",
  "constant-vus",
  "constant-arrival-rate",
  "ramping-arrival-rate",
]

const VALID_HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"]
const SENSITIVE_GENERATED_ENV_KEYS = new Set(["AUTH_CLIENT_SECRET"])
const BUILDER_CONFIG_ENV_KEYS = new Set([
  "TARGET_URL",
  "HTTP_METHOD",
  "CONTENT_TYPE",
  "PAYLOAD_SOURCE_JSON",
  "PAYLOAD_TARGET_BYTES",
  "AUTH_ENABLED",
  "AUTH_MODE",
  "AUTH_TOKEN_URL",
  "AUTH_CLIENT_ID",
  "AUTH_CLIENT_SECRET",
  "AUTH_CLIENT_AUTH_METHOD",
  "AUTH_REFRESH_SKEW_SECONDS",
  "AUTH_RETRY_LIMIT",
  "AUTH_RETRYABLE_STATUS_CODES",
  "AUTH_MAX_JITTER_MS",
  "AUTH_TOKEN_TIMEOUT",
])

function methodAllowsPayload(method: HttpMethod) {
  return method !== "GET"
}

function isArrivalRateExecutor(executor: ExecutorType) {
  return executor === "constant-arrival-rate" || executor === "ramping-arrival-rate"
}

function serializePayloadJson(source: string) {
  const parsed = JSON.parse(source)
  const serialized = JSON.stringify(parsed)
  const bytes = new TextEncoder().encode(serialized).length
  const isObjectPayload = !!parsed && !Array.isArray(parsed) && typeof parsed === "object"

  return { serialized, bytes, isObjectPayload }
}

function calculatePayloadPreview(method: HttpMethod, payloadJson: string, payloadTargetKiB: number) {
  const targetBytes = payloadTargetKiB > 0 ? payloadTargetKiB * 1024 : 0

  if (!methodAllowsPayload(method)) {
    return {
      enabled: false,
      serializedBytes: 0,
      serializedKB: 0,
      serializedKiB: 0,
      targetBytes,
      targetKB: targetBytes / 1000,
      targetKiB: targetBytes / 1024,
      autoPadding: false,
      exact: targetBytes === 0,
      error: undefined as string | undefined,
    }
  }

  const effectiveSource = payloadJson.trim() || (targetBytes > 0 ? "{}" : "")
  if (!effectiveSource) {
    return {
      enabled: true,
      serializedBytes: 0,
      serializedKB: 0,
      serializedKiB: 0,
      targetBytes,
      targetKB: targetBytes / 1000,
      targetKiB: targetBytes / 1024,
      autoPadding: false,
      exact: targetBytes === 0,
      error: undefined as string | undefined,
    }
  }

  try {
    const serialized = serializePayloadJson(effectiveSource)
    let error: string | undefined
    let autoPadding = false
    let exact = targetBytes === 0 || serialized.bytes === targetBytes

    if (targetBytes > 0) {
      if (serialized.bytes > targetBytes) {
        error = "Target size is smaller than the minimum serialized JSON payload size"
      } else if (!serialized.isObjectPayload && serialized.bytes !== targetBytes) {
        error = "Exact auto-padding requires a JSON object payload"
      } else if (serialized.bytes < targetBytes) {
        autoPadding = true
      }
      exact = serialized.bytes === targetBytes
    }

    return {
      enabled: true,
      serializedBytes: serialized.bytes,
      serializedKB: serialized.bytes / 1000,
      serializedKiB: serialized.bytes / 1024,
      targetBytes,
      targetKB: targetBytes / 1000,
      targetKiB: targetBytes / 1024,
      autoPadding,
      exact,
      error,
    }
  } catch {
    return {
      enabled: true,
      serializedBytes: 0,
      serializedKB: 0,
      serializedKiB: 0,
      targetBytes,
      targetKB: targetBytes / 1000,
      targetKiB: targetBytes / 1024,
      autoPadding: false,
      exact: false,
      error: "Payload JSON must be valid JSON",
    }
  }
}

function extractEnvKeys(script: string): string[] {
  const matches = script.matchAll(/__ENV\.(\w+)/g)
  const keys = new Set<string>()
  for (const match of matches) keys.add(match[1])
  return Array.from(keys)
}

function parseDurationToSeconds(duration: string) {
  if (duration.endsWith("s")) return parseInt(duration.replace("s", ""))
  if (duration.endsWith("m")) return parseInt(duration.replace("m", "")) * 60
  return 0
}

function createAuthHeaders(token?: string | null, includeJsonContentType = false): Record<string, string> {
  const headers: Record<string, string> = {}
  if (includeJsonContentType) headers["Content-Type"] = "application/json"
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function formatRunPhaseLabel(phase?: string) {
  switch ((phase || "").toLowerCase()) {
    case "script":
      return "Preparing Script"
    case "workers":
      return "Preparing Workers"
    case "running":
      return "Generating Load"
    case "collecting":
      return "Collecting Results"
    case "done":
      return "Completed"
    case "error":
      return "Failed"
    default:
      return phase || "Unknown"
  }
}

function buildBuilderEnvContract(args: {
  url: string
  httpMethod: HttpMethod
  contentType: string
  payloadJson: string
  payloadTargetKiB: number
  auth: AuthInput
}) {
  const envBlock: Record<string, string> = {
    HTTP_METHOD: args.httpMethod,
    CONTENT_TYPE: args.contentType || "application/json",
    PAYLOAD_SOURCE_JSON: methodAllowsPayload(args.httpMethod) ? args.payloadJson : "",
    PAYLOAD_TARGET_BYTES: String(methodAllowsPayload(args.httpMethod) ? Math.max(0, args.payloadTargetKiB) * 1024 : 0),
    AUTH_ENABLED: args.auth.auth_enabled ? "true" : "false",
  }

  if (args.url.trim()) envBlock.TARGET_URL = args.url.trim()

  if (args.auth.auth_enabled) {
    envBlock.AUTH_MODE = args.auth.auth_mode?.trim() || "oauth_client_credentials"
    envBlock.AUTH_TOKEN_URL = args.auth.auth_token_url?.trim() || ""
    envBlock.AUTH_CLIENT_ID = args.auth.auth_client_id?.trim() || ""
    envBlock.AUTH_CLIENT_SECRET = args.auth.auth_client_secret?.trim() || ""
    envBlock.AUTH_CLIENT_AUTH_METHOD = args.auth.auth_client_auth_method?.trim() || "basic"
    envBlock.AUTH_REFRESH_SKEW_SECONDS = String(Math.max(1, args.auth.auth_refresh_skew_seconds || 30))
    envBlock.AUTH_RETRY_LIMIT = "1"
    envBlock.AUTH_RETRYABLE_STATUS_CODES = "408,429,502,503,504"
    envBlock.AUTH_MAX_JITTER_MS = "5000"
    envBlock.AUTH_TOKEN_TIMEOUT = "10s"
  }

  return envBlock
}

function buildMissingBuilderRuntimeItems(args: {
  url: string
  auth: AuthInput
}) {
  const missing: string[] = []

  if (!args.url.trim()) {
    missing.push("TARGET_URL is required")
  }

  if (args.auth.auth_enabled) {
    if (!args.auth.auth_token_url?.trim()) {
      missing.push("AUTH_TOKEN_URL is required")
    }
    if (!args.auth.auth_client_id?.trim()) {
      missing.push("AUTH_CLIENT_ID is required")
    }
    if (!args.auth.auth_client_secret?.trim()) {
      missing.push("AUTH_CLIENT_SECRET is required")
    }
  }

  return missing
}

function hasNonEnvConfigKeys(configContent: string) {
  if (!configContent.trim()) return false
  try {
    const parsed = JSON.parse(configContent)
    return Object.keys(parsed || {}).some((key) => key !== "env")
  } catch {
    return false
  }
}

function buildConfigContent(
  args: {
    mode: "builder" | "upload"
    configPreview: string
    builderConfigPreview: string
    envVars: { key: string; value: string }[]
    url: string
    httpMethod: HttpMethod
    contentType: string
    payloadJson: string
    payloadTargetKiB: number
    auth: AuthInput
  },
) {
  const activeEnvVars = args.envVars.filter((ev) => ev.key.trim() && ev.value.trim())
  const effectiveConfig = args.mode === "builder"
    ? (hasNonEnvConfigKeys(args.configPreview) ? args.configPreview : args.builderConfigPreview)
    : args.configPreview
  const generatedEnvVars = args.mode === "builder"
    ? buildBuilderEnvContract({
        url: args.url,
        httpMethod: args.httpMethod,
        contentType: args.contentType,
        payloadJson: args.payloadJson,
        payloadTargetKiB: args.payloadTargetKiB,
        auth: args.auth,
      })
    : {}

  if (!effectiveConfig && activeEnvVars.length === 0 && Object.keys(generatedEnvVars).length === 0) return undefined

  let configObj: Record<string, any> = {}
  if (effectiveConfig) {
    try {
      configObj = JSON.parse(effectiveConfig)
    } catch {
      configObj = {}
    }
  }

  if (Object.keys(generatedEnvVars).length > 0 || activeEnvVars.length > 0) {
    const envBlock: Record<string, string> = configObj.env ?? {}
    for (const [key, value] of Object.entries(generatedEnvVars)) envBlock[key] = value
    for (const ev of activeEnvVars) envBlock[ev.key.trim()] = ev.value
    configObj.env = envBlock
  }

  return JSON.stringify(configObj)
}

function buildRunRequestBody(args: {
  mode: "builder" | "upload"
  projectName: string
  url: string
  executor: ExecutorType
  httpMethod: HttpMethod
  contentType: string
  payloadJson: string
  payloadTargetKiB: number
  stages: Stage[]
  vus: number
  duration: string
  rate: number
  timeUnit: string
  preAllocatedVUs: number
  maxVUs: number
  sleepSeconds: number
  scriptPreview: string
  configPreview: string
  builderConfigPreview: string
  auth: AuthInput
  envVars: { key: string; value: string }[]
}) {
  const body: Record<string, any> = { project_name: args.projectName }

  if (args.mode === "builder") {
    body.url = args.url
    body.executor = args.executor
    body.http_method = args.httpMethod
    body.content_type = args.contentType

    if (args.executor === "ramping-vus" || args.executor === "ramping-arrival-rate") {
      body.stages = args.stages
    }
    if (args.executor === "constant-vus") {
      body.vus = args.vus
      body.duration = args.duration
    }
    if (args.executor === "constant-arrival-rate") {
      body.rate = args.rate
      body.time_unit = args.timeUnit
      body.duration = args.duration
      body.pre_allocated_vus = args.preAllocatedVUs
      body.max_vus = args.maxVUs
    }
    if (args.executor === "ramping-arrival-rate") {
      body.time_unit = args.timeUnit
      body.pre_allocated_vus = args.preAllocatedVUs
      body.max_vus = args.maxVUs
    }
    if (args.executor === "ramping-vus" || args.executor === "constant-vus") {
      body.sleep_seconds = args.sleepSeconds
    }
    if (methodAllowsPayload(args.httpMethod)) {
      if (args.payloadJson.trim()) {
        body.payload_json = args.payloadJson
      }
      if (args.payloadTargetKiB > 0) {
        body.payload_target_kib = args.payloadTargetKiB
      }
    }
    const auth = buildAuthPayload(args.auth, { mode: "runtime" })
    if (auth) {
      body.auth = auth
    }
  } else {
    body.script_content = args.scriptPreview
  }

  const configContent = buildConfigContent({
    mode: args.mode,
    configPreview: args.configPreview,
    builderConfigPreview: args.builderConfigPreview,
    envVars: args.envVars,
    url: args.url,
    httpMethod: args.httpMethod,
    contentType: args.contentType,
    payloadJson: args.payloadJson,
    payloadTargetKiB: args.payloadTargetKiB,
    auth: args.auth,
  })
  if (configContent) {
    body.config_content = configContent
  }

  return body
}

function buildLiveLogLine(metrics: any): string {
  let logLine = `VUs: ${metrics.total_vus} | RPS: ${(metrics.rps || 0).toFixed(1)} | Avg: ${(metrics.avg_latency_ms || 0).toFixed(0)}ms | P95: ${(metrics.p95_latency_ms || 0).toFixed(0)}ms | Errors: ${((metrics.error_rate || 0) * 100).toFixed(1)}%`
  if ((metrics.status_4xx || 0) > 0 || (metrics.status_5xx || 0) > 0) {
    logLine += ` | 4xx: ${metrics.status_4xx || 0} · 5xx: ${metrics.status_5xx || 0}`
  }
  return logLine
}

function calculateRunDurationSeconds(
  mode: "builder" | "upload",
  executor: ExecutorType,
  stages: Stage[],
  duration: string,
) {
  if (mode !== "builder") return 120
  if (executor === "ramping-vus" || executor === "ramping-arrival-rate") {
    return stages.reduce((acc, stage) => acc + parseDurationToSeconds(stage.duration), 0) || 120
  }
  return parseDurationToSeconds(duration) || 120
}

function normalizeConfigEnvValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return ""
  }
}

function parseConfigEnv(configContent?: string): Record<string, string> {
  if (!configContent) return {}
  try {
    const parsed = JSON.parse(configContent)
    const env = parsed?.env
    if (!env || typeof env !== "object" || Array.isArray(env)) return {}

    const normalized: Record<string, string> = {}
    for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
      normalized[key] = normalizeConfigEnvValue(value)
    }
    return normalized
  } catch {
    return {}
  }
}

function parsePayloadTargetKiBFromEnv(value?: string) {
  const bytes = Number(value || 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return 0
  return bytes / 1024
}

function hydrateBuilderRuntimeFromConfig(configContent?: string) {
  const env = parseConfigEnv(configContent)
  const auth = createDefaultAuthInput()

  if ((env.AUTH_ENABLED || "").toLowerCase() === "true") {
    auth.auth_enabled = true
    auth.auth_mode = env.AUTH_MODE?.trim() || auth.auth_mode
    auth.auth_token_url = env.AUTH_TOKEN_URL || ""
    auth.auth_client_id = env.AUTH_CLIENT_ID || ""
    auth.auth_client_secret = env.AUTH_CLIENT_SECRET || ""
    auth.auth_client_auth_method = env.AUTH_CLIENT_AUTH_METHOD || auth.auth_client_auth_method
    auth.auth_refresh_skew_seconds = Math.max(1, Number(env.AUTH_REFRESH_SKEW_SECONDS || auth.auth_refresh_skew_seconds) || auth.auth_refresh_skew_seconds)
  }

  return {
    url: env.TARGET_URL || "",
    httpMethod: VALID_HTTP_METHODS.includes((env.HTTP_METHOD || "").toUpperCase() as HttpMethod)
      ? (env.HTTP_METHOD.toUpperCase() as HttpMethod)
      : undefined,
    contentType: env.CONTENT_TYPE || "",
    payloadJson: env.PAYLOAD_SOURCE_JSON || "",
    payloadTargetKiB: parsePayloadTargetKiBFromEnv(env.PAYLOAD_TARGET_BYTES),
    auth,
    manualEnvVars: Object.entries(env)
      .filter(([key]) => !BUILDER_CONFIG_ENV_KEYS.has(key))
      .map(([key, value]) => ({ key, value })),
  }
}

function mergeAuthInputs(primary: AuthInput | undefined, fallback: AuthInput): AuthInput {
  if (!primary) return fallback

  const merged = { ...fallback, ...primary }
  if (!primary.auth_enabled && fallback.auth_enabled) merged.auth_enabled = true
  if (!primary.auth_mode?.trim() && fallback.auth_mode) merged.auth_mode = fallback.auth_mode
  if (!primary.auth_token_url?.trim() && fallback.auth_token_url) merged.auth_token_url = fallback.auth_token_url
  if (!primary.auth_client_id?.trim() && fallback.auth_client_id) merged.auth_client_id = fallback.auth_client_id
  if (!primary.auth_client_secret?.trim() && fallback.auth_client_secret) merged.auth_client_secret = fallback.auth_client_secret
  if (!primary.auth_client_auth_method?.trim() && fallback.auth_client_auth_method) {
    merged.auth_client_auth_method = fallback.auth_client_auth_method
  }
  if (!(primary.auth_refresh_skew_seconds > 0) && fallback.auth_refresh_skew_seconds > 0) {
    merged.auth_refresh_skew_seconds = fallback.auth_refresh_skew_seconds
  }
  if (!primary.auth_secret_source && fallback.auth_secret_source) merged.auth_secret_source = fallback.auth_secret_source
  if (!primary.auth_secret_configured && fallback.auth_secret_configured) merged.auth_secret_configured = fallback.auth_secret_configured
  return merged
}

function mergeEnvVarKeys(existing: EnvVarEntry[], keys: string[]): EnvVarEntry[] {
  const existingKeys = new Set(existing.map((entry) => entry.key))
  const merged = [...existing]
  for (const key of keys) {
    if (!existingKeys.has(key)) merged.push({ key, value: "" })
  }
  return merged
}

function resolveTemplateExecutor(executor?: string): ExecutorType | undefined {
  if (!executor) return undefined
  return VALID_EXECUTORS.includes(executor as ExecutorType) ? (executor as ExecutorType) : undefined
}

function resolveTemplateEnvVars(template: Template): EnvVarEntry[] {
  if (!template.script_content) return []
  const configEnv = parseConfigEnv(template.config_content)
  return extractEnvKeys(template.script_content).map((key) => ({
    key,
    value: configEnv[key] ?? "",
  }))
}

function buildTemplatePayload(args: {
  name: string
  description: string
  mode: "builder" | "upload"
  url: string
  stages: Stage[]
  httpMethod: HttpMethod
  contentType: string
  payloadJson: string
  payloadTargetKiB: number
  auth: AuthInput
  scriptPreview: string
  configPreview: string
  builderConfigPreview: string
  envVars: EnvVarEntry[]
}): TemplatePayload {
  const configContent = buildConfigContent({
    mode: args.mode,
    configPreview: args.configPreview,
    builderConfigPreview: args.builderConfigPreview,
    envVars: args.envVars,
    url: args.url,
    httpMethod: args.httpMethod,
    contentType: args.contentType,
    payloadJson: args.payloadJson,
    payloadTargetKiB: args.payloadTargetKiB,
    auth: args.auth,
  })
  return {
    name: args.name,
    description: args.description,
    mode: args.mode,
    url: args.mode === "builder" ? args.url : undefined,
    stages: args.mode === "builder" ? args.stages : undefined,
    http_method: args.mode === "builder" ? args.httpMethod : undefined,
    content_type: args.mode === "builder" && methodAllowsPayload(args.httpMethod) ? args.contentType : undefined,
    payload_json: args.mode === "builder" && methodAllowsPayload(args.httpMethod) && args.payloadJson.trim()
      ? args.payloadJson
      : undefined,
    payload_target_kib: args.mode === "builder" && methodAllowsPayload(args.httpMethod) && args.payloadTargetKiB > 0
      ? args.payloadTargetKiB
      : undefined,
    auth: args.mode === "builder" ? buildAuthPayload(args.auth, { mode: "template" }) : undefined,
    script_content: args.mode === "upload" ? args.scriptPreview : undefined,
    config_content: configContent || undefined,
  }
}

function buildValidationErrors(args: {
  projectName: string
  mode: "builder" | "upload"
  url: string
  executor: ExecutorType
  httpMethod: HttpMethod
  payloadJson: string
  payloadTargetKiB: number
  stages: Stage[]
  vus: number
  duration: string
  rate: number
  auth: AuthInput
  scriptFile: File | null
  scriptPreview: string
  configPreview: string
}) {
  const nextErrors: Record<string, string> = {}

  if (!args.projectName.trim()) {
    nextErrors.projectName = "Test run name is required"
  }

  if (args.mode === "builder") {
    if (!args.url.trim()) nextErrors.url = "Target URL is required"

    const needsStages = args.executor === "ramping-vus" || args.executor === "ramping-arrival-rate"
    if (needsStages) {
      if (!args.stages.length) nextErrors.stages = "At least one stage required"
      args.stages.forEach((stage, index) => {
        if (!stage.duration) nextErrors[`duration-${index}`] = "Required"
        if (!stage.target) nextErrors[`target-${index}`] = "Required"
      })
    }

    if (args.executor === "constant-vus") {
      if (args.vus < 1) nextErrors.vus = "At least 1 VU required"
      if (!args.duration) nextErrors.duration = "Duration is required"
    }

    if (args.executor === "constant-arrival-rate") {
      if (args.rate < 1) nextErrors.rate = "Rate must be at least 1"
      if (!args.duration) nextErrors.duration = "Duration is required"
    }

    const payloadPreview = calculatePayloadPreview(args.httpMethod, args.payloadJson, args.payloadTargetKiB)
    if (payloadPreview.error) {
      nextErrors.payload = payloadPreview.error
    }

    const authError = validateAuthInput(args.auth, { requireSecret: true })
    if (authError) {
      nextErrors.auth = authError
    }
  }

  if (args.mode === "upload" && !args.scriptFile && !args.scriptPreview) {
    nextErrors.script = "Please select a k6 script file"
  }

  if (args.configPreview) {
    try {
      JSON.parse(args.configPreview)
    } catch {
      nextErrors.config = "Config file must be valid JSON"
    }
  }

  return nextErrors
}

function buildBuilderConfigPreview(args: {
  executor: ExecutorType
  vus: number
  duration: string
  stages: Stage[]
  rate: number
  timeUnit: string
  preAllocatedVUs: number
  maxVUs: number
  url: string
  httpMethod: HttpMethod
  contentType: string
  payloadJson: string
  payloadTargetKiB: number
  auth: AuthInput
  envVars: EnvVarEntry[]
}) {
  const scenario: Record<string, any> = { executor: args.executor }

  switch (args.executor) {
    case "constant-vus":
      scenario.vus = args.vus
      scenario.duration = args.duration
      break
    case "ramping-vus":
      scenario.startVUs = 0
      scenario.stages = args.stages.filter((stage) => stage.duration)
      break
    case "constant-arrival-rate":
      scenario.rate = args.rate
      scenario.timeUnit = args.timeUnit
      scenario.duration = args.duration
      scenario.preAllocatedVUs = args.preAllocatedVUs
      scenario.maxVUs = args.maxVUs
      break
    case "ramping-arrival-rate":
      scenario.startRate = args.rate
      scenario.timeUnit = args.timeUnit
      scenario.preAllocatedVUs = args.preAllocatedVUs
      scenario.maxVUs = args.maxVUs
      scenario.stages = args.stages.filter((stage) => stage.duration)
      break
  }

  const config: Record<string, any> = {
    scenarios: { default: scenario },
    thresholds: {
      http_req_duration: ["p(95)<500", "p(99)<1000"],
      errors: ["rate<0.01"],
      success_rate: ["rate>0.99"],
    },
  }

  const envBlock: Record<string, string> = buildBuilderEnvContract({
    url: args.url,
    httpMethod: args.httpMethod,
    contentType: args.contentType,
    payloadJson: args.payloadJson,
    payloadTargetKiB: args.payloadTargetKiB,
    auth: args.auth,
  })
  for (const entry of args.envVars) {
    if (entry.key.trim()) envBlock[entry.key.trim()] = entry.value
  }
  if (Object.keys(envBlock).length > 0) config.env = envBlock

  return JSON.stringify(config, null, 2)
}

type CloneDraft = {
  mode?: "builder" | "upload"
  scriptPreview?: string
  configPreview?: string
  url?: string
  executor?: ExecutorType
  httpMethod?: HttpMethod
  contentType?: string
  payloadJson?: string
  payloadTargetKiB?: number
  auth?: AuthInput
  stages?: Stage[]
}

function parseCloneDraft(raw: string | null): CloneDraft | null {
  if (!raw) return null

  try {
    const clone = JSON.parse(raw)
    if (clone.script_content) {
      return {
        mode: "upload",
        scriptPreview: clone.script_content,
        configPreview: clone.config_content,
      }
    }
    if (clone.url || clone.stages) {
      return {
        mode: "builder",
        url: clone.url,
        executor: resolveTemplateExecutor(clone.executor),
        httpMethod: VALID_HTTP_METHODS.includes(clone.http_method as HttpMethod) ? clone.http_method as HttpMethod : undefined,
        contentType: clone.content_type,
        payloadJson: clone.payload_json,
        payloadTargetKiB: typeof clone.payload_target_kib === "number" ? clone.payload_target_kib : undefined,
        auth: clone.auth ? hydrateAuthInput(clone.auth) : undefined,
        stages: clone.stages,
        configPreview: clone.config_content,
      }
    }
    if (clone.config_content) {
      return {
        mode: clone.mode === "upload" ? "upload" : undefined,
        configPreview: clone.config_content,
      }
    }
  } catch {
    return null
  }

  return null
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => resolve((event.target?.result as string) || "")
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"))
    reader.readAsText(file)
  })
}

function isValidJson(content: string) {
  try {
    JSON.parse(content)
    return true
  } catch {
    return false
  }
}

export default function RunForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { token, user } = useSession()

  const [mode, setMode] = useState<"builder" | "upload">("builder")
  const [executor, setExecutor] = useState<ExecutorType>("ramping-vus")
  const [projectName, setProjectName] = useState("")
  const [url, setUrl] = useState("")
  const [httpMethod, setHttpMethod] = useState<HttpMethod>("POST")
  const [contentType, setContentType] = useState("application/json")
  const [payloadJson, setPayloadJson] = useState("")
  const [payloadFileName, setPayloadFileName] = useState("")
  const [payloadTargetKiB, setPayloadTargetKiB] = useState(0)
  const [authConfig, setAuthConfig] = useState<AuthInput>(createDefaultAuthInput())
  const [stages, setStages] = useState<Stage[]>([
    { duration: "", target: 0 },
  ])
  // constant-vus fields
  const [vus, setVus] = useState(10)
  const [duration, setDuration] = useState("1m")
  // arrival-rate fields
  const [rate, setRate] = useState(10)
  const [timeUnit, setTimeUnit] = useState("1s")
  const [preAllocatedVUs, setPreAllocatedVUs] = useState(10)
  const [maxVUs, setMaxVUs] = useState(20)
  // think-time between iterations (seconds, 0 = no pause)
  const [sleepSeconds, setSleepSeconds] = useState(0.5)

  const [scriptFile, setScriptFile] = useState<File | null>(null)
  const [scriptPreview, setScriptPreview] = useState("")
  const [configFile, setConfigFile] = useState<File | null>(null)
  const [configPreview, setConfigPreview] = useState("")
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([])
  const [configJsonValid, setConfigJsonValid] = useState(true)

  const [warnings, setWarnings] = useState<{ type: string; message: string }[]>([])
  const [errors, setErrors] = useState<any>({})
  const [loading, setLoading] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [showModal, setShowModal] = useState(false)
  const [progress, setProgress] = useState(0)
  const [steps, setSteps] = useState<Record<string, "pending" | "running" | "done" | "error">>({
    script: "pending",
    workers: "pending",
    load: "pending",
    collecting: "pending",
  })

  // Test control state
  const [controllable, setControllable] = useState(true)
  const [paused, setPaused] = useState(false)
  const [currentVUs, setCurrentVUs] = useState(0)
  const [vuInput, setVuInput] = useState("")
  const [controlBusy, setControlBusy] = useState(false)
  const [liveThresholds, setLiveThresholds] = useState<ThresholdResult[]>([])
  const [testIdRef, setTestIdRef] = useState("")
  const [activeRunNotice, setActiveRunNotice] = useState<ActiveRunNotice | null>(null)

  const [toast, setToast] = useState<{
    type: "success" | "error"
    message: string
  } | null>(null)

  // Template state
  const [templates, setTemplates] = useState<Template[]>([])
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState("")
  const [saveTemplateDesc, setSaveTemplateDesc] = useState("")
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [templateSaving, setTemplateSaving] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const envSyncRef = useRef<"ui" | "editor" | null>(null)
  const payloadInputRef = useRef<HTMLInputElement | null>(null)

  // Live config preview for builder mode based on current executor + params
  const builderConfigPreview = useMemo(() => buildBuilderConfigPreview({
    executor,
    vus,
    duration,
    stages,
    rate,
    timeUnit,
    preAllocatedVUs,
    maxVUs,
    url,
    httpMethod,
    contentType,
    payloadJson,
    payloadTargetKiB,
    auth: authConfig,
    envVars,
  }), [executor, vus, duration, stages, rate, timeUnit, preAllocatedVUs, maxVUs, url, httpMethod, contentType, payloadJson, payloadTargetKiB, authConfig, envVars])

  const payloadPreview = useMemo(
    () => calculatePayloadPreview(httpMethod, payloadJson, payloadTargetKiB),
    [httpMethod, payloadJson, payloadTargetKiB],
  )

  useEffect(() => {
    setErrors((prev: any) => {
      const next = { ...prev }
      if (mode !== "builder" || !methodAllowsPayload(httpMethod) || !payloadPreview.error) {
        delete next.payload
        return next
      }
      next.payload = payloadPreview.error
      return next
    })
  }, [mode, httpMethod, payloadPreview.error])

  useEffect(() => {
    setErrors((prev: any) => {
      const next = { ...prev }
      if (mode !== "builder") {
        delete next.auth
        return next
      }
      const authError = validateAuthInput(authConfig, { requireSecret: true })
      if (!authError) {
        delete next.auth
        return next
      }
      next.auth = authError
      return next
    })
  }, [mode, authConfig])

  const authHeaders = useCallback(
    (includeJsonContentType = false): Record<string, string> =>
      createAuthHeaders(token, includeJsonContentType),
    [token],
  )

  // Load clone data from Results "Re-Run" button
  const [cloneLoaded, setCloneLoaded] = useState(false)
  useEffect(() => {
    if (cloneLoaded) return
    if (searchParams.get("clone") !== "true") return
    const raw = localStorage.getItem("k6-clone-test")
    if (!raw) return
    localStorage.removeItem("k6-clone-test")
    setCloneLoaded(true)
    const clone = parseCloneDraft(raw)
    if (!clone) return
    const configHydration = hydrateBuilderRuntimeFromConfig(clone.configPreview)
    if (clone.mode) setMode(clone.mode)
    if (clone.scriptPreview) setScriptPreview(clone.scriptPreview)
    if (clone.url || configHydration.url) setUrl(clone.url || configHydration.url)
    if (clone.executor) setExecutor(clone.executor)
    if (clone.httpMethod || configHydration.httpMethod) setHttpMethod(clone.httpMethod || configHydration.httpMethod || "POST")
    if (clone.contentType || configHydration.contentType) setContentType(clone.contentType || configHydration.contentType || "application/json")
    if (clone.payloadJson || configHydration.payloadJson) setPayloadJson(clone.payloadJson || configHydration.payloadJson || "")
    if (clone.payloadTargetKiB || configHydration.payloadTargetKiB) setPayloadTargetKiB(clone.payloadTargetKiB || configHydration.payloadTargetKiB)
    if (clone.auth || configHydration.auth.auth_enabled) {
      setAuthConfig(mergeAuthInputs(clone.auth, configHydration.auth))
    }
    if (clone.stages && clone.stages.length > 0) setStages(clone.stages)
    if (clone.configPreview) setConfigPreview(clone.configPreview)
    setEnvVars(configHydration.manualEnvVars)
  }, [searchParams, cloneLoaded])

  // Load available templates
  useEffect(() => {
    if (!token) return
    listTemplates(token)
      .then((res) => setTemplates(res.templates ?? []))
      .catch(() => {})
  }, [token])

  // Surface already-running tests as a lightweight notice so the builder remains usable.
  useEffect(() => {
    if (!token || showModal || loading) return
    let cancelled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    const checkActiveTest = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/metrics/live`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        })
        if (cancelled || !res.ok) return
        const data = await res.json()
        if (data.test_id && data.phase && data.phase !== "done" && data.phase !== "error") {
          setActiveRunNotice({
            testId: data.test_id,
            phase: String(data.phase),
          })
          return
        }
        setActiveRunNotice(null)
      } catch {
        // Network errors should not wipe the last known active-run hint.
      }
    }
    checkActiveTest()
    pollTimer = setInterval(checkActiveTest, 5000)
    return () => {
      cancelled = true
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [token, showModal, loading])

  const loadTemplate = (t: Template) => {
    if (t.mode === "upload" && t.script_content) {
      setMode("upload")
      setScriptPreview(t.script_content)
      setScriptFile(null)
      setAuthConfig(createDefaultAuthInput())
      if (t.config_content) {
        setConfigPreview(t.config_content)
        setConfigJsonValid(true)
      }
      setEnvVars(resolveTemplateEnvVars(t))
    } else {
      const configHydration = hydrateBuilderRuntimeFromConfig(t.config_content)
      setMode("builder")
      if (t.url || configHydration.url) setUrl(t.url || configHydration.url)
      if (t.stages && t.stages.length > 0) setStages(t.stages)
      const templateExecutor = resolveTemplateExecutor(t.executor)
      if (templateExecutor) setExecutor(templateExecutor)
      setHttpMethod(
        VALID_HTTP_METHODS.includes((t.http_method ?? "POST") as HttpMethod)
          ? (t.http_method as HttpMethod)
          : (configHydration.httpMethod || "POST"),
      )
      setContentType(t.content_type || configHydration.contentType || "application/json")
      setPayloadJson(t.payload_json || configHydration.payloadJson || "")
      setPayloadTargetKiB(t.payload_target_kib || configHydration.payloadTargetKiB || 0)
      setAuthConfig(mergeAuthInputs(hydrateAuthInput(t.auth), configHydration.auth))
      if (t.config_content) setConfigPreview(t.config_content)
      setEnvVars(configHydration.manualEnvVars)
    }
    setShowTemplateDropdown(false)
    setToast({ type: "success", message: `Template "${t.name}" loaded` })
  }

  const handleSaveTemplate = async () => {
    if (!token || !saveTemplateName.trim()) return
    setTemplateSaving(true)
    try {
      const payload = buildTemplatePayload({
        name: saveTemplateName,
        description: saveTemplateDesc,
        mode,
        url,
        stages,
        httpMethod,
        contentType,
        payloadJson,
        payloadTargetKiB,
        auth: authConfig,
        scriptPreview,
        configPreview,
        builderConfigPreview,
        envVars,
      })
      const created = await createTemplate(payload, token)
      setTemplates((prev) => [created, ...prev])
      setShowSaveTemplate(false)
      setSaveTemplateName("")
      setSaveTemplateDesc("")
      setToast({ type: "success", message: "Template saved" })
    } catch {
      setToast({ type: "error", message: "Failed to save template" })
    }
    setTemplateSaving(false)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    setScriptFile(file)
    if (file) {
      void readFileAsText(file).then((content) => {
        setScriptPreview(content)
        const keys = extractEnvKeys(content)
        if (keys.length > 0) {
          setEnvVars((prev) => mergeEnvVarKeys(prev, keys))
        }
      }).catch(() => {
        setScriptPreview("")
      })
    } else {
      setScriptPreview("")
    }
  }

  const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    setConfigFile(file)
    if (file) {
      void readFileAsText(file).then((content) => {
        setConfigPreview(content)
        if (isValidJson(content)) {
          setErrors((prev: any) => {
            const next = { ...prev }
            delete next.config
            return next
          })
        } else {
          setErrors((prev: any) => ({ ...prev, config: "Invalid JSON file" }))
        }
      }).catch(() => {
        setConfigPreview("")
        setErrors((prev: any) => ({ ...prev, config: "Invalid JSON file" }))
      })
    } else {
      setConfigPreview("")
    }
  }

  const handlePayloadFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    if (!file) {
      setPayloadFileName("")
      return
    }

    setPayloadFileName(file.name)
    void readFileAsText(file).then((content) => {
      setPayloadJson(content)
    }).catch(() => {
      setPayloadFileName("")
      setPayloadJson("")
      setErrors((prev: any) => ({ ...prev, payload: "Invalid payload file" }))
    })
  }

  const validate = () => {
    const newErrors = buildValidationErrors({
      projectName,
      mode,
      url,
      executor,
      httpMethod,
      payloadJson,
      payloadTargetKiB,
      stages,
      vus,
      duration,
      rate,
      auth: authConfig,
      scriptFile,
      scriptPreview,
      configPreview,
    })
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const setStepState = useCallback((next: RunSteps) => {
    setSteps(next)
  }, [])

  const payloadEnabled = methodAllowsPayload(httpMethod)
  const builderSectionClass = "space-y-4 rounded-xl border border-app-border p-5 app-card"
  const builderSubSectionClass = "space-y-4 rounded-lg border border-app-border bg-app-surface p-4"
  const uploadDropzoneClass = "border border-dashed border-app-border rounded-xl p-4 text-center hover:border-accent-primary transition-colors"
  const generatedBuilderEnvEntries = useMemo(
    () => mode === "builder"
      ? Object.entries(buildBuilderEnvContract({
          url,
          httpMethod,
          contentType,
          payloadJson,
          payloadTargetKiB,
          auth: authConfig,
        }))
      : [],
    [mode, url, httpMethod, contentType, payloadJson, payloadTargetKiB, authConfig],
  )
  const generatedSensitiveEnvEntries = useMemo(
    () => generatedBuilderEnvEntries.filter(([key]) => SENSITIVE_GENERATED_ENV_KEYS.has(key)),
    [generatedBuilderEnvEntries],
  )
  const generatedVisibleEnvEntries = useMemo(
    () => generatedBuilderEnvEntries.filter(([key]) => !SENSITIVE_GENERATED_ENV_KEYS.has(key)),
    [generatedBuilderEnvEntries],
  )
  const missingBuilderRuntimeItems = useMemo(
    () => mode === "builder"
      ? buildMissingBuilderRuntimeItems({ url, auth: authConfig })
      : [],
    [mode, url, authConfig],
  )
  const generatedBuilderEnvKeySet = useMemo(
    () => new Set(generatedBuilderEnvEntries.map(([key]) => key)),
    [generatedBuilderEnvEntries],
  )

  const finishRunAndRedirect = useCallback((resultId: string) => {
    setTimeout(() => {
      setShowModal(false)
      setLoading(false)
      router.push(`/result/${resultId}`)
    }, 1200)
  }, [router])

  const withControlBusy = useCallback(async (run: () => Promise<void>) => {
    setControlBusy(true)
    try {
      await run()
    } finally {
      setControlBusy(false)
    }
  }, [])

  // --- Test control actions ---

  const parseErrorResponse = async (res: Response): Promise<string> => {
    try {
      const data = await res.json()
      return data.error || JSON.stringify(data)
    } catch {
      return await res.text() || "Unknown error"
    }
  }

  const sendControlRequest = useCallback(
    async (endpoint: string, init: RequestInit = {}) => {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        ...init,
        headers: {
          ...authHeaders(init.body ? true : false),
          ...(init.headers as Record<string, string> | undefined),
        },
      })
      if (!res.ok) {
        throw new Error(await parseErrorResponse(res))
      }
      return res
    },
    [authHeaders],
  )

  const handleRunningPhaseData = useCallback((data: any, elapsed: number, totalSeconds: number) => {
    setStepState({ script: "done", workers: "done", load: "running", collecting: "pending" })

    if (data.controllable !== undefined) {
      setControllable(data.controllable)
    }

    const nextElapsed = elapsed + 2
    const percent = Math.min(Math.floor((nextElapsed / totalSeconds) * 100), 95)
    setProgress(percent)

    if (data.metrics) {
      const metrics = data.metrics
      setCurrentVUs(metrics.total_vus || 0)
      if (metrics.thresholds && metrics.thresholds.length > 0) {
        setLiveThresholds(metrics.thresholds)
      }
      setLogs((prev) => [...prev, buildLiveLogLine(metrics)])
    }

    return nextElapsed
  }, [setStepState])

  const applyPollingPhase = useCallback((data: any, testId: string, totalSeconds: number, elapsed: number) => {
    const phase = data.phase as string

    if (phase === "script") {
      setSteps((prev) => ({ ...prev, script: "running" }))
      return elapsed
    }
    if (phase === "workers") {
      setSteps((prev) => ({ ...prev, script: "done", workers: "running" }))
      return elapsed
    }
    if (phase === "running") {
      return handleRunningPhaseData(data, elapsed, totalSeconds)
    }
    if (phase === "collecting") {
      setStepState({ script: "done", workers: "done", load: "done", collecting: "running" })
      setProgress(97)
      return elapsed
    }
    if (phase === "done" || data.status === "completed") {
      setStepState({ script: "done", workers: "done", load: "done", collecting: "done" })
      setProgress(100)
      stopPolling()
      setToast({ type: "success", message: "Test completed successfully" })
      finishRunAndRedirect(data.test_id || testId)
      return elapsed
    }
    if (phase === "error") {
      stopPolling()
      setToast({ type: "error", message: data.message || "Test failed" })
      setShowModal(false)
      setLoading(false)
    }
    return elapsed
  }, [finishRunAndRedirect, handleRunningPhaseData, setStepState, stopPolling])

  const handlePauseResume = async () => {
    await withControlBusy(async () => {
      try {
        const endpoint = paused ? "/api/resume" : "/api/pause"
        await sendControlRequest(endpoint, { method: "POST" })
        setPaused(!paused)
      } catch (err: any) {
        setToast({ type: "error", message: err?.message || "Network error" })
      }
    })
  }

  const handleStop = async () => {
    await withControlBusy(async () => {
      try {
        const res = await sendControlRequest("/api/stop", { method: "POST" })
        stopPolling()
        setStepState({ script: "done", workers: "done", load: "done", collecting: "done" })
        setProgress(100)
        setToast({ type: "success", message: "Test stopped" })

        const data = await res.json()
        const resultId = data.id || testIdRef
        finishRunAndRedirect(resultId)
      } catch (err: any) {
        setToast({ type: "error", message: err?.message || "Network error" })
      }
    })
  }

  const handleScale = async () => {
    const target = parseInt(vuInput)
    if (isNaN(target) || target < 1) {
      setToast({ type: "error", message: "Enter a valid VU count (min 1)" })
      return
    }
    await withControlBusy(async () => {
      try {
        await sendControlRequest("/api/scale", {
          method: "POST",
          body: JSON.stringify({ vus: target }),
        })
        setVuInput("")
        setToast({ type: "success", message: `Scaled to ${target} VUs` })
      } catch (err: any) {
        setToast({ type: "error", message: err?.message || "Network error" })
      }
    })
  }

  const startPolling = useCallback((testId: string, totalSeconds: number) => {
    let elapsed = 0

    const headers = createAuthHeaders(token)

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/metrics/live`, {
          headers,
          cache: "no-store",
        })

        if (!res.ok) return

        const data = await res.json()
        elapsed = applyPollingPhase(data, testId, totalSeconds, elapsed)
      } catch {
        // Network error — keep polling
      }
    }, 2000)
  }, [token, applyPollingPhase])

  const handleSubmit = async () => {
    if (!validate()) return
    if (activeRunNotice) {
      setToast({
        type: "error",
        message: `A load test is already running (${activeRunNotice.testId}). You can keep editing this setup, but starting a new run is blocked until the active test finishes.`,
      })
      return
    }

    setLoading(true)
    setLogs([])
    setShowModal(true)
    setProgress(0)
    setPaused(false)
    setControllable(false) // will be set from backend response
    setCurrentVUs(0)
    setVuInput("")
    setLiveThresholds([])
    setSteps({ script: "running", workers: "pending", load: "pending", collecting: "pending" })

    const totalSeconds = calculateRunDurationSeconds(mode, executor, stages, duration)

    try {
      const headers = authHeaders(true)
      const body = buildRunRequestBody({
        mode,
        projectName,
        url,
        executor,
        httpMethod,
        contentType,
        payloadJson,
        payloadTargetKiB,
        stages,
        vus,
        duration,
        rate,
        timeUnit,
        preAllocatedVUs,
        maxVUs,
        sleepSeconds,
        scriptPreview,
        configPreview,
        builderConfigPreview,
        auth: authConfig,
        envVars,
      })

      const response = await fetch(`${API_BASE}/api/run`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        cache: "no-store",
      })

      let finalResponse = response

      if (!response.ok) {
        if (response.status === 409) {
          // Check if this is a schedule conflict that can be confirmed
          let conflictData: any = null
          try { conflictData = await response.clone().json() } catch { /* not JSON */ }

          if (conflictData?.confirm_available && conflictData?.conflict) {
            const c = conflictData.conflict
            const msg = `A scheduled test "${c.schedule_name || "unknown"}" is planned from ${new Date(c.start).toLocaleString()} to ${new Date(c.end).toLocaleString()}. Start anyway?`
            if (window.confirm(msg)) {
              // Retry with confirm=true to bypass the schedule check
              finalResponse = await fetch(`${API_BASE}/api/run?confirm=true`, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                cache: "no-store",
              })
              if (!finalResponse.ok) {
                const retryErr = await finalResponse.text()
                throw new Error(retryErr || "Failed to start test")
              }
            } else {
              setShowModal(false)
              setLoading(false)
              return
            }
          } else {
            throw new Error(conflictData?.error || "Test conflict — a test is already running or scheduled")
          }
        } else {
          const errText = await response.text()
          throw new Error(errText || "Failed to start test")
        }
      }

      const data = await finalResponse.json()
      const testId = data.test_id
      setTestIdRef(testId)

      if (data.controllable !== undefined) {
        setControllable(data.controllable)
      }

      if (data.warnings && data.warnings.length > 0) {
        setWarnings(data.warnings)
      }

      setSteps(prev => ({ ...prev, script: "done", workers: "done", load: "running", collecting: "pending" }))

      startPolling(testId, totalSeconds)

    } catch (err: any) {
      stopPolling()
      setToast({
        type: "error",
        message: err?.message || "Failed to run test",
      })
      setShowModal(false)
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 relative">

      {/* TOAST */}
      {toast && (
        <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />
      )}

      {activeRunNotice && !showModal && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            <span className="font-medium">A load test is currently running.</span>
            <span className="text-amber-700/80 dark:text-amber-200/80">
              Continue designing here, but starting a new run is blocked until the active test completes.
            </span>
          </div>
          <div className="text-xs font-mono text-amber-700/80 dark:text-amber-200/80">
            {activeRunNotice.testId} · {formatRunPhaseLabel(activeRunNotice.phase)}
          </div>
        </div>
      )}

      {/* MODE TABS */}
      <div className="flex border-b border-app-border">
        <button
          type="button"
          onClick={() => setMode("builder")}
          className={`px-5 py-2.5 text-sm font-medium transition-colors ${
            mode === "builder"
              ? "border-b-2 border-accent-primary text-accent-primary"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          Builder
        </button>
        <button
          type="button"
          onClick={() => setMode("upload")}
          className={`px-5 py-2.5 text-sm font-medium transition-colors ${
            mode === "upload"
              ? "border-b-2 border-accent-primary text-accent-primary"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          Upload k6 Script
        </button>
      </div>

      {/* TEST RUN NAME */}
      <div>
        <label className="block text-sm font-medium mb-2 text-text-primary">
          Test Run Name
        </label>
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="Checkout API smoke test"
          className={`w-full ${errors.projectName ? "border-red-500" : ""}`}
        />
        {errors.projectName && (
          <p className="text-red-500 text-xs mt-1">{errors.projectName}</p>
        )}
      </div>

      {/* BUILDER MODE */}
      {mode === "builder" && (
        <>
          <div className={builderSectionClass}>
            <div>
              <label className="block text-sm font-medium text-text-primary">
                Request Setup
              </label>
              <p className="text-text-muted text-xs mt-1">
                Configure the target endpoint, request method and optional JSON body for the builder-generated request.
              </p>
            </div>

            <FormSubSection>
              <FormSubSectionTitle
                title="Request Target"
                description="Define the endpoint and transport details that the builder-generated request should use."
              />
              <FormSubSectionContent>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-primary">
                    Target URL
                  </label>
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="http://target-lb:8090"
                    className={`w-full ${errors.url ? "border-red-500" : ""}`}
                  />
                  {errors.url && (
                    <p className="mt-1 text-xs text-red-500">{errors.url}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-primary">
                      HTTP Method
                    </label>
                    <select
                      value={httpMethod}
                      onChange={(e) => setHttpMethod(e.target.value as HttpMethod)}
                      className="w-full border border-app-border rounded-md px-3 py-2 text-sm bg-[var(--color-card-bg)] text-text-primary"
                    >
                      {VALID_HTTP_METHODS.map((method) => (
                        <option key={method} value={method}>{method}</option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1.5 block text-sm font-medium text-text-primary">
                      Content-Type
                    </label>
                    <input
                      value={contentType}
                      onChange={(e) => setContentType(e.target.value)}
                      disabled={!payloadEnabled}
                      placeholder="application/json"
                      className="w-full disabled:opacity-60"
                    />
                  </div>
                </div>
              </FormSubSectionContent>
            </FormSubSection>

            <FormSubSection>
              <FormSubSectionTitle
                title="Request Payload"
                description="Provide the JSON body directly or load it from a file. Exact sizing is based on UTF-8 bytes of the serialized payload."
                aside={(
                  <div className="status-badge status-badge--info px-2 py-1 text-[10px] font-semibold uppercase tracking-wider">
                    Builder only
                  </div>
                )}
              />
              <FormSubSectionContent>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-primary">
                    Upload JSON File
                  </label>
                  <input
                    ref={payloadInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    id="payload-upload"
                    onChange={handlePayloadFileChange}
                  />
                  <div className={`${uploadDropzoneClass} mb-3`}>
                    <label
                      htmlFor="payload-upload"
                      className={`block ${payloadEnabled ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                    >
                      {payloadFileName ? (
                        <div className="flex items-center justify-between px-2">
                          <div>
                            <div className="text-text-primary font-medium text-sm">{payloadFileName}</div>
                            <div className="text-text-muted text-xs">Payload file loaded — click to replace</div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setPayloadFileName("")
                              setPayloadJson("")
                              if (payloadInputRef.current) payloadInputRef.current.value = ""
                            }}
                            className="text-red-500 text-xs hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      ) : payloadJson && payloadEnabled ? (
                        <div>
                          <div className="text-text-primary font-medium text-sm">Payload present</div>
                          <div className="text-text-muted text-xs">Click to select a payload JSON file instead</div>
                        </div>
                      ) : (
                        <div>
                          <div className="text-text-muted text-sm">
                            {payloadEnabled ? "Click to select a payload JSON file" : "GET requests do not send a JSON body"}
                          </div>
                        </div>
                      )}
                    </label>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-primary">
                    JSON Payload
                  </label>
                  <textarea
                    value={payloadJson}
                    onChange={(e) => {
                      setPayloadJson(e.target.value)
                      if (payloadFileName) setPayloadFileName("")
                    }}
                    disabled={!payloadEnabled}
                    rows={8}
                    placeholder={payloadEnabled ? '{\n  "message": "hello"\n}' : "GET requests do not send a JSON body"}
                    className={`w-full border rounded-md px-3 py-2 text-xs font-mono bg-[var(--color-card-bg)] text-text-primary disabled:opacity-60 ${
                      errors.payload ? "border-red-500" : "border-app-border"
                    }`}
                  />
                  {payloadEnabled && (
                    <p className="mt-2 text-[11px] text-text-muted">
                      Paste JSON directly or upload a `.json` file. Validation now runs inline before the test is started.
                    </p>
                  )}
                </div>
              </FormSubSectionContent>
            </FormSubSection>

            <FormSubSection>
              <FormSubSectionTitle
                title="Payload Size"
                description="Inspect the current serialized payload size and configure an exact target size in KiB when needed."
              />
              <FormSubSectionContent>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-text-primary">
                    Target Size (KiB)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={payloadTargetKiB}
                    onChange={(e) => setPayloadTargetKiB(Number(e.target.value) || 0)}
                    disabled={!payloadEnabled}
                    className={`w-full disabled:opacity-60 ${errors.payload ? "border-red-500" : ""}`}
                  />
                </div>

                <div className="rounded-lg border border-app-border bg-[var(--color-card-bg)] p-3 text-xs space-y-1">
                  <div className="flex justify-between gap-3">
                    <span className="text-text-muted">Current Bytes</span>
                    <span className="font-mono text-text-primary">{payloadPreview.serializedBytes}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-text-muted">Current KB / KiB</span>
                    <span className="font-mono text-text-primary">
                      {payloadPreview.serializedKB.toFixed(2)} KB / {payloadPreview.serializedKiB.toFixed(2)} KiB
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-text-muted">Target Bytes</span>
                    <span className="font-mono text-text-primary">{payloadPreview.targetBytes}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-text-muted">Target KB / KiB</span>
                    <span className="font-mono text-text-primary">
                      {payloadPreview.targetKB.toFixed(2)} KB / {payloadPreview.targetKiB.toFixed(2)} KiB
                    </span>
                  </div>
                  {payloadEnabled && payloadPreview.targetBytes > 0 && (
                    <div className={`pt-2 font-medium ${payloadPreview.error ? "text-red-500" : payloadPreview.autoPadding ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
                      {payloadPreview.error
                        ? payloadPreview.error
                        : payloadPreview.autoPadding
                          ? "Auto-padding will expand the final JSON payload to the exact target size."
                          : "Serialized JSON already matches the exact target size."}
                    </div>
                  )}
                  {!payloadEnabled && (
                    <div className="pt-2 text-text-muted">
                      GET keeps payload fields disabled and sends no body.
                    </div>
                  )}
                </div>
              </FormSubSectionContent>
            </FormSubSection>

            {errors.payload && (
              <p className="text-red-500 text-xs">{errors.payload}</p>
            )}
          </div>

          <div className={builderSectionClass}>
            <div>
              <label className="block text-sm font-medium text-text-primary">
                Authentication
              </label>
              <p className="text-text-muted text-xs mt-1">
                Add OAuth client credentials for builder-based requests. Tokens are requested at runtime and the client secret stays runtime-only for manual runs.
              </p>
            </div>
            <AuthConfigSection value={authConfig} onChange={setAuthConfig} mode="runtime" />
            {errors.auth && (
              <p className="text-red-500 text-xs">{errors.auth}</p>
            )}
          </div>

          {/* Scenario / Executor Type */}
          <div className={builderSectionClass}>
            <div>
              <label className="block text-sm font-medium text-text-primary">
                Load Scenario
              </label>
              <p className="text-text-muted text-xs mt-1">
                Select how k6 should generate the load profile. The chosen scenario defines which execution controls appear next.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                { value: "ramping-vus" as ExecutorType, label: "Ramp Up/Down", desc: "Staged VU ramping with live control" },
                { value: "constant-vus" as ExecutorType, label: "Constant Load", desc: "Fixed number of VUs" },
                { value: "constant-arrival-rate" as ExecutorType, label: "Fixed Throughput", desc: "Constant requests/sec" },
                { value: "ramping-arrival-rate" as ExecutorType, label: "Ramping Throughput", desc: "Staged requests/sec ramp" },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setExecutor(opt.value)}
                  className={`p-3 rounded-lg border text-left transition ${
                    executor === opt.value
                      ? "border-accent-primary bg-pink-50 ring-1 ring-accent-primary"
                      : "border-app-border hover:border-gray-400"
                  }`}
                >
                  <div className={`text-sm font-medium ${executor === opt.value ? "text-accent-primary" : "text-text-primary"}`}>
                    {opt.label}
                  </div>
                  <div className="text-[11px] text-text-muted mt-0.5 leading-tight">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Executor-specific fields */}
          <div className={builderSectionClass}>
            <div>
              <label className="block text-sm font-medium text-text-primary">
                Execution Settings
              </label>
              <p className="text-text-muted text-xs mt-1">
                Configure stages, VUs, throughput and think-time for the selected load scenario.
              </p>
            </div>

          {/* Ramping VUs: stages */}
          {executor === "ramping-vus" && (
            <div className={builderSubSectionClass}>
              <label className="block text-sm font-medium mb-3 text-text-primary">
                Load Stages
              </label>
              <p className="text-text-muted text-xs mb-3">Supports Pause/Resume and live VU scaling during the test.</p>
              {stages.map((stage, index) => (
                <div key={index} className="mb-3">
                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-center">
                    <input
                      value={stage.duration}
                      placeholder="Duration (ex: 30s, 1m)"
                      onChange={(e) => {
                        const updated = [...stages]
                        updated[index].duration = e.target.value
                        setStages(updated)
                      }}
                      className={`w-full sm:w-1/2 ${errors[`duration-${index}`] ? "border-red-500" : ""}`}
                    />
                    <input
                      type="number"
                      value={stage.target || ""}
                      placeholder="Target VUs"
                      onChange={(e) => {
                        const updated = [...stages]
                        updated[index].target = Number(e.target.value)
                        setStages(updated)
                      }}
                      className={`w-full sm:w-1/2 ${errors[`target-${index}`] ? "border-red-500" : ""}`}
                    />
                    {stages.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setStages(stages.filter((_, i) => i !== index))}
                        className="text-red-500 text-lg px-2 self-start sm:self-auto"
                      >
                        x
                      </button>
                    )}
                  </div>
                  {(errors[`duration-${index}`] || errors[`target-${index}`]) && (
                    <p className="text-red-500 text-xs mt-1">Duration and target required</p>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setStages([...stages, { duration: "", target: 0 }])}
                className="text-accent-primary text-sm font-medium hover:underline"
              >
                + Add Stage
              </button>
            </div>
          )}

          {/* Constant VUs */}
          {executor === "constant-vus" && (
            <div className={builderSubSectionClass}>
              <div>
                <label className="block text-sm font-medium text-text-primary">
                  Constant Load Parameters
                </label>
                <p className="text-text-muted text-xs mt-1">
                  Keep the number of virtual users fixed for the configured duration.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-text-primary">Virtual Users</label>
                <input
                  type="number"
                  min="1"
                  value={vus}
                  onChange={(e) => setVus(Number(e.target.value))}
                  className={`w-full ${errors.vus ? "border-red-500" : ""}`}
                />
                {errors.vus && <p className="text-red-500 text-xs mt-1">{errors.vus}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium mb-2 text-text-primary">Duration</label>
                <input
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="1m, 5m, 30s"
                  className={`w-full ${errors.duration ? "border-red-500" : ""}`}
                />
                {errors.duration && <p className="text-red-500 text-xs mt-1">{errors.duration}</p>}
              </div>
            </div>
            </div>
          )}

          {/* Constant Arrival Rate */}
          {executor === "constant-arrival-rate" && (
            <div className={builderSubSectionClass}>
              <p className="text-text-muted text-xs">Send a fixed number of requests per time unit. k6 auto-scales VUs to maintain the target rate.</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-text-primary">Rate (iterations)</label>
                  <input
                    type="number"
                    min="1"
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                    className={`w-full ${errors.rate ? "border-red-500" : ""}`}
                  />
                  {errors.rate && <p className="text-red-500 text-xs mt-1">{errors.rate}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-text-primary">Time Unit</label>
                  <select
                    value={timeUnit}
                    onChange={(e) => setTimeUnit(e.target.value)}
                    className="w-full border border-app-border rounded-md px-3 py-2 text-sm bg-[var(--color-card-bg)] text-text-primary"
                  >
                    <option value="1s">per second</option>
                    <option value="1m">per minute</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-text-primary">Duration</label>
                  <input
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    placeholder="1m, 5m"
                    className={`w-full ${errors.duration ? "border-red-500" : ""}`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-text-primary">Pre-allocated VUs</label>
                  <input
                    type="number"
                    min="1"
                    value={preAllocatedVUs}
                    onChange={(e) => setPreAllocatedVUs(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-text-primary">Max VUs</label>
                  <input
                    type="number"
                    min="1"
                    value={maxVUs}
                    onChange={(e) => setMaxVUs(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Ramping Arrival Rate: stages + rate config */}
          {executor === "ramping-arrival-rate" && (
            <div className={builderSubSectionClass}>
              <p className="text-text-muted text-xs">Ramp the iteration rate up and down in stages. k6 auto-scales VUs to meet the target rate.</p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-text-primary">Time Unit</label>
                  <select
                    value={timeUnit}
                    onChange={(e) => setTimeUnit(e.target.value)}
                    className="w-full border border-app-border rounded-md px-3 py-2 text-sm bg-[var(--color-card-bg)] text-text-primary"
                  >
                    <option value="1s">per second</option>
                    <option value="1m">per minute</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-text-primary">Pre-allocated VUs</label>
                  <input
                    type="number"
                    min="1"
                    value={preAllocatedVUs}
                    onChange={(e) => setPreAllocatedVUs(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-text-primary">Max VUs</label>
                  <input
                    type="number"
                    min="1"
                    value={maxVUs}
                    onChange={(e) => setMaxVUs(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-3 text-text-primary">
                  Rate Stages <span className="text-text-muted font-normal">(target = iterations per time unit)</span>
                </label>
                {stages.map((stage, index) => (
                  <div key={index} className="mb-3">
                    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-center">
                      <input
                        value={stage.duration}
                        placeholder="Duration (ex: 30s, 1m)"
                        onChange={(e) => {
                          const updated = [...stages]
                          updated[index].duration = e.target.value
                          setStages(updated)
                        }}
                        className={`w-full sm:w-1/2 ${errors[`duration-${index}`] ? "border-red-500" : ""}`}
                      />
                      <input
                        type="number"
                        value={stage.target || ""}
                        placeholder="Target rate"
                        onChange={(e) => {
                          const updated = [...stages]
                          updated[index].target = Number(e.target.value)
                          setStages(updated)
                        }}
                        className={`w-full sm:w-1/2 ${errors[`target-${index}`] ? "border-red-500" : ""}`}
                      />
                      {stages.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setStages(stages.filter((_, i) => i !== index))}
                          className="text-red-500 text-lg px-2 self-start sm:self-auto"
                        >
                          x
                        </button>
                      )}
                    </div>
                    {(errors[`duration-${index}`] || errors[`target-${index}`]) && (
                      <p className="text-red-500 text-xs mt-1">Duration and target required</p>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setStages([...stages, { duration: "", target: 0 }])}
                  className="text-accent-primary text-sm font-medium hover:underline"
                >
                  + Add Stage
                </button>
              </div>
            </div>
          )}

          {isArrivalRateExecutor(executor) && (
            <div className={builderSubSectionClass}>
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="font-semibold">Throughput executors run without think-time</div>
                <p className="mt-1 text-xs leading-relaxed text-amber-800">
                  Fixed and ramping throughput scenarios target an iteration rate. Adding pause time between iterations
                  artificially caps the achievable request rate and leads to dropped iterations, so the Builder does not
                  apply think-time for these executors.
                </p>
              </div>
            </div>
          )}

          {/* Think-Time (VU-based executors only) */}
          {(executor === "ramping-vus" || executor === "constant-vus") && (
            <div className={builderSubSectionClass}>
              <label className="block text-sm font-medium mb-2 text-text-primary">
                Think-Time <span className="text-text-muted font-normal">(pause between iterations in seconds, 0 = max throughput)</span>
              </label>
              <input
                type="number"
                min="0"
                max="60"
                step="0.1"
                value={sleepSeconds}
                onChange={(e) => setSleepSeconds(Math.max(0, Number(e.target.value)))}
                className="w-full sm:w-48"
              />
              {sleepSeconds === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  No think-time — VUs will fire requests as fast as possible (stress test mode).
                </p>
              )}
            </div>
          )}
          </div>
        </>
      )}

      {/* UPLOAD MODE */}
      {mode === "upload" && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-text-primary">
              k6 Script (.js)
            </label>
            <div className="border border-dashed border-app-border rounded-xl p-6 text-center hover:border-accent-primary transition-colors">
              <input
                type="file"
                accept=".js"
                onChange={handleFileChange}
                className="hidden"
                id="script-upload"
              />
              <label htmlFor="script-upload" className="cursor-pointer space-y-2 block">
                {scriptFile ? (
                  <div>
                    <div className="text-text-primary font-medium">{scriptFile.name}</div>
                    <div className="text-text-muted text-xs">{(scriptFile.size / 1024).toFixed(1)} KB</div>
                  </div>
                ) : scriptPreview ? (
                  <div>
                    <div className="text-text-primary font-medium">Script loaded from previous test</div>
                    <div className="text-text-muted text-xs">{(scriptPreview.length / 1024).toFixed(1)} KB — click to replace</div>
                  </div>
                ) : (
                  <div>
                    <div className="text-text-muted text-sm">Click to select a k6 JavaScript file</div>
                    <div className="text-text-muted text-xs mt-1">Must contain export default function</div>
                  </div>
                )}
              </label>
            </div>
            {errors.script && (
              <p className="text-red-500 text-xs mt-1">{errors.script}</p>
            )}
          </div>

          {scriptPreview && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-text-primary">
                  Script Editor
                </label>
                <span className="text-[10px] text-text-muted font-mono">{(scriptPreview.length / 1024).toFixed(1)} KB</span>
              </div>
              <textarea
                value={scriptPreview}
                onChange={(e) => setScriptPreview(e.target.value)}
                spellCheck={false}
                className="w-full border border-app-border bg-app-surface text-text-primary font-mono text-xs p-4 rounded-md resize-y min-h-[200px] max-h-[500px] focus:outline-none focus:ring-1 focus:ring-accent-primary"
                rows={14}
              />
              {scriptPreview && !scriptPreview.includes("export default function") && (
                <p className="text-yellow-600 text-xs mt-1">Warning: Script should contain &quot;export default function&quot;</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* CONFIG FILE (optional, available in both modes) */}
      <div className={builderSectionClass}>
        <div>
          <label className="block text-sm font-medium text-text-primary">
            Config Overrides
          </label>
          <p className="text-text-muted text-xs mt-1">
            Upload an optional k6 config JSON to override generated or script-defined options such as stages, thresholds and scenarios.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-text-primary">
            Config File (.json) <span className="text-text-muted font-normal">— optional</span>
          </label>
          <div className={uploadDropzoneClass}>
            <input
              type="file"
              accept=".json"
              onChange={handleConfigChange}
              className="hidden"
              id="config-upload"
            />
            <label htmlFor="config-upload" className="cursor-pointer space-y-1 block">
              {configFile ? (
                <div className="flex items-center justify-between px-2">
                  <div>
                    <div className="text-text-primary font-medium text-sm">{configFile.name}</div>
                    <div className="text-text-muted text-xs">{(configFile.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setConfigFile(null)
                      setConfigPreview("")
                    }}
                    className="text-red-500 text-xs hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ) : configPreview ? (
                <div className="flex items-center justify-between px-2">
                  <div>
                    <div className="text-text-primary font-medium text-sm">Config loaded from previous test</div>
                    <div className="text-text-muted text-xs">{(configPreview.length / 1024).toFixed(1)} KB — click to replace</div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setConfigPreview("")
                    }}
                    className="text-red-500 text-xs hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div>
                  <div className="text-text-muted text-sm">Click to select a k6 config JSON file</div>
                </div>
              )}
            </label>
          </div>
          {errors.config && (
            <p className="text-red-500 text-xs mt-1">{errors.config}</p>
          )}
        </div>

        {/* Config Editor — show uploaded config as editable textarea */}
        {configPreview && mode === "upload" && (
          <div className={builderSubSectionClass}>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-text-primary">
                Config Editor
              </label>
              <span className={`text-[10px] font-mono ${configJsonValid ? "text-green-600" : "text-red-500"}`}>
                {configJsonValid ? "Valid JSON" : "Invalid JSON"}
              </span>
            </div>
            <textarea
              value={(() => {
                try { return JSON.stringify(JSON.parse(configPreview), null, 2) }
                catch { return configPreview }
              })()}
              onChange={(e) => {
                const val = e.target.value
                setConfigPreview(val)
                try {
                  const parsed = JSON.parse(val)
                  setConfigJsonValid(true)
                  setErrors((prev: any) => { const next = { ...prev }; delete next.config; return next })
                  // Sync env vars from config editor → UI (if not triggered by UI)
                  if (envSyncRef.current !== "ui" && parsed.env && typeof parsed.env === "object") {
                    const configEnv = parsed.env as Record<string, string>
                    setEnvVars((prev) => {
                      const existing = new Set(prev.map((e) => e.key))
                      const merged = prev.map((e) => ({
                        key: e.key,
                        value: configEnv[e.key] ?? e.value,
                      }))
                      for (const [k, v] of Object.entries(configEnv)) {
                        if (!existing.has(k)) merged.push({ key: k, value: String(v) })
                      }
                      return merged
                    })
                  }
                  envSyncRef.current = null
                } catch {
                  setConfigJsonValid(false)
                  setErrors((prev: any) => ({ ...prev, config: "Invalid JSON" }))
                }
              }}
              spellCheck={false}
              className={`w-full bg-app-surface text-text-primary font-mono text-xs p-4 rounded-md resize-y min-h-[160px] max-h-[400px] focus:outline-none focus:ring-1 border ${
                configJsonValid ? "border-app-border focus:ring-accent-primary" : "border-red-500 focus:ring-red-500"
              }`}
              rows={10}
            />
          </div>
        )}

        {/* Builder mode: show live-generated config preview (read-only) */}
        {mode === "builder" && !configPreview && (
          <div className={builderSubSectionClass}>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-text-primary">
                Generated Config Preview
              </label>
              <span className="text-[10px] text-text-muted">auto-generated from builder settings</span>
            </div>
            <pre className="border border-app-border bg-app-surface text-text-primary font-mono text-xs p-4 rounded-md overflow-auto max-h-48">
              {builderConfigPreview}
            </pre>
          </div>
        )}

        {/* Builder mode with uploaded config override */}
        {mode === "builder" && configPreview && (
          <div className={builderSubSectionClass}>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-text-primary">
                Config Override
              </label>
              <span className={`text-[10px] font-mono ${configJsonValid ? "text-green-600" : "text-red-500"}`}>
                {configJsonValid ? "Valid JSON" : "Invalid JSON"}
              </span>
            </div>
            <textarea
              value={(() => {
                try { return JSON.stringify(JSON.parse(configPreview), null, 2) }
                catch { return configPreview }
              })()}
              onChange={(e) => {
                const val = e.target.value
                setConfigPreview(val)
                try { JSON.parse(val); setConfigJsonValid(true); setErrors((prev: any) => { const next = { ...prev }; delete next.config; return next }) }
                catch { setConfigJsonValid(false); setErrors((prev: any) => ({ ...prev, config: "Invalid JSON" })) }
              }}
              spellCheck={false}
              className={`w-full bg-app-surface text-text-primary font-mono text-xs p-4 rounded-md resize-y min-h-[120px] max-h-[300px] focus:outline-none focus:ring-1 border ${
                configJsonValid ? "border-app-border focus:ring-accent-primary" : "border-red-500 focus:ring-red-500"
              }`}
              rows={8}
            />
          </div>
        )}
      </div>

      {/* ENVIRONMENT VARIABLES */}
      <div className={builderSectionClass}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <label className="block text-sm font-medium text-text-primary">
              Environment Variables
            </label>
            <p className="text-text-muted text-xs mt-1">
              Values entered here are passed to k6 via <span className="font-mono">__ENV</span> and merged into the generated config.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEnvVars([...envVars, { key: "", value: "" }])}
            className="text-accent-primary text-xs font-medium hover:underline"
          >
            + Add Variable
          </button>
        </div>
        {mode === "builder" && missingBuilderRuntimeItems.length > 0 && (
          <div className="inline-alert inline-alert--warning px-4 py-3">
            <div className="text-sm font-semibold">Missing Builder Runtime Values</div>
            <ul className="mt-2 space-y-1 text-xs">
              {missingBuilderRuntimeItems.map((item) => (
                <li key={item} className="font-mono">{item}</li>
              ))}
            </ul>
          </div>
        )}

        {mode === "builder" && (
          <>
            <FormSubSection>
              <FormSubSectionTitle
                title="Generated Environment Variables"
                description="These values are derived from the builder form and are automatically written into config.env for this run."
              />
              <FormSubSectionContent>
                {generatedVisibleEnvEntries.length === 0 ? (
                  <div className="rounded-lg border border-app-border bg-[var(--color-card-bg)] p-4">
                    <p className="text-text-muted text-xs">No generated builder environment variables are available yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {generatedVisibleEnvEntries.map(([key, value]) => (
                      <div key={key} className="rounded-lg border border-app-border bg-[var(--color-card-bg)] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-xs font-semibold text-text-primary">{key}</span>
                          <span className="status-badge status-badge--info">generated</span>
                        </div>
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-text-muted">{value || "(empty)"}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </FormSubSectionContent>
            </FormSubSection>

            <FormSubSection>
              <FormSubSectionTitle
                title="Sensitive Test Credentials"
                description="These generated values are intentionally kept visible in the current test-only phase so runs can be inspected and reused without hidden dependencies."
              />
              <FormSubSectionContent>
                {generatedSensitiveEnvEntries.length === 0 ? (
                  <div className="rounded-lg border border-app-border bg-[var(--color-card-bg)] p-4">
                    <p className="text-text-muted text-xs">No sensitive generated variables are active for the current builder configuration.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {generatedSensitiveEnvEntries.map(([key, value]) => (
                      <div key={key} className="rounded-lg border border-app-border bg-[var(--color-card-bg)] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-xs font-semibold text-text-primary">{key}</span>
                          <span className="status-badge status-badge--warning">sensitive</span>
                        </div>
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-text-muted">{value || "(empty)"}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </FormSubSectionContent>
            </FormSubSection>
          </>
        )}

        <FormSubSection>
          <FormSubSectionTitle
            title="Manual Environment Variables"
            description="Additional env values can be added here. In builder mode, matching keys override the generated contract for the current run."
          />
          <FormSubSectionContent>
            {envVars.length === 0 && (
              <div className="rounded-lg border border-app-border bg-[var(--color-card-bg)] p-4">
                <p className="text-text-muted text-xs">No manual environment variables configured. Load a template or add variables manually.</p>
              </div>
            )}
            {envVars.map((ev, i) => {
              const normalizedKey = ev.key.trim()
              const overridesGenerated = mode === "builder" && normalizedKey && generatedBuilderEnvKeySet.has(normalizedKey)
              return (
                <div key={i} className="space-y-2 rounded-lg border border-app-border bg-[var(--color-card-bg)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Manual override</span>
                      {overridesGenerated && (
                        <span className="status-badge status-badge--warning">overrides generated key</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setEnvVars(envVars.filter((_, idx) => idx !== i))}
                      className="rounded px-2 text-sm text-red-500 hover:bg-red-50"
                    >
                      x
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={ev.key}
                      onChange={(e) => {
                        const updated = [...envVars]
                        updated[i] = { ...updated[i], key: e.target.value }
                        setEnvVars(updated)
                      }}
                      placeholder="KEY"
                      className="w-1/3 font-mono text-xs px-3 py-2 border border-app-border rounded-md bg-[var(--color-card-bg)] text-text-primary"
                    />
                    <input
                      value={ev.value}
                      onChange={(e) => {
                        envSyncRef.current = "ui"
                        const updated = [...envVars]
                        updated[i] = { ...updated[i], value: e.target.value }
                        setEnvVars(updated)
                        // Sync into config JSON if exists
                        if (configPreview && mode === "upload") {
                          try {
                            const parsed = JSON.parse(configPreview)
                            const envBlock: Record<string, string> = parsed.env ?? {}
                            if (updated[i].key.trim()) envBlock[updated[i].key.trim()] = e.target.value
                            parsed.env = envBlock
                            setConfigPreview(JSON.stringify(parsed, null, 2))
                          } catch { /* config is invalid, skip sync */ }
                        }
                        setTimeout(() => { envSyncRef.current = null }, 0)
                      }}
                      placeholder="value"
                      className="flex-1 font-mono text-xs px-3 py-2 border border-app-border rounded-md bg-[var(--color-card-bg)] text-text-primary"
                    />
                  </div>
                </div>
              )
            })}
          </FormSubSectionContent>
        </FormSubSection>
      </div>

      {/* CONFLICT WARNINGS */}
      {warnings.length > 0 && (
        <div className="border border-yellow-300 bg-yellow-50 rounded-xl p-4 space-y-2">
          <div className="text-sm font-semibold text-yellow-800">Conflict Warnings</div>
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-yellow-700">
              <span className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-yellow-200 text-yellow-800 flex items-center justify-center font-bold text-[10px]">!</span>
              <div>
                <span className="font-medium uppercase text-[10px] tracking-wider">{w.type}</span>
                <span className="ml-1">{w.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Save Template Dialog */}
      {showSaveTemplate && (
        <div className="border border-app-border bg-[var(--color-card-bg)] rounded-xl p-4 space-y-3">
          <div className="text-sm font-medium text-text-primary">Save Current Configuration as Template</div>
          <input
            value={saveTemplateName}
            onChange={(e) => setSaveTemplateName(e.target.value)}
            placeholder="Template name"
            className="w-full"
          />
          <input
            value={saveTemplateDesc}
            onChange={(e) => setSaveTemplateDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowSaveTemplate(false)}
              className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveTemplate}
              disabled={templateSaving || !saveTemplateName.trim()}
              className="px-4 py-2 text-sm font-medium rounded-md bg-accent-primary text-white hover:bg-pink-700 transition disabled:opacity-50"
            >
              {templateSaving ? "Saving..." : "Save Template"}
            </button>
          </div>
        </div>
      )}

      {/* ACTIONS */}
      <div className="flex items-center justify-between pt-2 border-t border-app-border">
        <div className="flex items-center gap-2">
          {templates.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
                className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50 flex items-center gap-2"
              >
                <span>Load Template</span>
                <span className="text-xs">{showTemplateDropdown ? "\u25B2" : "\u25BC"}</span>
              </button>
              {showTemplateDropdown && (
                <div className="absolute bottom-full left-0 mb-1 w-80 bg-[var(--color-card-bg)] border border-app-border rounded-xl shadow-lg z-20 max-h-80 overflow-y-auto">
                  {/* System templates first */}
                  {templates.some(t => t.system) && (
                    <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted bg-app-surface border-b border-app-border">
                      System Templates
                    </div>
                  )}
                  {templates.filter(t => t.system).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => loadTemplate(t)}
                      className="w-full text-left px-4 py-3 hover:bg-app-surface transition border-b border-app-border last:border-b-0"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary truncate">{t.name}</span>
                        {t.executor && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-gray-100 text-gray-500 font-mono">
                            {t.executor}
                          </span>
                        )}
                      </div>
                      {t.description && (
                        <div className="text-xs text-text-muted truncate mt-0.5">{t.description}</div>
                      )}
                    </button>
                  ))}
                  {/* User templates */}
                  {templates.some(t => !t.system) && (
                    <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted bg-app-surface border-b border-app-border">
                      {user?.role === "admin" ? "User Templates" : "My Templates"}
                    </div>
                  )}
                  {templates.filter(t => !t.system).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => loadTemplate(t)}
                      className="w-full text-left px-4 py-3 hover:bg-app-surface transition border-b border-app-border last:border-b-0"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-primary truncate">{t.name}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${
                          t.mode === "builder" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                        }`}>
                          {t.mode}
                        </span>
                      </div>
                      {t.description && (
                        <div className="text-xs text-text-muted truncate mt-0.5">{t.description}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowSaveTemplate(!showSaveTemplate)}
            className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
          >
            Save as Template
          </button>
        </div>

        {(configPreview?.includes("target-lb") || url?.includes("target-lb") || scriptPreview?.includes("target-lb")) && (
          <p className="text-xs px-3 py-2 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            This test targets the built-in dummy service (target-lb). Results reflect infrastructure performance, not a real system under test.
          </p>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading}
          className={`px-6 py-3 text-sm font-medium rounded-md transition disabled:opacity-50 ${
            loading
              ? "border border-app-border text-text-muted cursor-not-allowed bg-app-surface"
              : "bg-accent-primary text-white hover:bg-pink-700"
          }`}
        >
          {loading ? "Running..." : "Run Load Test"}
        </button>
      </div>

      {/* PROGRESS MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div
            className="border border-app-border bg-[var(--color-card-bg)] w-[calc(100vw-2rem)] max-w-[680px] max-h-[90vh] p-4 sm:p-6 shadow-lg rounded-xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-accent-primary">
                {paused ? "Test Paused" : steps.collecting === "running" ? "Collecting Final Results" : "Generating Load"}
                {loading && !paused && (
                  <span className="w-2 h-2 bg-accent-primary rounded-full animate-ping" />
                )}
                {paused && (
                  <span className="w-2 h-2 bg-yellow-400 rounded-full" />
                )}
              </h2>
              {currentVUs > 0 && (
                <div className="text-xs text-text-muted">
                  <span className="font-mono font-bold text-accent-primary text-sm">{currentVUs}</span> VUs active
                </div>
              )}
            </div>

            {/* Progress bar */}
            <div className="w-full border border-app-border bg-app-surface h-3 mb-2 overflow-hidden rounded-full">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  paused ? "bg-yellow-400" : "bg-accent-primary"
                } ${loading && !paused ? "animate-subtle-pulse" : ""}`}
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="text-sm text-text-muted mb-3">
              {progress}% complete{paused ? " — paused" : ""}
              {!paused && steps.collecting === "running" ? " — load generation finished, waiting for summaries and final metrics" : ""}
            </div>

            {/* Phase steps */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 mb-3 text-xs">
              {[
                { key: "script", label: "Script Preparation" },
                { key: "workers", label: "Worker Preparation" },
                { key: "load", label: "Load Generation" },
                { key: "collecting", label: "Result Collection" },
              ].map((step) => (
                <div key={step.key} className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      steps[step.key] === "done"
                        ? "bg-green-500"
                        : steps[step.key] === "running"
                        ? "bg-yellow-400 animate-pulse"
                        : steps[step.key] === "error"
                        ? "bg-red-500"
                        : "bg-app-border"
                    }`}
                  />
                  <span className="text-text-primary">{step.label}</span>
                </div>
              ))}
            </div>

            {/* Threshold warnings */}
            {liveThresholds.some(t => !t.passed) && (
              <div className="border border-red-200 bg-red-50 rounded-md px-3 py-2 mb-3">
                <div className="text-xs font-semibold text-red-700 mb-1">Threshold Breached</div>
                <div className="flex flex-wrap gap-1.5">
                  {liveThresholds.filter(t => !t.passed).map((t, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">
                      &#x2717; {t.metric}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* All thresholds passing indicator */}
            {liveThresholds.length > 0 && liveThresholds.every(t => t.passed) && (
              <div className="border border-green-200 bg-green-50 rounded-md px-3 py-2 mb-3">
                <div className="flex items-center gap-2 text-xs text-green-700">
                  <span className="text-sm">&#x2713;</span>
                  <span className="font-medium">All {liveThresholds.length} thresholds passing</span>
                </div>
              </div>
            )}

            {/* === TEST CONTROLS === */}
            {steps.load === "running" && (
              <div className="border border-app-border rounded-xl p-3 mb-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs uppercase tracking-wider text-text-muted font-medium">Test Controls</div>
                  {!controllable && (
                    <div className="text-[10px] text-text-muted bg-gray-100 px-2 py-0.5 rounded">
                      Native executor — k6 manages schedule
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Pause / Resume — only for controllable executors */}
                  {controllable && (
                    <button
                      onClick={handlePauseResume}
                      disabled={controlBusy}
                      className={`px-4 py-2 text-sm font-medium rounded-md transition disabled:opacity-50 ${
                        paused
                          ? "bg-green-600 text-white hover:bg-green-700"
                          : "bg-yellow-500 text-white hover:bg-yellow-600"
                      }`}
                    >
                      {paused ? "\u25B6 Resume" : "\u275A\u275A Pause"}
                    </button>
                  )}

                  {/* Stop — always available */}
                  <button
                    onClick={handleStop}
                    disabled={controlBusy}
                    className="px-4 py-2 text-sm font-medium rounded-md border border-red-200 text-red-600 hover:bg-red-50 transition disabled:opacity-50"
                  >
                    &#x25A0; Stop Test
                  </button>

                  {/* VU Scaling — only for controllable executors */}
                  {controllable && (
                    <div className="flex items-center gap-2 ml-auto">
                      <input
                        type="number"
                        min="1"
                        value={vuInput}
                        onChange={(e) => setVuInput(e.target.value)}
                        placeholder={String(currentVUs || "VUs")}
                        className="w-20 text-sm px-3 py-2 border border-app-border rounded-md bg-[var(--color-card-bg)] text-text-primary"
                      />
                      <button
                        onClick={handleScale}
                        disabled={controlBusy || !vuInput}
                        className="px-4 py-2 text-sm font-medium rounded-md bg-accent-primary text-white hover:bg-pink-700 transition disabled:opacity-50"
                      >
                        Scale VUs
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Metrics log */}
            <div className="border border-app-border bg-app-surface text-text-primary font-mono text-xs p-4 overflow-y-auto flex-1 min-h-[120px] rounded-md">
              {logs.length === 0 && (
                <div className="text-text-muted">Waiting for metrics...</div>
              )}
              {logs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* Toast with auto-dismiss */
function Toast({ type, message, onClose }: { type: "success" | "error"; message: string; onClose: () => void }) {
  useEffect(() => {
    const timeout = type === "error" ? 8000 : 4000
    const timer = setTimeout(onClose, timeout)
    return () => clearTimeout(timer)
  }, [type, message, onClose])

  return (
    <div
      className={`fixed top-6 right-6 max-w-md px-5 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-in z-[60] cursor-pointer ${
        type === "error" ? "bg-red-500 text-white" : "bg-green-600 text-white"
      }`}
      onClick={onClose}
    >
      {message}
    </div>
  )
}
