"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useSession } from "@/context/SessionContext"
import {
  listSchedules, deleteSchedule, pauseSchedule, resumeSchedule,
  getCalendarEvents,
  type ScheduledTest, type CalendarEvent,
} from "@/lib/api"
import { motion } from "framer-motion"
import { staggerContainer, revealItem } from "@/lib/motion-variants"
import {
  Plus, Calendar as CalendarIcon, List, ChevronLeft, ChevronRight,
  Pause, Play, Trash2, Clock, RefreshCw, AlertTriangle, Search,
} from "lucide-react"

type ViewMode = "timeline" | "list"

export default function SchedulePage() {
  const router = useRouter()
  const { user, token, initialized: ready } = useSession()
  const [schedules, setSchedules] = useState<ScheduledTest[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ViewMode>("timeline")
  const [search, setSearch] = useState("")
  const [weekStart, setWeekStart] = useState(() => {
    const now = new Date()
    const day = now.getDay()
    const diff = now.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(now.setDate(diff))
    monday.setHours(0, 0, 0, 0)
    return monday
  })
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  useEffect(() => {
    if (ready && !user) router.replace("/login")
  }, [ready, user, router])

  const weekEnd = useMemo(() => {
    const end = new Date(weekStart)
    end.setDate(end.getDate() + 7)
    return end
  }, [weekStart])

  const loadData = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const [schedRes, calRes] = await Promise.all([
        listSchedules(token),
        getCalendarEvents(weekStart.toISOString(), weekEnd.toISOString(), token),
      ])
      setSchedules(schedRes.schedules ?? [])
      setEvents(calRes.events ?? [])
    } catch {
      setToast({ type: "error", message: "Failed to load schedules" })
    } finally {
      setLoading(false)
    }
  }, [token, weekStart, weekEnd])
  useEffect(() => {
    if (!token) return
    const timer = setTimeout(() => {
      void loadData()
    }, 0)
    return () => clearTimeout(timer)
  }, [token, loadData])

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(t)
    }
  }, [toast])

  const navigateWeek = (dir: number) => {
    setWeekStart(prev => {
      const d = new Date(prev)
      d.setDate(d.getDate() + dir * 7)
      return d
    })
  }

  const canManage = (s: ScheduledTest) =>
    user?.role === "admin" || String(s.user_id) === user?.id

  const recurrenceLabel = (type: string) => {
    if (type === "once") return "once"
    return type
  }
  const matchesSearch = useCallback((...values: Array<string | number | null | undefined>) => {
    const query = search.trim().toLowerCase()
    if (!query) return true
    return values.some((value) => String(value ?? "").toLowerCase().includes(query))
  }, [search])
  const filteredSchedules = schedules.filter((schedule) =>
    matchesSearch(
      schedule.name,
      schedule.project_name,
      schedule.username,
      schedule.timezone,
      schedule.status,
      schedule.paused ? "paused" : "",
      recurrenceLabel(schedule.recurrence_type),
    ),
  )
  const filteredEvents = events.filter((event) =>
    matchesSearch(event.name, event.username, event.status),
  )
  const handleDelete = async (id: string) => {
    if (!token) return
    try {
      await deleteSchedule(id, token)
      setSchedules(prev => prev.filter(s => s.id !== id))
      setDeleteConfirm(null)
      setToast({ type: "success", message: "Schedule deleted" })
    } catch {
      setToast({ type: "error", message: "Failed to delete schedule" })
    }
  }

  const handlePauseToggle = async (s: ScheduledTest) => {
    if (!token) return
    try {
      if (s.paused) {
        await resumeSchedule(s.id, token)
      } else {
        await pauseSchedule(s.id, token)
      }
      loadData()
      setToast({ type: "success", message: s.paused ? "Schedule resumed" : "Schedule paused" })
    } catch {
      setToast({ type: "error", message: "Failed to update schedule" })
    }
  }

  // Week days for timeline header
  const weekDays = useMemo(() => {
    const days: Date[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      days.push(d)
    }
    return days
  }, [weekStart])

  const dayNames = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
  const hours = Array.from({ length: 24 }, (_, i) => i)

  const statusColor = (status: string, paused: boolean) => {
    if (paused) return "bg-gray-400/80 dark:bg-gray-600/80"
    switch (status) {
      case "scheduled": return "bg-accent-primary/80"
      case "running": return "bg-blue-500/80"
      case "completed": return "bg-green-500/80"
      case "failed": return "bg-red-500/80"
      default: return "bg-gray-400/80"
    }
  }

  const statusBadge = (status: string, paused: boolean) => {
    const label = paused ? "paused" : status
    const cls = paused
      ? "status-badge status-badge--neutral"
      : status === "scheduled" ? "status-badge status-badge--info"
      : status === "running" ? "status-badge status-badge--info"
      : status === "completed" ? "status-badge status-badge--success"
      : status === "failed" ? "status-badge status-badge--danger"
      : "status-badge status-badge--neutral"
    return <span className={`px-2 py-0.5 text-[10px] uppercase ${cls}`}>{label}</span>
  }

  const recurrenceBadge = (type: string) => {
    if (type === "once") return null
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent-primary/10 text-accent-primary">
        <RefreshCw size={10} /> {type}
      </span>
    )
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })
  }

  const formatWeekRange = () => {
    const end = new Date(weekStart)
    end.setDate(end.getDate() + 6)
    return `${weekStart.toLocaleDateString("de-DE", { day: "2-digit", month: "short" })} – ${end.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" })}`
  }

  if (!ready || !user) return null

  return (
    <motion.div className="space-y-6" variants={staggerContainer} initial="initial" animate="enter">
      {/* Header */}
      <motion.div variants={revealItem} className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary section-heading">Schedules</h1>
          <p className="text-text-muted text-sm mt-1">Plan, search, and manage upcoming test executions.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-app-border overflow-hidden">
            <button
              onClick={() => setView("timeline")}
              className={`px-3 py-1.5 text-xs font-medium transition ${view === "timeline" ? "bg-accent-primary text-white" : "text-text-muted hover:bg-app-surface-alt"}`}
            >
              <CalendarIcon size={14} className="inline mr-1" />Timeline
            </button>
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 text-xs font-medium transition ${view === "list" ? "bg-accent-primary text-white" : "text-text-muted hover:bg-app-surface-alt"}`}
            >
              <List size={14} className="inline mr-1" />List
            </button>
          </div>
          <Link
            href="/schedule/new"
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-accent-primary text-white hover:bg-pink-700 transition"
          >
            <Plus size={16} /> New Schedule
          </Link>
        </div>
      </motion.div>

      <motion.div variants={revealItem} className="app-card rounded-xl border border-app-border px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-md">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by schedule, test run, owner, timezone, or status"
              className="w-full rounded-lg border border-app-border bg-[var(--color-card-bg)] py-2.5 pl-10 pr-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
          </label>
          <div className="text-sm text-text-muted">
            {view === "list"
              ? `${filteredSchedules.length} schedule${filteredSchedules.length === 1 ? "" : "s"} visible`
              : `${filteredEvents.length} timeline event${filteredEvents.length === 1 ? "" : "s"} visible`}
          </div>
        </div>
      </motion.div>

      {/* Toast */}
      {toast && (
        <div className={`inline-alert px-4 py-2 text-sm font-medium ${toast.type === "success" ? "inline-alert--success" : "inline-alert--danger"}`}>
          {toast.message}
        </div>
      )}

      {/* Timeline View */}
      {view === "timeline" && (
        <motion.div variants={revealItem} className="app-card rounded-xl border border-app-border overflow-hidden">
          {/* Week navigation */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
            <button onClick={() => navigateWeek(-1)} className="p-1.5 rounded-md hover:bg-app-surface-alt transition text-text-muted">
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-semibold text-text-primary">{formatWeekRange()}</span>
            <button onClick={() => navigateWeek(1)} className="p-1.5 rounded-md hover:bg-app-surface-alt transition text-text-muted">
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Timeline grid */}
          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              {/* Day headers */}
              <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-app-border">
                <div className="p-2 text-[10px] text-text-muted" />
                {weekDays.map((d, i) => {
                  const isToday = new Date().toDateString() === d.toDateString()
                  return (
                    <div key={i} className={`p-2 text-center border-l border-app-border ${isToday ? "bg-accent-primary/5" : ""}`}>
                      <div className="text-[10px] font-semibold text-text-muted uppercase">{dayNames[i]}</div>
                      <div className={`text-sm font-bold ${isToday ? "text-accent-primary" : "text-text-primary"}`}>
                        {d.getDate()}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Hour rows */}
              <div className="relative" style={{ height: "576px" }}>
                {hours.map(h => (
                  <div key={h} className="absolute w-full border-b border-app-border/30" style={{ top: `${h * 24}px`, height: "24px" }}>
                    <span className="absolute left-1 text-[9px] text-text-muted leading-none" style={{ top: "1px" }}>
                      {h.toString().padStart(2, "0")}:00
                    </span>
                  </div>
                ))}

                {/* Event blocks */}
                {filteredEvents.map((ev, idx) => {
                  const start = new Date(ev.start)
                  const end = new Date(ev.end)
                  const dayIdx = Math.floor((start.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000))
                  if (dayIdx < 0 || dayIdx >= 7) return null

                  const startMinutes = start.getHours() * 60 + start.getMinutes()
                  const durationMinutes = Math.max(15, (end.getTime() - start.getTime()) / 60000)
                  const top = (startMinutes / 60) * 24
                  const height = Math.max(16, (durationMinutes / 60) * 24)
                  const left = `calc(60px + ${dayIdx} * ((100% - 60px) / 7) + 2px)`
                  const width = `calc((100% - 60px) / 7 - 4px)`

                  return (
                    <Link
                      key={`${ev.id}-${idx}`}
                      href={`/schedule/${ev.id}`}
                      className={`absolute rounded-md px-1.5 py-0.5 text-white text-[10px] font-medium truncate cursor-pointer hover:opacity-90 transition ${statusColor(ev.status, false)}`}
                      style={{ top: `${top}px`, height: `${height}px`, left, width, zIndex: 10 }}
                      title={`${ev.name} (${ev.username}) ${formatTime(ev.start)}–${formatTime(ev.end)}`}
                    >
                      {ev.name}
                    </Link>
                  )
                })}

                {!loading && filteredEvents.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-text-muted">
                    {search.trim() ? "No scheduled events match the current search." : "No scheduled events in this week."}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* List View */}
      {view === "list" && (
        <motion.div variants={revealItem} className="app-card rounded-xl border border-app-border overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-text-muted">Loading...</div>
          ) : filteredSchedules.length === 0 ? (
            <div className="p-8 text-center text-text-muted">
              <CalendarIcon size={32} className="mx-auto mb-2 opacity-40" />
              <p>{search.trim() ? "No schedules match the current search." : "No scheduled tests yet."}</p>
              {!search.trim() && (
                <Link href="/schedule/new" className="text-accent-primary hover:underline text-sm mt-2 inline-block">Create your first schedule</Link>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-app-border text-text-muted text-left">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Next Run</th>
                    <th className="px-4 py-3 font-medium">Duration</th>
                    <th className="px-4 py-3 font-medium">Recurrence</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Owner</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSchedules.map(s => (
                    <tr key={s.id} className="border-b border-app-border/50 hover:bg-app-surface-alt/50 transition">
                      <td className="px-4 py-3">
                        <Link href={`/schedule/${s.id}`} className="font-medium text-text-primary hover:text-accent-primary transition">
                          {s.name}
                        </Link>
                        <div className="text-xs text-text-muted">Test run: {s.project_name}</div>
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        <div className="flex items-center gap-1.5">
                          <Clock size={12} />
                          {formatDate(s.scheduled_at)} {formatTime(s.scheduled_at)}
                        </div>
                        <div className="text-[10px] text-text-muted">{s.timezone}</div>
                      </td>
                      <td className="px-4 py-3 text-text-muted text-xs">{Math.round(s.estimated_duration_s / 60)}min</td>
                      <td className="px-4 py-3">{recurrenceBadge(s.recurrence_type) || <span className="text-text-muted text-xs">once</span>}</td>
                      <td className="px-4 py-3">{statusBadge(s.status, s.paused)}</td>
                      <td className="px-4 py-3 text-text-muted text-xs">{s.username}</td>
                      <td className="px-4 py-3">
                        {canManage(s) && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handlePauseToggle(s)}
                              className="p-1.5 rounded-md hover:bg-app-surface-alt transition text-text-muted"
                              title={s.paused ? "Resume" : "Pause"}
                            >
                              {s.paused ? <Play size={14} /> : <Pause size={14} />}
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(s.id)}
                              className="p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition text-red-500"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-[var(--color-card-bg)] border border-app-border rounded-xl p-6 max-w-sm mx-4 shadow-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-red-500 mb-3">
              <AlertTriangle size={20} />
              <h3 className="font-semibold">Delete Schedule</h3>
            </div>
            <p className="text-sm text-text-muted mb-4">This will permanently delete the schedule and all its execution history. This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm rounded-lg border border-app-border text-text-muted hover:bg-app-surface-alt transition">
                Cancel
              </button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}


