"use client"

import { FormEvent, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "@/context/SessionContext"
import { fetchProfileSummary, updatePassword, type AdminUserMetrics } from "@/lib/api"
import { motion } from "framer-motion"
import { staggerContainer, revealItem } from "@/lib/motion-variants"
import { Activity, Calendar, CheckCircle2, Clock3, Layers } from "lucide-react"

function formatTimestamp(value?: string | null) {
  if (!value) return "—"
  return new Date(value).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function successRate(metrics: AdminUserMetrics) {
  if (metrics.total_tests === 0) return null
  return metrics.completed_tests / metrics.total_tests
}

export default function ProfilePage() {
  const { user, token, initialized: ready, updateUser } = useSession()
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState("")
  const [metrics, setMetrics] = useState<AdminUserMetrics | null>(null)

  useEffect(() => {
    if (ready && !user) {
      router.replace("/login")
    }
  }, [ready, user, router])

  useEffect(() => {
    if (!ready || !user || !token) return

    let cancelled = false
    setProfileLoading(true)
    setProfileError("")

    fetchProfileSummary(token)
      .then((response) => {
        if (cancelled) return
        setMetrics(response.metrics)
      })
      .catch((error: any) => {
        if (!cancelled) {
          setProfileError(error?.message || "Unable to load profile metrics")
        }
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [ready, user, token])

  if (!ready || !user || !token) {
    return null
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      setStatus({ type: "error", message: "New passwords must match" })
      return
    }

    setLoading(true)
    setStatus(null)

    try {
      const response = await updatePassword({ current_password: currentPassword, new_password: newPassword }, token)
      updateUser(response.user)
      setStatus({ type: "success", message: "Password updated successfully" })
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    } catch (error: any) {
      setStatus({ type: "error", message: error?.message || "Unable to update password" })
    } finally {
      setLoading(false)
    }
  }

  const initials = user.username.slice(0, 2).toUpperCase()
  const rate = metrics ? successRate(metrics) : null

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="enter" className="space-y-8 pb-10 min-h-screen">
      <motion.div variants={revealItem}>
        <h1 className="text-2xl font-bold text-text-primary section-heading">Profile</h1>
        <p className="text-text-muted text-sm mt-1">Your account details, activity signals and security settings</p>
      </motion.div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <div className="space-y-6">
          <motion.div
            variants={revealItem}
            className="border border-app-border shadow-card rounded-xl p-6 sm:p-8"
            style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)", borderTop: "1px solid var(--color-card-border-top)" }}
          >
            <div className="flex items-center gap-5">
              <span className="w-16 h-16 rounded-full bg-accent-primary/10 text-accent-primary text-xl font-bold flex items-center justify-center shrink-0">
                {initials}
              </span>
              <div className="min-w-0">
                <div className="text-2xl font-semibold text-text-primary">{user.username}</div>
                <div className="text-sm text-text-muted break-all mt-0.5">{user.email}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="inline-flex items-center px-3 py-1 text-xs font-semibold border border-app-border text-accent-primary rounded-full">
                    {user.role === "admin" ? "Administrator" : "Maintainer"}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div variants={revealItem} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <ProfileMetricCard icon={Activity} title="Tests" value={profileLoading ? "..." : String(metrics?.total_tests ?? 0)} detail="Recorded runs owned by your account" />
            <ProfileMetricCard
              icon={CheckCircle2}
              title="Success rate"
              value={profileLoading ? "..." : rate == null ? "—" : `${Math.round(rate * 100)}%`}
              detail="Completion ratio across your tests"
            />
            <ProfileMetricCard
              icon={Calendar}
              title="Schedules"
              value={profileLoading ? "..." : String(metrics?.active_schedules ?? 0)}
              detail={`${metrics?.total_schedules ?? 0} total schedules configured`}
            />
            <ProfileMetricCard
              icon={Layers}
              title="Templates"
              value={profileLoading ? "..." : String(metrics?.total_templates ?? 0)}
              detail="Reusable test blueprints you own"
            />
          </motion.div>

          <motion.div
            variants={revealItem}
            className="border border-app-border shadow-card rounded-xl p-6 sm:p-8"
            style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)", borderTop: "1px solid var(--color-card-border-top)" }}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="section-heading text-base font-semibold text-text-primary">Account activity</h2>
                <p className="text-sm text-text-muted mt-1">
                  The same ownership metrics surfaced in the admin workspace, scoped to your own account.
                </p>
              </div>
              <span className="status-badge status-badge--neutral px-3 py-1 text-[11px]">
                <Clock3 size={13} />
                Last test {formatTimestamp(metrics?.last_test_at)}
              </span>
            </div>

            {profileError ? (
              <div className="inline-alert inline-alert--danger mt-4 px-4 py-3 text-sm">{profileError}</div>
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <DetailMetric label="Completed tests" value={profileLoading ? "..." : String(metrics?.completed_tests ?? 0)} />
              <DetailMetric label="Failed tests" value={profileLoading ? "..." : String(metrics?.failed_tests ?? 0)} />
              <DetailMetric label="Active schedules" value={profileLoading ? "..." : String(metrics?.active_schedules ?? 0)} />
              <DetailMetric label="All schedules" value={profileLoading ? "..." : String(metrics?.total_schedules ?? 0)} />
              <DetailMetric label="Templates" value={profileLoading ? "..." : String(metrics?.total_templates ?? 0)} />
              <DetailMetric label="Last test run" value={profileLoading ? "..." : formatTimestamp(metrics?.last_test_at)} />
            </div>
          </motion.div>
        </div>

        <motion.div
          variants={revealItem}
          className="border border-app-border shadow-card rounded-xl p-6 sm:p-8 h-fit"
          style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)", borderTop: "1px solid var(--color-card-border-top)" }}
        >
          <h2 className="section-heading text-base font-semibold text-text-primary mb-6">Security</h2>

          {user.must_change_password && (
            <div className="inline-alert inline-alert--warning mb-4 px-4 py-3 text-sm">
              Your password was reset by an administrator. Please enter the temporary password as your current password and choose a new one now.
            </div>
          )}

          {status && (
            <div className={`mb-4 inline-alert px-4 py-3 text-sm ${status.type === "success" ? "inline-alert--success" : "inline-alert--danger"}`}>
              {status.message}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                Current password
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="mt-1.5 w-full"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                New password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="mt-1.5 w-full"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                Confirm password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-1.5 w-full"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-3 text-sm font-medium rounded-md bg-accent-primary text-white hover:bg-pink-700 transition disabled:opacity-50"
            >
              {loading ? "Updating..." : "Save changes"}
            </button>
          </form>
        </motion.div>
      </div>
    </motion.div>
  )
}

function ProfileMetricCard({
  icon: Icon,
  title,
  value,
  detail,
}: {
  icon: typeof Activity
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

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-app-border bg-app-surface px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">{label}</div>
      <div className="mt-1 text-sm font-medium text-text-primary">{value}</div>
    </div>
  )
}
