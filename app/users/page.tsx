"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createUser, fetchUsers, resetUserPassword, type AdminUserRecord } from "@/lib/api"
import { useSession } from "@/context/SessionContext"
import { motion } from "framer-motion"
import { staggerContainer, revealItem } from "@/lib/motion-variants"
import {
  Activity,
  Calendar,
  CheckCircle2,
  Clock3,
  Layers,
  Plus,
  Search,
  Shield,
  UserPlus,
  Users,
  KeyRound,
} from "lucide-react"

type RoleFilter = "all" | "admin" | "user"

const roleOptions: Array<{ value: RoleFilter; label: string }> = [
  { value: "all", label: "All roles" },
  { value: "admin", label: "Administrators" },
  { value: "user", label: "Maintainers" },
]

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

function formatShortDate(value?: string | null) {
  if (!value) return "—"
  return new Date(value).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

function roleLabel(role: "admin" | "user") {
  return role === "admin" ? "Administrator" : "Maintainer"
}

function roleBadgeClass(role: "admin" | "user") {
  return role === "admin"
    ? "status-badge status-badge--info"
    : "status-badge status-badge--neutral"
}

function successRate(row: AdminUserRecord) {
  if (row.metrics.total_tests === 0) return null
  return row.metrics.completed_tests / row.metrics.total_tests
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

export default function UsersPage() {
  const { user, token, initialized: ready, isAdmin } = useSession()
  const router = useRouter()
  const [users, setUsers] = useState<AdminUserRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [form, setForm] = useState({ username: "", email: "", password: "", role: "user" })
  const [creating, setCreating] = useState(false)
  const [resettingUserId, setResettingUserId] = useState<string | null>(null)
  const [resetInfo, setResetInfo] = useState<{ userId: string; password: string } | null>(null)
  const [query, setQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all")
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

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
    setLoading(true)
    fetchUsers(token)
      .then((data) => {
        if (cancelled) return
        setUsers(data)
        setSelectedUserId((prev) => prev ?? data[0]?.id ?? null)
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus({ type: "error", message: error?.message || "Unable to load users" })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [ready, token, isAdmin])

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return users.filter((entry) => {
      const matchesRole = roleFilter === "all" || entry.role === roleFilter
      if (!matchesRole) return false
      if (!normalizedQuery) return true
      return (
        entry.username.toLowerCase().includes(normalizedQuery) ||
        entry.email.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [users, query, roleFilter])

  useEffect(() => {
    if (filteredUsers.length === 0) {
      setSelectedUserId(null)
      return
    }
    if (!selectedUserId || !filteredUsers.some((entry) => entry.id === selectedUserId)) {
      setSelectedUserId(filteredUsers[0].id)
    }
  }, [filteredUsers, selectedUserId])

  const selectedUser = useMemo(
    () => filteredUsers.find((entry) => entry.id === selectedUserId) ?? filteredUsers[0] ?? null,
    [filteredUsers, selectedUserId],
  )

  const overview = useMemo(() => {
    const now = Date.now()
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

    return {
      totalUsers: users.length,
      admins: users.filter((entry) => entry.role === "admin").length,
      maintainers: users.filter((entry) => entry.role === "user").length,
      recentUsers: users.filter((entry) => {
        if (!entry.created_at) return false
        return new Date(entry.created_at).getTime() >= thirtyDaysAgo
      }).length,
      totalTests: users.reduce((sum, entry) => sum + entry.metrics.total_tests, 0),
      activeSchedules: users.reduce((sum, entry) => sum + entry.metrics.active_schedules, 0),
      avgSuccessRate: (() => {
        const usersWithTests = users.filter((entry) => entry.metrics.total_tests > 0)
        if (usersWithTests.length === 0) return null
        return usersWithTests.reduce((sum, entry) => sum + (successRate(entry) ?? 0), 0) / usersWithTests.length
      })(),
    }
  }, [users])

  if (!ready || !user || !isAdmin) {
    return null
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    setCreating(true)
    setStatus(null)
    setResetInfo(null)

    try {
      await createUser({
        username: form.username,
        email: form.email,
        password: form.password,
        role: form.role as "admin" | "user",
      }, token)
      setStatus({ type: "success", message: "User created" })
      setForm({ username: "", email: "", password: "", role: "user" })
      const refreshed = await fetchUsers(token)
      setUsers(refreshed)
      setSelectedUserId((prev) => prev ?? refreshed[0]?.id ?? null)
    } catch (error: any) {
      setStatus({ type: "error", message: error?.message || "Could not create user" })
    } finally {
      setCreating(false)
    }
  }

  const handleResetPassword = async (target: AdminUserRecord) => {
    if (!token) return
    setResettingUserId(target.id)
    setStatus(null)
    setResetInfo(null)

    try {
      const response = await resetUserPassword(target.id, token)
      setUsers((prev) => prev.map((entry) => (
        entry.id === target.id
          ? {
              ...entry,
              must_change_password: true,
            }
          : entry
      )))
      setResetInfo({ userId: target.id, password: response.temporary_password })
      setStatus({ type: "success", message: `Temporary password generated for ${target.username}` })
    } catch (error: any) {
      setStatus({ type: "error", message: error?.message || "Could not reset password" })
    } finally {
      setResettingUserId(null)
    }
  }

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="enter" className="space-y-6 pb-10">
      <motion.div variants={revealItem} className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="status-badge status-badge--info px-3 py-1 text-[11px] uppercase tracking-[0.16em]">
            Admin Workspace
          </div>
          <h1 className="mt-3 text-3xl font-bold text-text-primary section-heading">Users</h1>
          <p className="text-text-muted text-sm mt-1 max-w-3xl">
            Manage administrators and maintainers, review adoption signals, and keep account operations in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-text-muted">
          <span className="status-badge status-badge--neutral px-3 py-1">Current password change: self-service only</span>
          <span className="status-badge status-badge--success px-3 py-1">Admin reset flow available</span>
        </div>
      </motion.div>

      <motion.div variants={revealItem} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewCard
          icon={Users}
          title="Accounts"
          value={String(overview.totalUsers)}
          detail={`${overview.recentUsers} created in the last 30 days`}
        />
        <OverviewCard
          icon={Shield}
          title="Roles"
          value={`${overview.admins} / ${overview.maintainers}`}
          detail="Administrators / Maintainers"
        />
        <OverviewCard
          icon={Activity}
          title="Test Volume"
          value={String(overview.totalTests)}
          detail={`${overview.activeSchedules} active schedules across all users`}
        />
        <OverviewCard
          icon={CheckCircle2}
          title="Avg Success Rate"
          value={overview.avgSuccessRate == null ? "—" : `${(overview.avgSuccessRate * 100).toFixed(0)}%`}
          detail="Average completion ratio of users with recorded tests"
        />
      </motion.div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.75fr)_minmax(320px,1fr)]">
        <motion.section variants={revealItem} className="app-card border border-app-border rounded-2xl p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Directory</h2>
              <p className="text-sm text-text-muted mt-1">
                Search accounts, inspect ownership signals, and drill into activity without leaving the page.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="relative min-w-[240px]">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search username or email"
                  className="w-full pl-9 pr-3 py-2.5 text-sm"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {roleOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRoleFilter(option.value)}
                    className={`px-3 py-2 text-xs font-medium rounded-full border transition ${
                      roleFilter === option.value
                        ? "border-accent-primary bg-accent-primary text-white"
                        : "border-app-border text-text-muted hover:bg-app-surface-alt"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between text-xs text-text-muted">
            <span>{loading ? "Refreshing directory…" : `Showing ${filteredUsers.length} of ${users.length} accounts`}</span>
            <span>{overview.totalTests} recorded tests in the current dataset</span>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="app-card border border-app-border rounded-xl px-4 py-8 text-center text-sm text-text-muted">
                Loading users…
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="app-card border border-app-border rounded-xl px-4 py-8 text-center text-sm text-text-muted">
                No users match the current filter.
              </div>
            ) : (
              filteredUsers.map((entry) => {
                const entrySuccessRate = successRate(entry)
                const selected = selectedUser?.id === entry.id

                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedUserId(entry.id)}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                      selected
                        ? "border-accent-primary bg-accent-primary/6 shadow-card"
                        : "border-app-border hover:bg-app-surface-alt/60"
                    }`}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-primary/12 text-accent-primary font-semibold shrink-0">
                          {initials(entry.username)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-semibold text-text-primary">{entry.username}</span>
                            <span className={`px-2.5 py-1 text-[11px] ${roleBadgeClass(entry.role)}`}>
                              {roleLabel(entry.role)}
                            </span>
                            {entry.must_change_password && (
                              <span className="status-badge status-badge--warning px-2.5 py-1 text-[11px]">
                                Password change required
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-text-muted break-all mt-1">{entry.email}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-muted">
                            <span className="flex items-center gap-1.5">
                              <Calendar size={13} />
                              Created {formatShortDate(entry.created_at)}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <Clock3 size={13} />
                              Last test {formatShortDate(entry.metrics.last_test_at)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[360px]">
                        <MiniMetric label="Tests" value={String(entry.metrics.total_tests)} />
                        <MiniMetric label="Success" value={entrySuccessRate == null ? "—" : `${Math.round(entrySuccessRate * 100)}%`} />
                        <MiniMetric label="Schedules" value={String(entry.metrics.active_schedules)} />
                        <MiniMetric label="Templates" value={String(entry.metrics.total_templates)} />
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </motion.section>

        <div className="space-y-6">
          <motion.section variants={revealItem} className="app-card border border-app-border rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <Users size={18} className="text-accent-primary" />
              <h2 className="text-lg font-semibold text-text-primary">Selected user</h2>
            </div>

            {!selectedUser ? (
              <div className="mt-4 rounded-xl border border-app-border bg-app-surface px-4 py-8 text-center text-sm text-text-muted">
                Select a user from the directory to inspect account details and activity.
              </div>
            ) : (
              <>
                <div className="mt-5 flex items-start gap-4">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-primary/12 text-accent-primary text-lg font-semibold shrink-0">
                    {initials(selectedUser.username)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-semibold text-text-primary">{selectedUser.username}</h3>
                      <span className={`px-2.5 py-1 text-[11px] ${roleBadgeClass(selectedUser.role)}`}>
                        {roleLabel(selectedUser.role)}
                      </span>
                      {selectedUser.must_change_password && (
                        <span className="status-badge status-badge--warning px-2.5 py-1 text-[11px]">
                          Password change required
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-text-muted mt-1 break-all">{selectedUser.email}</p>
                    <p className="text-xs text-text-muted mt-2 font-mono break-all">ID {selectedUser.id}</p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <DetailMetric label="Created" value={formatTimestamp(selectedUser.created_at)} />
                  <DetailMetric label="Last test" value={formatTimestamp(selectedUser.metrics.last_test_at)} />
                  <DetailMetric label="Total tests" value={String(selectedUser.metrics.total_tests)} />
                  <DetailMetric label="Completed" value={String(selectedUser.metrics.completed_tests)} />
                  <DetailMetric label="Failed" value={String(selectedUser.metrics.failed_tests)} />
                  <DetailMetric label="Active schedules" value={String(selectedUser.metrics.active_schedules)} />
                  <DetailMetric label="All schedules" value={String(selectedUser.metrics.total_schedules)} />
                  <DetailMetric label="Templates" value={String(selectedUser.metrics.total_templates)} />
                </div>

                <div className="mt-5 rounded-2xl border border-app-border bg-app-surface px-4 py-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                    <Shield size={16} className="text-accent-primary" />
                    Security operations
                  </div>
                  <p className="mt-2 text-sm text-text-muted">
                    Users can change their own password in the profile area. Admins can now issue a temporary password and require a mandatory
                    password update on next sign-in. Forgot-password email, audit trail and lockout handling are still open.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => handleResetPassword(selectedUser)}
                      disabled={resettingUserId === selectedUser.id}
                      className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-pink-700 transition disabled:opacity-50"
                    >
                      <KeyRound size={15} />
                      {resettingUserId === selectedUser.id ? "Resetting..." : "Reset password"}
                    </button>
                  </div>
                  {resetInfo?.userId === selectedUser.id && (
                    <div className="inline-alert inline-alert--warning mt-4 px-4 py-3 text-sm">
                      Temporary password: <span className="font-mono font-semibold">{resetInfo.password}</span>. Share it once over a secure channel.
                    </div>
                  )}
                </div>
              </>
            )}
          </motion.section>

          <motion.section variants={revealItem} className="app-card border border-app-border rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <UserPlus size={18} className="text-accent-primary" />
              <h2 className="text-lg font-semibold text-text-primary">Create user</h2>
            </div>
            <p className="mt-1 text-sm text-text-muted">
              Add a new administrator or maintainer without leaving the workspace.
            </p>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div>
                <label className="text-xs uppercase tracking-wide text-text-muted">Username</label>
                <input
                  value={form.username}
                  onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
                  className="mt-2 w-full px-4 py-3 text-sm"
                  placeholder="username"
                  required
                />
              </div>

              <div>
                <label className="text-xs uppercase tracking-wide text-text-muted">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                  className="mt-2 w-full px-4 py-3 text-sm"
                  placeholder="user@example.com"
                  required
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs uppercase tracking-wide text-text-muted">Initial password</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                    className="mt-2 w-full px-4 py-3 text-sm"
                    placeholder="strong password"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs uppercase tracking-wide text-text-muted">Role</label>
                  <select
                    value={form.role}
                    onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}
                    className="mt-2 w-full px-4 py-3 text-sm"
                  >
                    <option value="user">Maintainer</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={creating}
                className="inline-flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-medium rounded-xl bg-accent-primary text-white hover:bg-pink-700 transition disabled:opacity-50"
              >
                <Plus size={16} />
                {creating ? "Creating…" : "Create user"}
              </button>
            </form>

            {status && (
              <div className={`mt-4 inline-alert px-4 py-3 text-sm ${status.type === "success" ? "inline-alert--success" : "inline-alert--danger"}`}>
                {status.message}
              </div>
            )}
          </motion.section>

          <motion.section variants={revealItem} className="app-card border border-app-border rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <Layers size={18} className="text-accent-primary" />
              <h2 className="text-lg font-semibold text-text-primary">Enterprise gaps</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm text-text-muted">
              <div className="rounded-xl border border-app-border bg-app-surface px-4 py-3">
                Admin password reset and self-service forgot-password are not available yet.
              </div>
              <div className="rounded-xl border border-app-border bg-app-surface px-4 py-3">
                There is no login audit, no forced password rotation and no account lockout tracking today.
              </div>
              <div className="rounded-xl border border-app-border bg-app-surface px-4 py-3">
                Metrics now surface ownership activity, but last login, failed logins and MFA status are not tracked yet.
              </div>
            </div>
          </motion.section>
        </div>
      </div>
    </motion.div>
  )
}

function OverviewCard({
  icon: Icon,
  title,
  value,
  detail,
}: {
  icon: typeof Users
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

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-app-border bg-app-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold text-text-primary">{value}</div>
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
