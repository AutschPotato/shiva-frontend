"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { Monitor, ExternalLink, RefreshCw, ShieldAlert, Activity, RadioTower } from "lucide-react"

import { getWorkerDashboards, type WorkerDashboardStatus } from "@/lib/api"
import { useSession } from "@/context/SessionContext"
import { revealItem, staggerContainer } from "@/lib/motion-variants"

const availabilityTone: Record<string, string> = {
  available: "status-badge status-badge--success",
  not_running: "status-badge status-badge--neutral",
  worker_unreachable: "status-badge status-badge--danger",
  disabled: "status-badge status-badge--warning",
}

function availabilityLabel(value: string) {
  switch (value) {
    case "available":
      return "available"
    case "not_running":
      return "not running"
    case "worker_unreachable":
      return "worker unreachable"
    case "disabled":
      return "disabled"
    default:
      return value.replaceAll("_", " ")
  }
}

function phaseLabel(value?: string | null) {
  switch (value) {
    case "script":
      return "script preparation"
    case "workers":
      return "worker preparation"
    case "running":
      return "load generation"
    case "collecting":
      return "result collection"
    case "done":
      return "completed"
    default:
      return value || "idle"
  }
}

export default function WorkerDashboardsPage() {
  const { user, token, initialized: ready, isAdmin } = useSession()
  const router = useRouter()
  const [dashboards, setDashboards] = useState<WorkerDashboardStatus[]>([])
  const [activeTestId, setActiveTestId] = useState<string | null>(null)
  const [phase, setPhase] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (ready && !user) {
      router.replace("/login")
    }
  }, [ready, user, router])

  useEffect(() => {
    if (ready && user && !isAdmin) {
      router.replace("/")
    }
  }, [ready, user, isAdmin, router])

  useEffect(() => {
    if (!ready || !isAdmin || !token) return

    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        const response = await getWorkerDashboards(token)
        if (cancelled) return
        setDashboards(response.dashboards ?? [])
        setActiveTestId(response.active_test ?? null)
        setPhase(response.phase ?? null)
        setError(null)
      } catch (loadError: any) {
        if (cancelled) return
        setError(loadError?.message || "Unable to load worker dashboards")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    const interval = window.setInterval(load, 2000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [ready, isAdmin, token])

  const overview = useMemo(() => ({
    available: dashboards.filter((entry) => entry.availability === "available").length,
    unavailable: dashboards.filter((entry) => entry.availability !== "available").length,
    runningWorkers: dashboards.filter((entry) => entry.worker_status === "running").length,
  }), [dashboards])

  if (!ready || !user || !isAdmin) {
    return null
  }

  const openDashboard = (workerName: string) => {
    window.open(`/worker-dashboards/${encodeURIComponent(workerName)}`, "_blank", "noopener,noreferrer")
  }

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="enter" className="space-y-6 pb-10">
      <motion.div variants={revealItem} className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="status-badge status-badge--info px-3 py-1 text-[11px] uppercase tracking-[0.16em]">
            Admin Workspace
          </div>
          <h1 className="mt-3 text-3xl font-bold text-text-primary section-heading">Worker Dashboards</h1>
          <p className="text-text-muted text-sm mt-1 max-w-3xl">
            Open the live k6 internal dashboard of a selected worker in a dedicated browser tab. These dashboards are available only while the worker-side k6 process is still alive.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-text-muted">
          <span className="status-badge status-badge--neutral px-3 py-1">
            {activeTestId ? `Active test ${activeTestId}` : "No active test"}
          </span>
          <span className="status-badge status-badge--info px-3 py-1">
            Phase {phaseLabel(phase)}
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-xl border border-app-border px-3 py-2 text-sm text-text-muted hover:bg-app-surface-alt"
          >
            <RefreshCw size={14} />
            Refresh now
          </button>
        </div>
      </motion.div>

      <motion.div variants={revealItem} className="grid gap-4 sm:grid-cols-3">
        <OverviewCard icon={Monitor} title="Available" value={String(overview.available)} detail="Workers with a live dashboard ready to open" />
        <OverviewCard icon={Activity} title="Running workers" value={String(overview.runningWorkers)} detail="Workers currently reporting active load generation" />
        <OverviewCard icon={ShieldAlert} title="Unavailable" value={String(overview.unavailable)} detail="Workers that are disabled, idle or currently unreachable" />
      </motion.div>

      {error && (
        <motion.div variants={revealItem} className="inline-alert inline-alert--danger px-4 py-3 text-sm">
          {error}
        </motion.div>
      )}

      <motion.section variants={revealItem} className="app-card border border-app-border rounded-2xl p-5">
        <div className="flex items-center gap-2">
          <RadioTower size={18} className="text-accent-primary" />
          <h2 className="text-lg font-semibold text-text-primary">Live worker dashboards</h2>
        </div>
        <p className="mt-1 text-sm text-text-muted">
          Use this page as the launcher. Each button opens a controlled live dashboard tab that disconnects automatically once the related test run is no longer active.
        </p>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {loading && dashboards.length === 0 ? (
            <div className="rounded-xl border border-app-border bg-app-surface px-4 py-8 text-center text-sm text-text-muted xl:col-span-2">
              Loading worker dashboards…
            </div>
          ) : dashboards.length === 0 ? (
            <div className="rounded-xl border border-app-border bg-app-surface px-4 py-8 text-center text-sm text-text-muted xl:col-span-2">
              No worker dashboard metadata is available yet.
            </div>
          ) : (
            dashboards.map((entry) => {
              const tone = availabilityTone[entry.availability] || "status-badge status-badge--neutral"
              const canOpen = entry.availability === "available"

              return (
                <div key={entry.name} className="rounded-2xl border border-app-border bg-app-surface px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-text-primary">{entry.name}</h3>
                        <span className={`px-2.5 py-1 text-[11px] ${tone}`}>
                          {availabilityLabel(entry.availability)}
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-xs text-text-muted break-all">{entry.address}</div>
                      <div className="mt-2 text-sm text-text-muted">{entry.message || "No additional dashboard details available."}</div>
                    </div>

                    <button
                      type="button"
                      onClick={() => openDashboard(entry.name)}
                      disabled={!canOpen}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-pink-700 transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ExternalLink size={15} />
                      Open in new tab
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <MiniMetric label="Worker status" value={entry.worker_status} />
                    <MiniMetric label="Dashboard mode" value={entry.dashboard_enabled ? "enabled" : "disabled"} />
                    <MiniMetric label="Active test" value={entry.active_test_id || "—"} mono />
                  </div>
                </div>
              )
            })
          )}
        </div>
      </motion.section>
    </motion.div>
  )
}

function OverviewCard({
  icon: Icon,
  title,
  value,
  detail,
}: {
  icon: typeof Monitor
  title: string
  value: string
  detail: string
}) {
  return (
    <div className="app-card border border-app-border rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-[0.16em] text-text-muted">{title}</div>
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent-primary/12 text-accent-primary">
          <Icon size={18} />
        </span>
      </div>
      <div className="mt-4 text-3xl font-semibold text-text-primary">{value}</div>
      <div className="mt-2 text-sm text-text-muted">{detail}</div>
    </div>
  )
}

function MiniMetric({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-xl border border-app-border bg-app-surface-alt px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">{label}</div>
      <div className={`mt-1 text-sm font-medium text-text-primary ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  )
}
