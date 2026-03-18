import type { UserProfile } from "@/types/user"

const PROXY_PREFIX = "/api/backend"

// --- Low-level helpers ---------------------------------------------------

function bearerHeader(token?: string | null): Record<string, string> {
  if (!token || token === "undefined" || token === "null") return {}
  return { Authorization: `Bearer ${token}` }
}

function buildQuery(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    search.set(key, String(value))
  }

  const query = search.toString()
  return query ? `?${query}` : ""
}

function withQuery(endpoint: string, params: Record<string, string | number | null | undefined>): string {
  return `${endpoint}${buildQuery(params)}`
}

async function jsonFetch<T = any>(
  endpoint: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers: extraHeaders, ...rest } = init

  const res = await fetch(`${PROXY_PREFIX}${endpoint}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...bearerHeader(token),
      ...(extraHeaders as Record<string, string> ?? {}),
    },
    cache: "no-store",
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(body || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

function post<T = any>(endpoint: string, body: unknown, token?: string | null) {
  return jsonFetch<T>(endpoint, { method: "POST", body: JSON.stringify(body), token })
}

function put<T = any>(endpoint: string, body: unknown, token?: string | null) {
  return jsonFetch<T>(endpoint, { method: "PUT", body: JSON.stringify(body), token })
}

function del<T = any>(endpoint: string, token?: string | null) {
  return jsonFetch<T>(endpoint, { method: "DELETE", token })
}

function get<T = any>(endpoint: string, token?: string | null) {
  return jsonFetch<T>(endpoint, { token })
}

function postEmpty<T = any>(endpoint: string, token?: string | null) {
  return post<T>(endpoint, {}, token)
}

function resultPath(id?: string): string {
  return id ? `/api/result/${id}` : "/api/result/list"
}

function templatePath(id?: string): string {
  return id ? `/api/templates/${id}` : "/api/templates"
}

function schedulePath(id?: string, suffix = ""): string {
  if (!id) return "/api/schedules"
  return `/api/schedules/${id}${suffix}`
}

// --- Authentication ------------------------------------------------------

export interface Credentials {
  identifier: string
  password: string
}

interface AuthResponse {
  token: string
  user: UserProfile
}

export interface ForgotPasswordResponse {
  message: string
}

export interface CompletePasswordResetResponse {
  message: string
}

export async function authenticate(creds: Credentials): Promise<AuthResponse> {
  return post<AuthResponse>("/api/auth/login", {
    username: creds.identifier,
    password: creds.password,
  })
}

export function requestPasswordReset(identifier: string) {
  return post<ForgotPasswordResponse>("/api/auth/forgot-password", { identifier })
}

export function completePasswordReset(payload: { token: string; new_password: string }) {
  return post<CompletePasswordResetResponse>("/api/auth/reset-password", payload)
}

// --- Users ---------------------------------------------------------------

export interface AdminUserMetrics {
  total_tests: number
  completed_tests: number
  failed_tests: number
  total_schedules: number
  active_schedules: number
  total_templates: number
  last_test_at?: string | null
}

export interface AdminUserRecord {
  id: string
  username: string
  email: string
  role: "admin" | "user"
  must_change_password?: boolean
  created_at: string | null
  updated_at?: string | null
  metrics: AdminUserMetrics
}

export interface ProfileSummaryResponse {
  user: UserProfile
  metrics: AdminUserMetrics
}

export interface AuthConfig {
  auth_enabled: boolean
  auth_mode?: string
  auth_token_url?: string
  auth_client_id?: string
  auth_client_auth_method?: string
  auth_refresh_skew_seconds?: number
  auth_secret_source?: string
  auth_secret_configured?: boolean
}

export interface AuthInput extends AuthConfig {
  auth_client_secret?: string
  auth_persist_secret?: boolean
  auth_clear_secret?: boolean
}

export function fetchUsers(token: string) {
  return get<AdminUserRecord[]>("/api/auth/users", token)
}

export function createUser(
  payload: { username: string; email: string; password: string; role: "admin" | "user" },
  token: string,
) {
  return post("/api/auth/users", payload, token)
}

export interface AdminResetPasswordResponse {
  message: string
  temporary_password: string
  user: UserProfile
}

export function resetUserPassword(userID: string, token: string) {
  return post<AdminResetPasswordResponse>(`/api/auth/users/${userID}/reset-password`, {}, token)
}

export function updatePassword(
  payload: { current_password: string; new_password: string },
  token: string,
) {
  return put<{ message: string; user: UserProfile }>("/api/profile/password", payload, token)
}

export function fetchProfileSummary(token: string) {
  return get<ProfileSummaryResponse>("/api/profile", token)
}

// --- Results -------------------------------------------------------------

export interface ResultListResponse<T = unknown> {
  results: T[]
  items?: T[]
  total: number
  limit: number
  offset: number
  q?: string
}

export function getResults(limit = 100, offset = 0, token?: string) {
  return get(withQuery(resultPath(), { limit, offset }), token)
}

export function getResultsList(
  opts: { limit?: number; offset?: number; q?: string } = {},
  token?: string,
): Promise<ResultListResponse> {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  return get<ResultListResponse>(withQuery(resultPath(), { limit, offset, q: opts.q }), token)
}

export function getResult(id: string, token?: string) {
  return get(resultPath(id), token)
}

// --- Workers & metrics ---------------------------------------------------

export function getWorkersStatus(token?: string) {
  return get("/api/workers/status", token)
}

export function getLiveMetrics(token?: string) {
  return get("/api/metrics/live", token)
}

export interface WorkerDashboardStatus {
  name: string
  address: string
  worker_status: string
  dashboard_enabled: boolean
  dashboard_url?: string
  availability: "available" | "not_running" | "worker_unreachable" | "disabled" | string
  message?: string
  active_test_id?: string
}

export interface WorkerDashboardListResponse {
  dashboards: WorkerDashboardStatus[]
  active_test?: string | null
  phase?: string
}

export function getWorkerDashboards(token?: string) {
  return get<WorkerDashboardListResponse>("/api/admin/workers/dashboards", token)
}

// --- Test control --------------------------------------------------------

export function stopTest(token?: string) {
  return postEmpty("/api/stop", token)
}

// --- System --------------------------------------------------------------

export function getHealth() {
  return get("/api/health")
}

export function resetData(token?: string) {
  return postEmpty("/api/resetdata", token)
}

// --- Templates -----------------------------------------------------------

export interface Template {
  id: string
  name: string
  description: string
  mode: string
  executor?: string
  system?: boolean
  url?: string
  stages?: { duration: string; target: number }[]
  script_content?: string
  config_content?: string
  http_method?: string
  content_type?: string
  payload_json?: string
  payload_target_kib?: number
  auth?: AuthConfig
  user_id: number
  username: string
  created_at: string
  updated_at: string
}

export interface TemplatePayload {
  name: string
  description: string
  mode: string
  url?: string
  stages?: { duration: string; target: number }[]
  script_content?: string
  config_content?: string
  http_method?: string
  content_type?: string
  payload_json?: string
  payload_target_kib?: number
  auth?: AuthInput
}

export function listTemplates(token?: string): Promise<{ templates: Template[]; total: number }> {
  return get(templatePath(), token)
}

export function getTemplate(id: string, token?: string): Promise<Template> {
  return get(templatePath(id), token)
}

export function createTemplate(payload: TemplatePayload, token?: string): Promise<Template> {
  return post(templatePath(), payload, token)
}

export function updateTemplate(id: string, payload: TemplatePayload, token?: string): Promise<Template> {
  return put(templatePath(id), payload, token)
}

export function deleteTemplate(id: string, token?: string) {
  return del(templatePath(id), token)
}

export interface SystemTemplateExportEnvelope {
  version: number
  exported_at: string
  template?: TemplatePayload
  templates?: TemplatePayload[]
}

export function promoteTemplateToSystem(id: string, token?: string): Promise<Template> {
  return post(`/api/admin/templates/${id}/system`, {}, token)
}

export function demoteTemplateFromSystem(id: string, token?: string): Promise<Template> {
  return del(`/api/admin/templates/${id}/system`, token)
}

export function exportTemplate(id: string, token?: string): Promise<SystemTemplateExportEnvelope> {
  return get(`/api/admin/templates/${id}/export`, token)
}

export function exportSystemTemplates(token?: string): Promise<SystemTemplateExportEnvelope> {
  return get("/api/admin/templates/system/export", token)
}

export function importSystemTemplates(payload: unknown, token?: string): Promise<{ templates: Template[]; total: number }> {
  return post("/api/admin/templates/system/import", payload, token)
}

// --- Schedules -------------------------------------------------------------

export interface ScheduledTest {
  id: string
  name: string
  project_name: string
  url: string
  mode: string
  executor: string
  stages?: { duration: string; target: number }[]
  vus?: number
  duration?: string
  rate?: number
  time_unit?: string
  pre_allocated_vus?: number
  max_vus?: number
  sleep_seconds?: number
  script_content?: string
  config_content?: string
  http_method?: string
  content_type?: string
  payload_json?: string
  payload_target_kib?: number
  auth?: AuthConfig
  scheduled_at: string
  estimated_duration_s: number
  timezone: string
  recurrence_type: string
  recurrence_rule?: string
  recurrence_end?: string
  status: string
  paused: boolean
  user_id: number
  username: string
  created_at: string
  updated_at: string
}

export interface ScheduleExecution {
  id: string
  schedule_id: string
  load_test_id?: string
  status: string
  scheduled_at: string
  started_at?: string
  ended_at?: string
  error_message?: string
  error_detail?: string
  created_at: string
}

export interface CalendarEvent {
  id: string
  name: string
  project_name: string
  start: string
  end: string
  status: string
  recurrence_type: string
  username: string
  user_id: number
}

export interface ScheduleConflict {
  schedule_id?: string
  schedule_name?: string
  start: string
  end: string
  type: string
}

export interface CreateSchedulePayload {
  name: string
  project_name: string
  url?: string
  mode: string
  executor?: string
  stages?: { duration: string; target: number }[]
  vus?: number
  duration?: string
  rate?: number
  time_unit?: string
  pre_allocated_vus?: number
  max_vus?: number
  sleep_seconds?: number
  script_content?: string
  config_content?: string
  http_method?: string
  content_type?: string
  payload_json?: string
  payload_target_kib?: number
  auth?: AuthInput
  scheduled_at: string
  estimated_duration_s?: number
  timezone: string
  recurrence_type: string
  recurrence_rule?: string
  recurrence_end?: string
}

export function listSchedules(token?: string): Promise<{ schedules: ScheduledTest[] }> {
  return get(schedulePath(), token)
}

export function getSchedule(id: string, token?: string): Promise<ScheduledTest> {
  return get(schedulePath(id), token)
}

export function createSchedule(payload: CreateSchedulePayload, token?: string): Promise<ScheduledTest> {
  return post(schedulePath(), payload, token)
}

export function updateSchedule(id: string, payload: Partial<CreateSchedulePayload>, token?: string): Promise<ScheduledTest> {
  return put(schedulePath(id), payload, token)
}

export function deleteSchedule(id: string, token?: string) {
  return del(schedulePath(id), token)
}

export function pauseSchedule(id: string, token?: string) {
  return postEmpty(schedulePath(id, "/pause"), token)
}

export function resumeSchedule(id: string, token?: string) {
  return postEmpty(schedulePath(id, "/resume"), token)
}

export function getCalendarEvents(from: string, to: string, token?: string): Promise<{ events: CalendarEvent[] }> {
  return get(withQuery("/api/schedules/calendar", { from, to }), token)
}

export function checkScheduleConflict(start: string, durationS: number, excludeId?: string, token?: string): Promise<{ conflict: boolean; conflicting_schedule?: ScheduleConflict }> {
  return post("/api/schedules/check-conflict", { start, duration_s: durationS, exclude_id: excludeId || "" }, token)
}

export function getScheduleExecutions(id: string, token?: string): Promise<{ executions: ScheduleExecution[] }> {
  return get(schedulePath(id, "/executions"), token)
}
