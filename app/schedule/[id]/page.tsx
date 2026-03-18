"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { useSession } from "@/context/SessionContext"
import {
  getSchedule, getScheduleExecutions, deleteSchedule, pauseSchedule, resumeSchedule,
  type ScheduledTest, type ScheduleExecution,
} from "@/lib/api"
import { motion } from "framer-motion"
import { staggerContainer, revealItem } from "@/lib/motion-variants"
import {
  ArrowLeft, Calendar, Clock, Play, Pause, Trash2, RefreshCw,
  AlertTriangle, CheckCircle, XCircle, SkipForward, ExternalLink,
} from "lucide-react"

export default function ScheduleDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user, token, initialized: ready } = useSession()
  const [schedule, setSchedule] = useState<ScheduledTest | null>(null)
  const [executions, setExecutions] = useState<ScheduleExecution[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const id = params.id as string

  useEffect(() => {
    if (ready && !user) router.replace("/login")
  }, [ready, user, router])

  const loadData = async () => {
    if (!token || !id) return
    setLoading(true)
    try {
      const [s, e] = await Promise.all([
        getSchedule(id, token),
        getScheduleExecutions(id, token),
      ])
      setSchedule(s)
      setExecutions(e.executions ?? [])
    } catch {
      setToast({ type: "error", message: "Failed to load schedule" })
    }
    setLoading(false)
  }

  useEffect(() => {
    if (token && id) loadData()
  }, [token, id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(t)
    }
  }, [toast])

  const canManage = schedule && (user?.role === "admin" || String(schedule.user_id) === user?.id)

  const handleDelete = async () => {
    if (!token || !id) return
    try {
      await deleteSchedule(id, token)
      router.push("/schedule")
    } catch {
      setToast({ type: "error", message: "Failed to delete schedule" })
    }
  }

  const handlePauseToggle = async () => {
    if (!token || !id || !schedule) return
    try {
      if (schedule.paused) {
        await resumeSchedule(id, token)
      } else {
        await pauseSchedule(id, token)
      }
      loadData()
      setToast({ type: "success", message: schedule.paused ? "Schedule resumed" : "Schedule paused" })
    } catch {
      setToast({ type: "error", message: "Failed to update schedule" })
    }
  }

  const statusBadge = (status: string, paused?: boolean) => {
    const label = paused ? "paused" : status
    const cls = paused
      ? "status-badge status-badge--neutral"
      : status === "scheduled" ? "status-badge status-badge--info"
      : status === "running" ? "status-badge status-badge--info"
      : status === "completed" ? "status-badge status-badge--success"
      : status === "failed" ? "status-badge status-badge--danger"
      : status === "skipped" ? "status-badge status-badge--warning"
      : "status-badge status-badge--neutral"
    return <span className={`px-2.5 py-1 text-xs ${cls}`}>{label}</span>
  }

  const execStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle size={14} className="text-green-500" />
      case "failed": return <XCircle size={14} className="text-red-500" />
      case "skipped": return <SkipForward size={14} className="text-yellow-500" />
      case "running": return <RefreshCw size={14} className="text-blue-500 animate-spin" />
      default: return <Clock size={14} className="text-gray-400" />
    }
  }

  const fmtDate = (iso?: string) => {
    if (!iso) return "—"
    return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
  }

  if (!ready || !user || loading) {
    return <div className="p-8 text-center text-text-muted">Loading...</div>
  }
  if (!schedule) {
    return <div className="p-8 text-center text-text-muted">Schedule not found</div>
  }

  return (
    <motion.div className="space-y-6" variants={staggerContainer} initial="initial" animate="enter">
      {/* Header */}
      <motion.div variants={revealItem} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center">
          <button onClick={() => router.push("/schedule")} className="p-2 rounded-lg hover:bg-app-surface-alt transition text-text-muted">
            <ArrowLeft size={18} />
          </button>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button onClick={handlePauseToggle} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-app-border text-text-muted hover:bg-app-surface-alt transition">
              {schedule.paused ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}
            </button>
            <button onClick={() => setDeleteConfirm(true)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-red-300 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition">
              <Trash2 size={14} /> Delete
            </button>
          </div>
        )}
      </motion.div>

      {/* Toast */}
      {toast && (
        <div className={`inline-alert px-4 py-2 text-sm font-medium ${toast.type === "success" ? "inline-alert--success" : "inline-alert--danger"}`}>
          {toast.message}
        </div>
      )}

      {/* Schedule Info */}
      <motion.div variants={revealItem} className="app-card rounded-xl border border-app-border p-5">
        <h2 className="text-sm font-bold text-text-primary section-heading mb-4 flex items-center gap-2">
          <Calendar size={16} className="text-accent-primary" /> Schedule Details
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-text-muted text-xs uppercase font-semibold">Status</span>
            <div className="mt-1">{statusBadge(schedule.status, schedule.paused)}</div>
          </div>
          <div>
            <span className="text-text-muted text-xs uppercase font-semibold">Next Run</span>
            <div className="mt-1 text-text-primary font-medium">{fmtDate(schedule.scheduled_at)}</div>
          </div>
          <div>
            <span className="text-text-muted text-xs uppercase font-semibold">Timezone</span>
            <div className="mt-1 text-text-primary">{schedule.timezone}</div>
          </div>
          <div>
            <span className="text-text-muted text-xs uppercase font-semibold">Duration</span>
            <div className="mt-1 text-text-primary">{Math.ceil(schedule.estimated_duration_s / 60)} min</div>
          </div>
          <div>
            <span className="text-text-muted text-xs uppercase font-semibold">Recurrence</span>
            <div className="mt-1 text-text-primary flex items-center gap-1.5">
              {schedule.recurrence_type !== "once" && <RefreshCw size={12} className="text-accent-primary" />}
              {schedule.recurrence_type}
              {schedule.recurrence_end && <span className="text-text-muted text-xs ml-1">(until {fmtDate(schedule.recurrence_end)})</span>}
            </div>
          </div>
          <div>
            <span className="text-text-muted text-xs uppercase font-semibold">Owner</span>
            <div className="mt-1 text-text-primary">{schedule.username}</div>
          </div>
          <div>
            <span className="text-text-muted text-xs uppercase font-semibold">Executor</span>
            <div className="mt-1 text-text-primary">{schedule.executor || schedule.mode}</div>
          </div>
          <div>
            <span className="text-text-muted text-xs uppercase font-semibold">Target URL</span>
            <div className="mt-1 text-text-primary text-xs break-all">{schedule.url || "—"}</div>
          </div>
          <div>
            <span className="text-text-muted text-xs uppercase font-semibold">Created</span>
            <div className="mt-1 text-text-muted">{fmtDate(schedule.created_at)}</div>
          </div>
        </div>
      </motion.div>

      {/* Execution History */}
      <motion.div variants={revealItem} className="app-card rounded-xl border border-app-border overflow-hidden">
        <div className="px-5 py-4 border-b border-app-border">
          <h2 className="text-sm font-bold text-text-primary section-heading flex items-center gap-2">
            <Clock size={16} className="text-accent-primary" /> Execution History
          </h2>
        </div>

        {executions.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-sm">No executions yet. The test will run at the scheduled time.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-app-border text-text-muted text-left text-xs">
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Scheduled</th>
                  <th className="px-5 py-2.5 font-medium">Started</th>
                  <th className="px-5 py-2.5 font-medium">Ended</th>
                  <th className="px-5 py-2.5 font-medium">Error</th>
                  <th className="px-5 py-2.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {executions.map(ex => (
                  <tr key={ex.id} className="border-b border-app-border/50 hover:bg-app-surface-alt/50 transition">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {execStatusIcon(ex.status)}
                        {statusBadge(ex.status)}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-text-muted text-xs">{fmtDate(ex.scheduled_at)}</td>
                    <td className="px-5 py-3 text-text-muted text-xs">{fmtDate(ex.started_at)}</td>
                    <td className="px-5 py-3 text-text-muted text-xs">{fmtDate(ex.ended_at)}</td>
                    <td className="px-5 py-3">
                      {ex.error_message && (
                        <div className="flex items-start gap-1.5 text-red-500 text-xs max-w-xs">
                          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                          <span className="break-words">{ex.error_message}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {ex.load_test_id && (
                        <Link href={`/result/${ex.load_test_id}`} className="flex items-center gap-1 text-accent-primary hover:underline text-xs">
                          <ExternalLink size={12} /> View Result
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setDeleteConfirm(false)}>
          <div className="bg-[var(--color-card-bg)] border border-app-border rounded-xl p-6 max-w-sm mx-4 shadow-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-red-500 mb-3">
              <AlertTriangle size={20} />
              <h3 className="font-semibold">Delete Schedule</h3>
            </div>
            <p className="text-sm text-text-muted mb-4">This will permanently delete &ldquo;{schedule.name}&rdquo; and all its execution history.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(false)} className="px-4 py-2 text-sm rounded-lg border border-app-border text-text-muted hover:bg-app-surface-alt transition">
                Cancel
              </button>
              <button onClick={handleDelete} className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}
