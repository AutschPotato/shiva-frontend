"use client"

export const dynamic = "force-dynamic"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getResultsList } from "@/lib/api"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import { staggerContainer, revealItem } from "@/lib/motion-variants"
import { useSession } from "@/context/SessionContext"

interface ResultItem {
  id: string
  project_name: string
  url: string
  status: string
  created_at: string
  error_rate?: number | null
  total_requests?: number | null
  avg_latency_ms?: number | null
  p95_latency_ms?: number | null
  duration_s?: number | null
  total_vus?: number | null
  run_by?: {
    id?: string
    username?: string
  }
}

function fmtNum(n: number | undefined | null): string {
  if (n == null) return "—"
  return Math.round(n).toLocaleString("de-DE")
}

function fmtDuration(s: number | undefined | null): string {
  if (s == null) return "—"
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const rest = Math.round(s % 60)
  return rest > 0 ? `${m}m ${rest}s` : `${m}m`
}

function fmtLatency(ms: number | undefined | null): string {
  if (ms == null) return "—"
  return `${Math.round(ms)} ms`
}

function fmtErrorRate(rate: number | undefined | null): string {
  if (rate == null) return "—"
  return `${(rate * 100).toFixed(1)}%`
}

const statusColors: Record<string, string> = {
  completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  running: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  stopped: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
}

const ITEMS_PER_PAGE = 8

export default function ResultPage() {
  const router = useRouter()
  const { user, token, initialized: ready } = useSession()
  const [results, setResults] = useState<ResultItem[]>([])
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (!token) return

    async function load() {
      try {
        const res = await getResultsList(
          {
            limit: ITEMS_PER_PAGE,
            offset: (page - 1) * ITEMS_PER_PAGE,
            q: search || undefined,
          },
          token
        )
        setResults((res.results ?? res.items ?? []) as ResultItem[])
        setTotal(res.total || 0)
      } catch (error) {
        console.error("Failed to load results", error)
      }
    }

    load()
  }, [token, page, search])

  useEffect(() => {
    if (ready && !user) {
      router.replace("/login")
    }
  }, [ready, user, router])

  if (!ready || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-text-muted">Loading results...</div>
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE))

  const nextPage = () => {
    if (page < totalPages) setPage((p) => p + 1)
  }

  const prevPage = () => {
    if (page > 1) setPage((p) => p - 1)
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="enter"
      className="space-y-6 pb-10"
    >
      <motion.div variants={revealItem}>
        <h1 className="text-2xl font-bold text-text-primary section-heading">Results</h1>
        <p className="text-text-muted text-sm mt-1">Browse and analyze completed load test runs</p>
      </motion.div>

      {/* Search */}
      <motion.div variants={revealItem} className="md:static sticky top-0 z-10 py-3" style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)", borderTop: "1px solid var(--color-card-border-top)" }}>
        <input
          type="text"
          placeholder="Search by Run ID or Test Run Name"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          className="w-full px-4 py-3 text-sm"
        />
      </motion.div>

      {/* DESKTOP TABLE */}
      <motion.div variants={revealItem} className="hidden md:block border border-app-border shadow-card rounded-xl overflow-hidden" style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)", borderTop: "1px solid var(--color-card-border-top)" }}>
        <table className="w-full text-sm">
          <thead className="bg-app-surface border-b border-app-border sticky top-0">
            <tr className="text-left text-text-muted uppercase text-xs tracking-wider">
              <th className="px-4 py-4">Run ID</th>
              <th className="px-4 py-4">Test Run</th>
              <th className="px-4 py-4">Status</th>
              <th className="px-4 py-4 text-right">Requests</th>
              <th className="px-4 py-4 text-right">Duration</th>
              <th className="px-4 py-4 text-right">P95</th>
              <th className="px-4 py-4 text-right">Error Rate</th>
              <th className="px-4 py-4">Run By</th>
              <th className="px-4 py-4">Created</th>
              <th className="px-4 py-4 text-right">Action</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-app-border">
            <AnimatePresence>
            {results.map((r) => {
                const runBy = r.run_by || { username: "system" }
                const statusClass = statusColors[r.status] || "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300"

              return (
                <motion.tr
                    key={r.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  className="hover:bg-app-surface-alt"
                >
                    <td className="px-4 py-4 font-mono text-xs">{r.id}</td>
                    <td className="px-4 py-4 font-semibold text-accent-primary">
                      {r.project_name}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`px-2 py-1 text-xs rounded-full font-medium ${statusClass}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-xs">{fmtNum(r.total_requests)}</td>
                    <td className="px-4 py-4 text-right font-mono text-xs">{fmtDuration(r.duration_s)}</td>
                    <td className="px-4 py-4 text-right font-mono text-xs">{fmtLatency(r.p95_latency_ms)}</td>
                    <td className="px-4 py-4 text-right font-mono text-xs">
                      {r.error_rate != null && r.error_rate > 0.05 ? (
                        <span className="text-red-600 font-semibold">{fmtErrorRate(r.error_rate)}</span>
                      ) : (
                        fmtErrorRate(r.error_rate)
                      )}
                    </td>
                    <td className="px-4 py-4 text-xs text-text-muted">{runBy.username}</td>
                    <td className="px-4 py-4 text-xs text-text-muted">
                      {new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19)}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <Link
                        href={`/result/${r.id}`}
                        className="px-4 py-2 text-sm font-medium rounded-md bg-accent-primary text-white hover:bg-pink-700 transition"
                      >
                        View
                      </Link>
                    </td>
                  </motion.tr>
                )
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </motion.div>

      {/* MOBILE CARD VIEW */}
      <motion.div variants={revealItem} className="md:hidden overflow-hidden">
        <motion.div
          key={page}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          onDragEnd={(e, info) => {
            if (info.offset.x < -50) nextPage()
            if (info.offset.x > 50) prevPage()
          }}
          initial={{ x: 100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -100, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-4"
        >
          {results.map((r) => {
            const runBy = r.run_by || { username: "system" }
            const statusClass = statusColors[r.status] || "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300"

            return (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="border border-app-border shadow-card p-4 space-y-3 rounded-xl"
                style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)", borderTop: "1px solid var(--color-card-border-top)" }}
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs font-mono break-all text-text-muted">
                    {r.id}
                  </div>
                  <span className={`px-2 py-1 text-xs rounded-full font-medium ${statusClass}`}>
                    {r.status}
                  </span>
                </div>

                <div className="font-semibold text-lg text-accent-primary">
                  {r.project_name}
                </div>

                <div className="text-xs text-text-muted">
                  Run by {runBy.username}
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-text-muted text-xs">Requests</span>
                    <div className="font-mono">{fmtNum(r.total_requests)}</div>
                  </div>
                  <div>
                    <span className="text-text-muted text-xs">Duration</span>
                    <div className="font-mono">{fmtDuration(r.duration_s)}</div>
                  </div>
                  <div>
                    <span className="text-text-muted text-xs">P95 Latency</span>
                    <div className="font-mono">{fmtLatency(r.p95_latency_ms)}</div>
                  </div>
                  <div>
                    <span className="text-text-muted text-xs">Error Rate</span>
                    <div className="font-mono">{fmtErrorRate(r.error_rate)}</div>
                  </div>
                </div>

                <div className="text-xs text-text-muted">
                  {new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19)}
                </div>

                <Link
                  href={`/result/${r.id}`}
                  className="block text-center px-4 py-2 text-sm font-medium rounded-md bg-accent-primary text-white hover:bg-pink-700 transition"
                >
                  View Result
                </Link>
              </motion.div>
            )
          })}
        </motion.div>
      </motion.div>

      {/* Pagination */}
      {totalPages > 1 && (
        <motion.div variants={revealItem} className="flex justify-center gap-4 pt-4">
          <button
            onClick={prevPage}
            disabled={page === 1}
            className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
          >
            Prev
          </button>

          <span className="text-sm font-medium text-text-muted">
            Page {page} / {totalPages}
          </span>

          <button
            onClick={nextPage}
            disabled={page === totalPages}
            className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
          >
            Next
          </button>
        </motion.div>
      )}
    </motion.div>
  )
}
