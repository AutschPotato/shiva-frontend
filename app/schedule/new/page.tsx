"use client"

import { Suspense, useEffect, useState, useMemo, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "@/context/SessionContext"
import {
  AuthConfigSection,
  buildAuthPayload,
  createDefaultAuthInput,
  hydrateAuthInput,
  validateAuthInput,
} from "@/components/AuthConfigSection"
import {
  createSchedule, checkScheduleConflict, listTemplates,
  type AuthInput, type CreateSchedulePayload, type Template,
} from "@/lib/api"
import { motion } from "framer-motion"
import { staggerContainer, revealItem } from "@/lib/motion-variants"
import {
  ArrowLeft, Calendar, Clock, AlertTriangle, Check, Layers,
  Upload, FileText, X,
} from "lucide-react"

type ExecutorType = "ramping-vus" | "constant-vus" | "constant-arrival-rate" | "ramping-arrival-rate"
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

const VALID_HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"]
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

function parseConfigEnv(configContent?: string): Record<string, string> {
  if (!configContent) return {}
  try {
    const parsed = JSON.parse(configContent)
    return parsed?.env ?? {}
  } catch {
    return {}
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
  return merged
}

function buildBuilderConfigContent(args: {
  configContent: string
  url: string
  httpMethod: HttpMethod
  contentType: string
  payloadJson: string
  payloadTargetKiB: number
  auth: AuthInput
}) {
  const envBlock = buildBuilderEnvContract(args)
  const config = args.configContent.trim() ? JSON.parse(args.configContent) : {}
  const nextEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(config.env ?? {})) {
    if (!BUILDER_CONFIG_ENV_KEYS.has(key)) nextEnv[key] = String(value)
  }
  for (const [key, value] of Object.entries(envBlock)) {
    nextEnv[key] = value
  }
  config.env = nextEnv
  return JSON.stringify(config)
}

export default function NewSchedulePageWrapper() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-text-muted">Loading...</div>}>
      <NewSchedulePage />
    </Suspense>
  )
}

function NewSchedulePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, token, initialized: ready } = useSession()

  // Schedule fields
  const [name, setName] = useState("")
  const [projectName, setProjectName] = useState("")
  const [scheduledAt, setScheduledAt] = useState("")
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [recurrenceType, setRecurrenceType] = useState("once")
  const [recurrenceEnd, setRecurrenceEnd] = useState("")
  const [estimatedDurationOverride, setEstimatedDurationOverride] = useState(0)

  // Test config fields
  const [mode, setMode] = useState<"builder" | "upload">("upload")
  const [url, setUrl] = useState("")
  const [executor, setExecutor] = useState<ExecutorType>("ramping-vus")
  const [stages, setStages] = useState<{ duration: string; target: number }[]>([{ duration: "1m", target: 10 }])
  const [httpMethod, setHttpMethod] = useState<HttpMethod>("GET")
  const [contentType, setContentType] = useState("application/json")
  const [payloadJson, setPayloadJson] = useState("")
  const [payloadFileName, setPayloadFileName] = useState("")
  const [payloadTargetKiB, setPayloadTargetKiB] = useState(0)
  const [authConfig, setAuthConfig] = useState<AuthInput>(createDefaultAuthInput())
  const [scriptContent, setScriptContent] = useState("")
  const [configContent, setConfigContent] = useState("")
  const [scriptFileName, setScriptFileName] = useState("")
  const [configFileName, setConfigFileName] = useState("")

  // UI state
  const [loading, setLoading] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const [conflictChecking, setConflictChecking] = useState(false)
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)

  const scriptInputRef = useRef<HTMLInputElement>(null)
  const configInputRef = useRef<HTMLInputElement>(null)
  const payloadInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ready && !user) router.replace("/login")
  }, [ready, user, router])

  // Load templates
  useEffect(() => {
    if (token) listTemplates(token).then(r => setTemplates(r.templates ?? [])).catch(() => {})
  }, [token])

  // Clone hydration from Result View or Templates page
  useEffect(() => {
    if (searchParams.get("schedule") !== "true") return
    const raw = localStorage.getItem("k6-schedule-test")
    if (!raw) return
    localStorage.removeItem("k6-schedule-test")
    try {
      const clone = JSON.parse(raw)
      const configHydration = hydrateBuilderRuntimeFromConfig(clone.config_content)
      if (clone.mode === "builder" || clone.url || clone.stages) setMode("builder")
      if (clone.url || configHydration.url) setUrl(clone.url || configHydration.url)
      if (clone.executor) setExecutor(clone.executor)
      if (clone.stages && clone.stages.length > 0) setStages(clone.stages)
      if (clone.http_method || configHydration.httpMethod) setHttpMethod(clone.http_method || configHydration.httpMethod)
      if (clone.content_type || configHydration.contentType) setContentType(clone.content_type || configHydration.contentType)
      if (clone.payload_json || configHydration.payloadJson) setPayloadJson(clone.payload_json || configHydration.payloadJson)
      if (clone.payload_target_kib || configHydration.payloadTargetKiB) setPayloadTargetKiB(clone.payload_target_kib || configHydration.payloadTargetKiB)
      if (clone.auth || configHydration.auth.auth_enabled) setAuthConfig(mergeAuthInputs(clone.auth ? hydrateAuthInput(clone.auth) : undefined, configHydration.auth))
      if (clone.script_content) setScriptContent(clone.script_content)
      if (clone.config_content) setConfigContent(clone.config_content)
      if (clone.project_name) setProjectName(clone.project_name)
      if (clone.name) setName(clone.name)
      setToast({ type: "success", message: "Test configuration loaded" })
    } catch { /* ignore */ }
  }, [searchParams])

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000)
      return () => clearTimeout(t)
    }
  }, [toast])

  // Auto-calculate duration from config
  const autoDuration = useMemo(() => {
    if (!configContent) return 0
    try {
      const parsed = JSON.parse(configContent)
      let maxDur = 0
      // Check top-level duration
      if (parsed.duration) {
        maxDur = parseDur(parsed.duration)
      }
      // Check scenarios
      if (parsed.scenarios) {
        for (const sc of Object.values(parsed.scenarios) as any[]) {
          let d = 0
          if (sc.duration) d = parseDur(sc.duration)
          if (sc.stages && Array.isArray(sc.stages)) {
            const stageTotal = sc.stages.reduce((acc: number, s: any) => acc + parseDur(s.duration || ""), 0)
            if (stageTotal > d) d = stageTotal
          }
          if (d > maxDur) maxDur = d
        }
      }
      return maxDur
    } catch { return 0 }
  }, [configContent])

  // Also try to extract from script
  const scriptDuration = useMemo(() => {
    if (!scriptContent) return 0
    const matches = scriptContent.matchAll(/duration:\s*['"](\d+[smh])['"]/g)
    let maxDur = 0
    for (const m of matches) {
      const d = parseDur(m[1])
      if (d > maxDur) maxDur = d
    }
    return maxDur
  }, [scriptContent])

  const builderDuration = useMemo(() => {
    if (mode !== "builder") return 0
    return stages.reduce((acc, stage) => acc + parseDur(stage.duration || ""), 0)
  }, [mode, stages])

  const payloadError = useMemo(() => {
    if (mode !== "builder" || !methodAllowsPayload(httpMethod) || !payloadJson.trim()) return null
    try {
      JSON.parse(payloadJson)
      return null
    } catch {
      return "Payload JSON must be valid JSON"
    }
  }, [mode, httpMethod, payloadJson])
  const authError = useMemo(() => {
    if (mode !== "builder") return null
    return validateAuthInput(authConfig, { requireSecret: true })
  }, [authConfig, mode])

  const effectiveDuration = estimatedDurationOverride > 0
    ? estimatedDurationOverride
    : (mode === "builder" ? (builderDuration || autoDuration || scriptDuration) : (autoDuration || scriptDuration))

  // Check conflict when date changes
  useEffect(() => {
    if (!scheduledAt || !token || effectiveDuration <= 0) {
      setConflict(null)
      return
    }
    const iso = new Date(scheduledAt).toISOString()
    const timer = setTimeout(async () => {
      setConflictChecking(true)
      try {
        const res = await checkScheduleConflict(iso, effectiveDuration + 30, undefined, token)
        if (res.conflict && res.conflicting_schedule) {
          const c = res.conflicting_schedule
          setConflict(`Conflicts with "${c.schedule_name || "running test"}" (${new Date(c.start).toLocaleString()} – ${new Date(c.end).toLocaleString()})`)
        } else {
          setConflict(null)
        }
      } catch {
        setConflict(null)
      }
      setConflictChecking(false)
    }, 500)
    return () => clearTimeout(timer)
  }, [scheduledAt, effectiveDuration, token])

  // File handlers
  const handleScriptFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setScriptFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      setScriptContent(ev.target?.result as string || "")
    }
    reader.readAsText(file)
  }

  const handleConfigFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setConfigFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const content = ev.target?.result as string || ""
      setConfigContent(content)
      try {
        JSON.parse(content)
        setConfigError(null)
      } catch {
        setConfigError("Invalid JSON")
      }
    }
    reader.readAsText(file)
  }

  const handlePayloadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      setPayloadFileName("")
      return
    }
    setPayloadFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      setPayloadJson((ev.target?.result as string) || "")
    }
    reader.onerror = () => {
      setPayloadFileName("")
      setToast({ type: "error", message: "Failed to read payload file" })
    }
    reader.readAsText(file)
  }

  const loadTemplate = (t: Template) => {
    if (t.mode === "builder" || t.url) {
      const configHydration = hydrateBuilderRuntimeFromConfig(t.config_content)
      setMode("builder")
      if (t.url || configHydration.url) setUrl(t.url || configHydration.url)
      if (t.executor) setExecutor(t.executor as ExecutorType)
      if (t.stages && t.stages.length > 0) setStages(t.stages)
      if (t.http_method || configHydration.httpMethod) setHttpMethod((t.http_method as HttpMethod) || configHydration.httpMethod || "GET")
      if (t.content_type || configHydration.contentType) setContentType(t.content_type || configHydration.contentType)
      if (t.payload_json || configHydration.payloadJson) setPayloadJson(t.payload_json || configHydration.payloadJson)
      if (t.payload_target_kib || configHydration.payloadTargetKiB) setPayloadTargetKiB(t.payload_target_kib || configHydration.payloadTargetKiB)
      setAuthConfig(mergeAuthInputs(t.auth ? hydrateAuthInput(t.auth) : undefined, configHydration.auth))
    } else {
      setMode("upload")
      setAuthConfig(createDefaultAuthInput())
    }
    if (t.script_content) setScriptContent(t.script_content)
    if (t.config_content) setConfigContent(t.config_content)
    if (!projectName) setProjectName(t.name)
    if (!name) setName(t.name)
    setScriptFileName("")
    setConfigFileName("")
    setShowTemplates(false)
    setToast({ type: "success", message: `Template "${t.name}" loaded` })
  }

  const handleSubmit = async () => {
    if (!token) return
    if (!name.trim()) { setToast({ type: "error", message: "Name is required" }); return }
    if (!projectName.trim()) { setToast({ type: "error", message: "Project name is required" }); return }
    if (!scheduledAt) { setToast({ type: "error", message: "Scheduled time is required" }); return }
    if (mode === "upload" && !scriptContent.trim()) { setToast({ type: "error", message: "A k6 script is required — upload a file or load a template" }); return }
    if (mode === "builder" && !url.trim()) { setToast({ type: "error", message: "Target URL is required for builder schedules" }); return }
    if (payloadError) { setToast({ type: "error", message: payloadError }); return }
    if (authError) { setToast({ type: "error", message: authError }); return }
    if (effectiveDuration <= 0) { setToast({ type: "error", message: "Could not determine test duration. Enter an estimated duration manually." }); return }
    if (conflict) { setToast({ type: "error", message: "Resolve the schedule conflict first" }); return }

    setLoading(true)
    try {
      const payload: CreateSchedulePayload = {
        name: name.trim(),
        project_name: projectName.trim(),
        mode,
        scheduled_at: new Date(scheduledAt).toISOString(),
        timezone,
        recurrence_type: recurrenceType,
        recurrence_end: recurrenceEnd ? new Date(recurrenceEnd).toISOString() : undefined,
        url: mode === "builder" ? url : undefined,
        executor: mode === "builder" ? executor : undefined,
        stages: mode === "builder" ? stages : undefined,
        http_method: mode === "builder" ? httpMethod : undefined,
        content_type: mode === "builder" && methodAllowsPayload(httpMethod) ? contentType : undefined,
        payload_json: mode === "builder" && methodAllowsPayload(httpMethod) ? payloadJson || undefined : undefined,
        payload_target_kib: mode === "builder" && methodAllowsPayload(httpMethod) && payloadTargetKiB > 0 ? payloadTargetKiB : undefined,
        auth: mode === "builder" ? buildAuthPayload(authConfig, { mode: "schedule" }) : undefined,
        script_content: mode === "upload" ? scriptContent : undefined,
        config_content: mode === "builder"
          ? buildBuilderConfigContent({
              configContent,
              url,
              httpMethod,
              contentType,
              payloadJson,
              payloadTargetKiB,
              auth: authConfig,
            })
          : (configContent || undefined),
        estimated_duration_s: effectiveDuration,
      }

      await createSchedule(payload, token)
      router.push("/schedule")
    } catch (err: any) {
      setToast({ type: "error", message: err?.message || "Failed to create schedule" })
    }
    setLoading(false)
  }

  if (!ready || !user) return null

  const inputClass = "w-full px-3 py-2 text-sm rounded-lg border border-app-border bg-[var(--color-card-bg)] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/30 focus:border-accent-primary transition"
  const labelClass = "block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5"

  return (
    <motion.div className="space-y-6" variants={staggerContainer} initial="initial" animate="enter">
      {/* Header */}
      <motion.div variants={revealItem} className="flex items-center">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-app-surface-alt transition text-text-muted">
          <ArrowLeft size={18} />
        </button>
      </motion.div>

      {/* Toast */}
      {toast && (
        <div className={`px-4 py-2 rounded-lg text-sm font-medium ${toast.type === "success" ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300" : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"}`}>
          {toast.message}
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* LEFT: Schedule Details */}
        <motion.div variants={revealItem} className="rounded-xl border border-app-border p-5 space-y-4 self-start" style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)" }}>
          <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <Calendar size={16} className="text-accent-primary" /> Schedule Details
          </h2>

          <div>
            <label className={labelClass}>Schedule Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nightly Load Test" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Project Name</label>
            <input type="text" value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="api-v2" className={inputClass} />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Start Date & Time</label>
              <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Timezone</label>
              <select value={timezone} onChange={e => setTimezone(e.target.value)} className={inputClass}>
                {["UTC", "Europe/Berlin", "Europe/London", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney"].map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Recurrence</label>
              <select value={recurrenceType} onChange={e => setRecurrenceType(e.target.value)} className={inputClass}>
                <option value="once">Once</option>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            {recurrenceType !== "once" && (
              <div>
                <label className={labelClass}>Recurrence End (optional)</label>
                <input type="datetime-local" value={recurrenceEnd} onChange={e => setRecurrenceEnd(e.target.value)} className={inputClass} />
              </div>
            )}
          </div>

          {/* Duration */}
          <div className="rounded-lg border border-app-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-muted uppercase">Estimated Duration</span>
              {effectiveDuration > 0 && (
                <span className="flex items-center gap-1 text-xs font-semibold text-accent-primary">
                  <Clock size={12} /> {Math.ceil(effectiveDuration / 60)} min
                </span>
              )}
            </div>
            {(autoDuration > 0 || scriptDuration > 0) ? (
              <p className="text-[11px] text-text-muted">Auto-detected from {autoDuration > 0 ? "config" : "script"}. Override below if needed.</p>
            ) : (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">Could not auto-detect. Enter duration manually.</p>
            )}
            <input
              type="number" min={1} placeholder="Duration in seconds (e.g. 120)"
              value={estimatedDurationOverride || ""}
              onChange={e => setEstimatedDurationOverride(+e.target.value)}
              className={inputClass}
            />
          </div>

          {/* Conflict indicator */}
          <div>
            {conflictChecking && <span className="text-xs text-text-muted">Checking conflicts...</span>}
            {conflict && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-semibold">
                <AlertTriangle size={12} /> {conflict}
              </div>
            )}
            {scheduledAt && effectiveDuration > 0 && !conflict && !conflictChecking && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs font-semibold">
                <Check size={12} /> No conflicts
              </div>
            )}
          </div>
        </motion.div>

        {/* RIGHT: Test Configuration */}
        <motion.div variants={revealItem} className="rounded-xl border border-app-border p-5 space-y-4 self-start" style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <FileText size={16} className="text-accent-primary" /> Test Configuration
            </h2>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-app-border overflow-hidden text-xs">
                <button onClick={() => setMode("upload")} className={`px-3 py-1.5 transition ${mode === "upload" ? "bg-accent-primary text-white" : "text-text-muted hover:bg-app-surface-alt"}`}>Upload</button>
                <button onClick={() => setMode("builder")} className={`px-3 py-1.5 transition ${mode === "builder" ? "bg-accent-primary text-white" : "text-text-muted hover:bg-app-surface-alt"}`}>Builder</button>
              </div>
              <button onClick={() => setShowTemplates(!showTemplates)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-app-border text-text-muted hover:bg-app-surface-alt transition">
                <Layers size={12} /> {showTemplates ? "Hide" : "Load Template"}
              </button>
            </div>
          </div>

          {/* Template selector */}
          {showTemplates && (
            <div className="border border-app-border rounded-lg max-h-48 overflow-y-auto">
              {templates.length === 0 ? (
                <div className="px-4 py-3 text-xs text-text-muted">No templates available. Create one via Run Test → Save as Template.</div>
              ) : templates.map(t => (
                <button key={t.id} onClick={() => loadTemplate(t)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-app-surface-alt transition border-b border-app-border/50 last:border-0">
                  <span className="font-medium text-text-primary">{t.name}</span>
                  {t.system && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-accent-primary/10 text-accent-primary font-semibold">System</span>}
                  <span className="text-text-muted ml-2 text-xs">{t.executor || t.mode}</span>
                  {t.description && <p className="text-text-muted text-xs mt-0.5 truncate">{t.description}</p>}
                </button>
              ))}
            </div>
          )}

          {mode === "builder" ? (
            <div className="space-y-4 rounded-lg border border-app-border p-4">
              <div>
                <label className={labelClass}>Target URL *</label>
                <input type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.example.com/orders" className={inputClass} />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Executor</label>
                  <select value={executor} onChange={e => setExecutor(e.target.value as ExecutorType)} className={inputClass}>
                    <option value="ramping-vus">Ramping VUs</option>
                    <option value="constant-vus">Constant VUs</option>
                    <option value="constant-arrival-rate">Constant Arrival Rate</option>
                    <option value="ramping-arrival-rate">Ramping Arrival Rate</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>HTTP Method</label>
                  <select value={httpMethod} onChange={e => setHttpMethod(e.target.value as HttpMethod)} className={inputClass}>
                    {VALID_HTTP_METHODS.map(method => <option key={method} value={method}>{method}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass}>Stages</label>
                <div className="space-y-2">
                  {stages.map((stage, index) => (
                    <div key={index} className="flex gap-2">
                      <input value={stage.duration} onChange={e => setStages(prev => prev.map((item, i) => i === index ? { ...item, duration: e.target.value } : item))} placeholder="1m" className={inputClass} />
                      <input type="number" min={1} value={stage.target || ""} onChange={e => setStages(prev => prev.map((item, i) => i === index ? { ...item, target: Number(e.target.value) || 0 } : item))} placeholder="Target" className={inputClass} />
                      {stages.length > 1 && (
                        <button type="button" onClick={() => setStages(prev => prev.filter((_, i) => i !== index))} className="px-3 rounded-lg border border-app-border text-text-muted hover:bg-app-surface-alt">X</button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => setStages(prev => [...prev, { duration: "1m", target: 10 }])} className="text-xs font-medium text-accent-primary hover:underline">
                    + Add Stage
                  </button>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Content-Type</label>
                  <input value={contentType} onChange={e => setContentType(e.target.value)} disabled={!methodAllowsPayload(httpMethod)} className={`${inputClass} disabled:opacity-60`} />
                </div>
                <div>
                  <label className={labelClass}>Target Size (KiB)</label>
                  <input type="number" min={0} value={payloadTargetKiB} onChange={e => setPayloadTargetKiB(Number(e.target.value) || 0)} disabled={!methodAllowsPayload(httpMethod)} className={`${inputClass} disabled:opacity-60`} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Payload JSON</label>
                <input ref={payloadInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handlePayloadFile} />
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => payloadInputRef.current?.click()}
                    disabled={!methodAllowsPayload(httpMethod)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-60"
                  >
                    Upload payload.json
                  </button>
                  {payloadFileName && (
                    <span className="inline-flex items-center gap-2 rounded-md border border-app-border px-2.5 py-1 text-[11px] text-text-muted">
                      <span className="font-medium text-text-primary">{payloadFileName}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setPayloadFileName("")
                          setPayloadJson("")
                          if (payloadInputRef.current) payloadInputRef.current.value = ""
                        }}
                        className="text-red-500 hover:text-red-600"
                      >
                        Clear
                      </button>
                    </span>
                  )}
                </div>
                <textarea
                  value={payloadJson}
                  onChange={e => {
                    setPayloadJson(e.target.value)
                    if (payloadFileName) setPayloadFileName("")
                  }}
                  disabled={!methodAllowsPayload(httpMethod)}
                  rows={8}
                  className={`${inputClass} font-mono text-xs disabled:opacity-60 ${payloadError ? "border-red-500" : ""}`}
                  placeholder='{"message":"hello"}'
                />
                {methodAllowsPayload(httpMethod) && (
                  <p className="mt-2 text-[11px] text-text-muted">Paste JSON directly or load a `.json` payload file.</p>
                )}
                {payloadError && <p className="mt-2 text-xs text-red-500">{payloadError}</p>}
              </div>
              <AuthConfigSection
                value={authConfig}
                onChange={setAuthConfig}
                mode="schedule"
              />
              {authError && <p className="text-xs text-red-500">{authError}</p>}
            </div>
          ) : (
            <div>
              <label className={labelClass}>k6 Script *</label>
              <input ref={scriptInputRef} type="file" accept=".js,.ts,.mjs" className="hidden" onChange={handleScriptFile} />
              <div
                onClick={() => scriptInputRef.current?.click()}
                className="border-2 border-dashed border-app-border rounded-lg p-4 text-center cursor-pointer hover:border-accent-primary/40 hover:bg-accent-primary/5 transition"
              >
                {scriptFileName ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-text-primary">
                    <FileText size={16} className="text-accent-primary" />
                    <span className="font-medium">{scriptFileName}</span>
                    <button onClick={(e) => { e.stopPropagation(); setScriptContent(""); setScriptFileName(""); }} className="text-text-muted hover:text-red-500">
                      <X size={14} />
                    </button>
                  </div>
                ) : scriptContent ? (
                  <div className="text-sm text-text-primary">
                    <FileText size={16} className="mx-auto text-accent-primary mb-1" />
                    <span className="font-medium">Script loaded</span>
                    <span className="text-text-muted ml-1">({(scriptContent.length / 1024).toFixed(1)} KB)</span>
                  </div>
                ) : (
                  <div className="text-text-muted text-sm">
                    <Upload size={20} className="mx-auto mb-1 opacity-50" />
                    <p>Click to upload a <strong>.js</strong> script file</p>
                    <p className="text-[10px] mt-1">or load a template above</p>
                  </div>
                )}
              </div>
              {scriptContent && (
                <textarea
                  value={scriptContent}
                  onChange={e => setScriptContent(e.target.value)}
                  rows={10}
                  className={`${inputClass} font-mono text-xs mt-2`}
                  placeholder="Script content..."
                />
              )}
            </div>
          )}

          {/* Config Upload */}
          <div>
            <label className={labelClass}>Config JSON (optional)</label>
            <input ref={configInputRef} type="file" accept=".json" className="hidden" onChange={handleConfigFile} />
            <div
              onClick={() => configInputRef.current?.click()}
              className="border-2 border-dashed border-app-border rounded-lg p-3 text-center cursor-pointer hover:border-accent-primary/40 hover:bg-accent-primary/5 transition"
            >
              {configFileName ? (
                <div className="flex items-center justify-center gap-2 text-sm text-text-primary">
                  <FileText size={14} className="text-accent-primary" />
                  <span className="font-medium">{configFileName}</span>
                  <button onClick={(e) => { e.stopPropagation(); setConfigContent(""); setConfigFileName(""); setConfigError(null); }} className="text-text-muted hover:text-red-500">
                    <X size={14} />
                  </button>
                </div>
              ) : configContent ? (
                <div className="text-sm text-text-primary">
                  <span className="font-medium">Config loaded</span>
                  <span className="text-text-muted ml-1">({(configContent.length / 1024).toFixed(1)} KB)</span>
                </div>
              ) : (
                <div className="text-text-muted text-xs">
                  <Upload size={16} className="mx-auto mb-1 opacity-50" />
                  Click to upload config.json
                </div>
              )}
            </div>
            {configError && <p className="text-red-500 text-xs mt-1">{configError}</p>}
            {configContent && (
              <textarea
                value={configContent}
                onChange={e => {
                  setConfigContent(e.target.value)
                  try { JSON.parse(e.target.value); setConfigError(null) } catch { setConfigError("Invalid JSON") }
                }}
                rows={6}
                className={`${inputClass} font-mono text-xs mt-2 ${configError ? "border-red-500" : ""}`}
                placeholder="Config JSON..."
              />
            )}
          </div>
        </motion.div>
      </div>

      {/* Submit */}
      <motion.div variants={revealItem} className="flex justify-end gap-3">
        <button onClick={() => router.back()} className="px-5 py-2.5 text-sm font-medium rounded-lg border border-app-border text-text-muted hover:bg-app-surface-alt transition">
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading || !!conflict || (mode === "upload" && !scriptContent)}
          className="px-6 py-2.5 text-sm font-medium rounded-lg bg-accent-primary text-white hover:bg-pink-700 transition disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create Schedule"}
        </button>
      </motion.div>
    </motion.div>
  )
}

function parseDur(d: string): number {
  if (!d) return 0
  const m = d.match(/^(\d+)(s|m|h)$/)
  if (!m) return 0
  const v = parseInt(m[1])
  switch (m[2]) {
    case "s": return v
    case "m": return v * 60
    case "h": return v * 3600
    default: return v
  }
}
