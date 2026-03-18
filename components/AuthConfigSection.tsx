"use client"

import type { AuthConfig, AuthInput } from "@/lib/api"

type AuthConfigSectionMode = "runtime" | "template" | "schedule"

type AuthConfigSectionProps = {
  value: AuthInput
  onChange: (next: AuthInput) => void
  mode: AuthConfigSectionMode
  className?: string
}

const AUTH_METHODS = [
  { value: "basic", label: "Basic auth" },
  { value: "body", label: "Credentials in body" },
] as const

function joinClasses(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(" ")
}

function isValidAuthTokenURL(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

export function createDefaultAuthInput(): AuthInput {
  return {
    auth_enabled: false,
    auth_mode: "oauth_client_credentials",
    auth_client_auth_method: "basic",
    auth_refresh_skew_seconds: 30,
    auth_client_secret: "",
    auth_persist_secret: false,
    auth_clear_secret: false,
  }
}

export function hydrateAuthInput(auth?: AuthConfig | null): AuthInput {
  const defaults = createDefaultAuthInput()
  if (!auth?.auth_enabled) {
    return defaults
  }

  return {
    ...defaults,
    auth_enabled: true,
    auth_mode: auth.auth_mode || defaults.auth_mode,
    auth_token_url: auth.auth_token_url || "",
    auth_client_id: auth.auth_client_id || "",
    auth_client_auth_method: auth.auth_client_auth_method || defaults.auth_client_auth_method,
    auth_refresh_skew_seconds: auth.auth_refresh_skew_seconds || defaults.auth_refresh_skew_seconds,
    auth_secret_source: auth.auth_secret_source,
    auth_secret_configured: auth.auth_secret_configured,
  }
}

export function validateAuthInput(value: AuthInput, options: { requireSecret: boolean }): string | null {
  if (!value.auth_enabled) return null

  const tokenURL = value.auth_token_url?.trim() || ""
  if (!tokenURL) return "Auth token URL is required"
  if (!isValidAuthTokenURL(tokenURL)) return "Auth token URL must be an absolute http or https URL"
  if (!value.auth_client_id?.trim()) return "Auth client ID is required"
  if (!value.auth_client_auth_method || !AUTH_METHODS.some((item) => item.value === value.auth_client_auth_method)) {
    return "Auth client auth method must be basic or body"
  }
  if ((value.auth_refresh_skew_seconds || 0) <= 0) return "Auth refresh skew must be greater than 0"
  if (options.requireSecret && !value.auth_client_secret?.trim()) {
    if (value.auth_secret_configured && !value.auth_clear_secret) {
      return null
    }
    return "Auth client secret is required"
  }
  return null
}

export function buildAuthPayload(
  value: AuthInput,
  options: { mode: AuthConfigSectionMode },
): AuthInput | undefined {
  if (!value.auth_enabled) return undefined

  const payload = createDefaultAuthInput()
  payload.auth_enabled = true
  payload.auth_mode = value.auth_mode?.trim() || "oauth_client_credentials"
  payload.auth_token_url = value.auth_token_url?.trim() || ""
  payload.auth_client_id = value.auth_client_id?.trim() || ""
  payload.auth_client_auth_method = value.auth_client_auth_method?.trim() || "basic"
  payload.auth_refresh_skew_seconds = Math.max(1, value.auth_refresh_skew_seconds || 30)

  if (value.auth_client_secret?.trim()) {
    payload.auth_client_secret = value.auth_client_secret.trim()
  } else {
    delete payload.auth_client_secret
  }

  if (options.mode === "runtime") {
    delete payload.auth_persist_secret
    delete payload.auth_clear_secret
  } else if (options.mode === "schedule") {
    payload.auth_persist_secret = true
    payload.auth_clear_secret = false
  } else {
    payload.auth_persist_secret = !!value.auth_persist_secret
    payload.auth_clear_secret = !!value.auth_clear_secret
  }

  return payload
}

function secretStatusText(mode: AuthConfigSectionMode, value: AuthInput) {
  if (mode === "runtime") {
    return "The client secret is used only for this run and is not stored by the platform."
  }
  if (mode === "schedule") {
    if (value.auth_secret_configured && !value.auth_clear_secret) {
      return "A secret is already stored encrypted for this schedule. Provide a new one only if you want to replace it."
    }
    return "Schedules store the client secret encrypted so they can run unattended."
  }
  if (value.auth_secret_configured && !value.auth_clear_secret) {
    return "A secret is already stored encrypted with this template. Loading the template later will not reveal the secret."
  }
  return "Templates can optionally store the client secret encrypted for later reuse."
}

export function AuthConfigSection({ value, onChange, mode, className }: AuthConfigSectionProps) {
  const setField = <K extends keyof AuthInput>(key: K, nextValue: AuthInput[K]) => {
    onChange({ ...value, [key]: nextValue })
  }

  const secretStatus = secretStatusText(mode, value)

  return (
    <div className={joinClasses("space-y-4 rounded-lg border border-app-border bg-app-surface p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Authentication</h3>
          <p className="mt-1 text-xs text-text-muted">
            Configure OAuth client credentials for builder-based requests.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-medium text-text-primary">
          <input
            type="checkbox"
            checked={value.auth_enabled}
            onChange={(event) => {
              const enabled = event.target.checked
              onChange(enabled ? { ...createDefaultAuthInput(), ...value, auth_enabled: true } : createDefaultAuthInput())
            }}
            className="h-4 w-4 rounded border-app-border text-accent-primary focus:ring-accent-primary/30"
          />
          Enable
        </label>
      </div>

      {value.auth_enabled && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                Token URL
              </label>
              <input
                value={value.auth_token_url || ""}
                onChange={(event) => setField("auth_token_url", event.target.value)}
              placeholder="http://target-lb:8090/api/auth/token"
                className="w-full"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                Client ID
              </label>
              <input
                value={value.auth_client_id || ""}
                onChange={(event) => setField("auth_client_id", event.target.value)}
                placeholder="loadtest-client"
                className="w-full"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                Auth Method
              </label>
              <select
                value={value.auth_client_auth_method || "basic"}
                onChange={(event) => setField("auth_client_auth_method", event.target.value)}
                className="w-full rounded-md border border-app-border bg-[var(--color-card-bg)] px-3 py-2 text-sm text-text-primary"
              >
                {AUTH_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                Client Secret
              </label>
              <input
                type="password"
                value={value.auth_client_secret || ""}
                onChange={(event) => {
                  onChange({
                    ...value,
                    auth_client_secret: event.target.value,
                    auth_clear_secret: false,
                  })
                }}
                placeholder={value.auth_secret_configured ? "Stored secret can be replaced here" : "Enter client secret"}
                className="w-full"
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                Refresh Skew (seconds)
              </label>
              <input
                type="number"
                min={1}
                value={value.auth_refresh_skew_seconds || 30}
                onChange={(event) => setField("auth_refresh_skew_seconds", Number(event.target.value) || 0)}
                className="w-full"
              />
            </div>
          </div>

          <div className="rounded-md border border-app-border/70 bg-[var(--color-card-bg)] px-3 py-2 text-xs text-text-muted">
            {secretStatus}
          </div>

          {mode === "template" && (
            <div className="space-y-3 rounded-md border border-app-border/70 bg-[var(--color-card-bg)] px-3 py-3">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-text-primary">
                <input
                  type="checkbox"
                  checked={!!value.auth_persist_secret}
                  onChange={(event) => {
                    const persist = event.target.checked
                    onChange({
                      ...value,
                      auth_persist_secret: persist,
                      auth_clear_secret: persist ? false : value.auth_clear_secret,
                    })
                  }}
                  className="h-4 w-4 rounded border-app-border text-accent-primary focus:ring-accent-primary/30"
                />
                Store client secret encrypted with this template
              </label>

              {value.auth_secret_configured && (
                <label className="inline-flex items-center gap-2 text-xs font-medium text-text-primary">
                  <input
                    type="checkbox"
                    checked={!!value.auth_clear_secret}
                    onChange={(event) => {
                      const clear = event.target.checked
                      onChange({
                        ...value,
                        auth_clear_secret: clear,
                        auth_persist_secret: clear ? false : value.auth_persist_secret,
                        auth_client_secret: clear ? "" : value.auth_client_secret,
                      })
                    }}
                    className="h-4 w-4 rounded border-app-border text-accent-primary focus:ring-accent-primary/30"
                  />
                  Clear stored secret on save
                </label>
              )}
            </div>
          )}

          {mode === "schedule" && (
            <div className="rounded-md border border-app-border/70 bg-[var(--color-card-bg)] px-3 py-2 text-xs text-text-muted">
              Schedule secrets are always stored encrypted. The plaintext secret is never returned to the UI.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
