"use client"

import Link from "next/link"
import { FormEvent, Suspense, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { motion } from "framer-motion"
import { CheckCircle2, KeyRound, ShieldCheck } from "lucide-react"

import { completePasswordReset } from "@/lib/api"
import { staggerContainer as staggerGroup, revealItem } from "@/lib/motion-variants"

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordShell />}>
      <ResetPasswordContent />
    </Suspense>
  )
}

function ResetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams])

  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    setMessage("")

    if (!token) {
      setError("Missing reset token. Open the link from your reset email again.")
      return
    }
    if (!password || !confirmPassword) {
      setError("Please enter and confirm your new password.")
      return
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    setLoading(true)
    try {
      const response = await completePasswordReset({ token, new_password: password })
      setMessage(response.message)
      window.setTimeout(() => router.replace("/login"), 1200)
    } catch (err: any) {
      setError(err?.message || "Unable to reset password")
    } finally {
      setLoading(false)
    }
  }

  return <ResetPasswordShell token={token} password={password} confirmPassword={confirmPassword} loading={loading} error={error} message={message} setPassword={setPassword} setConfirmPassword={setConfirmPassword} handleSubmit={handleSubmit} />
}

function ResetPasswordShell({
  token = "",
  password = "",
  confirmPassword = "",
  loading = false,
  error = "",
  message = "",
  setPassword,
  setConfirmPassword,
  handleSubmit,
}: {
  token?: string
  password?: string
  confirmPassword?: string
  loading?: boolean
  error?: string
  message?: string
  setPassword?: (value: string) => void
  setConfirmPassword?: (value: string) => void
  handleSubmit?: (event: FormEvent) => void
}) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(204,43,94,0.25),_transparent_28%),radial-gradient(circle_at_bottom_left,_rgba(25,31,54,0.8),_transparent_40%),#090b12] px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-4xl items-center justify-center">
        <motion.div
          variants={staggerGroup}
          initial="initial"
          animate="enter"
          className="w-full overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.06] shadow-2xl shadow-black/40 backdrop-blur-xl"
        >
          <div className="grid gap-0 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="border-b border-white/10 bg-[linear-gradient(165deg,rgba(204,43,94,0.15),rgba(15,17,28,0.28))] p-8 lg:border-b-0 lg:border-r">
              <motion.div variants={revealItem} className="space-y-5">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/10">
                  <KeyRound className="text-accent-primary" size={22} />
                </div>
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.35em] text-white/40">Password reset</p>
                  <h1 className="text-3xl font-semibold text-white">Choose a new password</h1>
                  <p className="text-sm leading-7 text-white/60">
                    This link is single-use and expires automatically. After a successful reset, you return to the
                    regular login screen and continue with your new credentials.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-sm text-white/60">
                  <div className="mb-3 flex items-center gap-2 text-white">
                    <ShieldCheck size={16} className="text-emerald-300" />
                    Recovery safeguards
                  </div>
                  <ul className="space-y-2">
                    <li>Existing reset tokens are invalidated when a new request is issued.</li>
                    <li>The completed reset clears any forced password-change flag.</li>
                    <li>Expired or reused tokens are rejected server-side.</li>
                  </ul>
                </div>
              </motion.div>
            </div>

            <div className="p-6 sm:p-8 lg:p-10">
              <motion.div variants={revealItem} className="mb-8 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/40">Final step</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Set new password</h2>
                </div>
                <Link
                  href="/login"
                  className="rounded-full border border-white/10 px-3 py-2 text-xs text-white/55 transition-colors hover:border-white/20 hover:text-white"
                >
                  Back to login
                </Link>
              </motion.div>

              <motion.form variants={staggerGroup} initial="initial" animate="enter" onSubmit={handleSubmit} className="space-y-5">
                <motion.div variants={revealItem} className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-white/50">New password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword?.(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-accent-primary/60 focus:outline-none focus:ring-1 focus:ring-accent-primary/30"
                    placeholder="Enter your new password"
                    autoComplete="new-password"
                  />
                </motion.div>

                <motion.div variants={revealItem} className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-white/50">Confirm password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword?.(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-accent-primary/60 focus:outline-none focus:ring-1 focus:ring-accent-primary/30"
                    placeholder="Repeat your new password"
                    autoComplete="new-password"
                  />
                </motion.div>

                {!token ? (
                  <motion.div variants={revealItem} className="inline-alert inline-alert--warning px-4 py-3 text-sm">
                    No reset token was found in the URL. Open the full password reset link again.
                  </motion.div>
                ) : null}

                {error ? (
                  <motion.div variants={revealItem} className="inline-alert inline-alert--danger px-4 py-3 text-sm">
                    {error}
                  </motion.div>
                ) : null}

                {message ? (
                  <motion.div variants={revealItem} className="inline-alert inline-alert--success flex items-center gap-2 px-4 py-3 text-sm">
                    <CheckCircle2 size={16} />
                    <span>{message}</span>
                  </motion.div>
                ) : null}

                <motion.div variants={revealItem}>
                  <button
                    type="submit"
                    disabled={loading || !token}
                    className="w-full rounded-xl bg-accent-primary px-4 py-3 text-sm font-semibold text-white transition-all duration-200 hover:bg-pink-600 hover:shadow-lg hover:shadow-accent-primary/25 disabled:opacity-50"
                  >
                    {loading ? "Resetting password..." : "Save new password"}
                  </button>
                </motion.div>
              </motion.form>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
