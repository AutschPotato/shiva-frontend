"use client"

import Link from "next/link"
import { FormEvent, useState } from "react"
import { motion } from "framer-motion"
import { ArrowLeft, Mail, ShieldAlert } from "lucide-react"

import { requestPasswordReset } from "@/lib/api"
import { staggerContainer as staggerGroup, revealItem } from "@/lib/motion-variants"

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError("")
    setMessage("")

    try {
      const response = await requestPasswordReset(identifier)
      setMessage(response.message)
    } catch (err: any) {
      setError(err?.message || "Unable to prepare password reset")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(204,43,94,0.28),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(18,22,44,0.9),_transparent_42%),#090b12] px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <motion.div
          variants={staggerGroup}
          initial="initial"
          animate="enter"
          className="grid w-full overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.06] shadow-2xl shadow-black/40 backdrop-blur-xl lg:grid-cols-[1.1fr_0.9fr]"
        >
          <div className="hidden border-r border-white/10 bg-[linear-gradient(160deg,rgba(204,43,94,0.14),rgba(10,13,24,0.2))] p-10 lg:flex lg:flex-col lg:justify-between">
            <motion.div variants={revealItem} className="space-y-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/10">
                <Mail className="text-accent-primary" size={22} />
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.35em] text-white/40">Account Recovery</p>
                <h1 className="text-3xl font-semibold text-white">Reset access without admin intervention.</h1>
                <p className="max-w-md text-sm leading-7 text-white/60">
                  Enter your username or email address. If a matching account exists, we prepare a secure reset link
                  and ask you to choose a new password on the next step.
                </p>
              </div>
            </motion.div>

            <motion.div variants={revealItem} className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <div className="mb-3 flex items-center gap-3">
                <ShieldAlert size={18} className="text-amber-300" />
                <p className="text-sm font-medium text-white">Security behavior</p>
              </div>
              <ul className="space-y-2 text-sm text-white/60">
                <li>The response stays generic to avoid account enumeration.</li>
                <li>Reset links are single-use and expire automatically.</li>
                <li>Admins can still issue temporary passwords separately.</li>
              </ul>
            </motion.div>
          </div>

          <div className="p-6 sm:p-8 lg:p-10">
            <motion.div variants={revealItem} className="mb-8 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Forgot password</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Request reset link</h2>
              </div>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs text-white/55 transition-colors hover:border-white/20 hover:text-white"
              >
                <ArrowLeft size={14} />
                Back to login
              </Link>
            </motion.div>

            <motion.form variants={staggerGroup} initial="initial" animate="enter" onSubmit={handleSubmit} className="space-y-5">
              <motion.div variants={revealItem} className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-white/50">
                  Username or email
                </label>
                <input
                  type="text"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-accent-primary/60 focus:outline-none focus:ring-1 focus:ring-accent-primary/30"
                  placeholder="j.doe or j.doe@example.com"
                  autoComplete="username"
                />
              </motion.div>

              {error ? (
                <motion.div variants={revealItem} className="inline-alert inline-alert--danger px-4 py-3 text-sm">
                  {error}
                </motion.div>
              ) : null}

              {message ? (
                <motion.div variants={revealItem} className="inline-alert inline-alert--info px-4 py-3 text-sm">
                  {message}
                </motion.div>
              ) : null}

              <motion.div variants={revealItem} className="space-y-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-accent-primary px-4 py-3 text-sm font-semibold text-white transition-all duration-200 hover:bg-pink-600 hover:shadow-lg hover:shadow-accent-primary/25 disabled:opacity-50"
                >
                  {loading ? "Preparing reset..." : "Send reset link"}
                </button>
                <p className="text-xs leading-6 text-white/38">
                  If SMTP is not configured, the backend emits the reset link to the server logs for controlled
                  administrative handling.
                </p>
              </motion.div>
            </motion.form>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
