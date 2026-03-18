"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Monitor, RefreshCw, Unplug } from "lucide-react"

import { getWorkerDashboards, type WorkerDashboardStatus } from "@/lib/api"
import { useSession } from "@/context/SessionContext"

function buildDashboardProxyUIPath(worker: string, token: string) {
  const proxyBase = `/api/backend/api/admin/workers/${encodeURIComponent(worker)}/dashboard/`
  const search = new URLSearchParams({
    endpoint: proxyBase,
    auth_token: token,
  })
  return `${proxyBase}ui/?${search.toString()}`
}

export default function WorkerDashboardLivePage() {
  const params = useParams<{ worker: string }>()
  const worker = Array.isArray(params?.worker) ? params.worker[0] : params?.worker
  const router = useRouter()
  const { user, token, initialized: ready, isAdmin } = useSession()
  const [dashboard, setDashboard] = useState<WorkerDashboardStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [disconnectRequested, setDisconnectRequested] = useState(false)

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

  const dashboardSrc = useMemo(() => {
    if (!worker || !token) return null
    return buildDashboardProxyUIPath(worker, token)
  }, [worker, token])

  useEffect(() => {
    if (!ready || !user || !isAdmin || !token || !worker) return

    let cancelled = false

    const load = async () => {
      try {
        const response = await getWorkerDashboards(token)
        if (cancelled) return
        const entry = (response.dashboards ?? []).find((item) => item.name === worker) ?? null
        setDashboard(entry)
      } catch {
        if (!cancelled) setDashboard(null)
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
  }, [ready, user, isAdmin, token, worker])

  const shouldAttachDashboard = !!dashboardSrc && !disconnectRequested && dashboard?.availability === "available"

  if (!ready || !user || !isAdmin) {
    return null
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="app-card border border-app-border rounded-2xl p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 status-badge status-badge--info px-3 py-1 text-[11px] uppercase tracking-[0.16em]">
              <Monitor size={14} />
              Live Worker Dashboard
            </div>
            <h1 className="mt-3 text-2xl font-bold text-text-primary section-heading">{worker || "Unknown worker"}</h1>
            <p className="text-text-muted text-sm mt-1 max-w-3xl">
              This wrapper keeps the live k6 dashboard attached only while the related test run is still active. Once the worker turns idle, the embedded dashboard is disconnected so the worker can shut down and become ready for the next run.
            </p>
          </div>

          {dashboardSrc && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDisconnectRequested(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-app-border px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-app-surface-alt"
              >
                <Unplug size={15} />
                Disconnect live dashboard
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-app-border bg-app-surface overflow-hidden min-h-[72vh]">
        {shouldAttachDashboard ? (
          <iframe
            title={`Worker dashboard ${worker}`}
            src={dashboardSrc}
            className="h-[72vh] w-full bg-white"
          />
        ) : (
          <div className="flex min-h-[72vh] flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="text-sm text-text-muted max-w-2xl">
              {disconnectRequested
                ? "The live dashboard connection has been detached. This allows the selected worker to finish cleanly and become ready for the next test run."
                : loading
                  ? "Checking the live dashboard status for the selected worker..."
                  : dashboard?.availability === "available"
                    ? "The dashboard is available, but the live connection is currently detached."
                    : dashboard?.message || "No active worker-side dashboard is available right now."}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {dashboard?.availability === "available" && (
                <button
                  type="button"
                  onClick={() => setDisconnectRequested(false)}
                  className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-pink-700 transition"
                >
                  <RefreshCw size={15} />
                  Reconnect dashboard
                </button>
              )}
              <button
                type="button"
                onClick={() => router.push("/worker-dashboards")}
                className="inline-flex items-center gap-2 rounded-xl border border-app-border px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-app-surface-alt"
              >
                Back to workers
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
