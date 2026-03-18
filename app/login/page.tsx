"use client"

import { FormEvent, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "@/context/SessionContext"
import { motion } from "framer-motion"
import { Zap } from "lucide-react"
import Image from "next/image"
import { staggerContainer as staggerGroup, revealItem } from "@/lib/motion-variants"

export default function LoginPage() {
  const { signIn: login, initialized: ready, user } = useSession()
  const router = useRouter()
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (ready && user) {
      router.replace(user.must_change_password ? "/profile" : "/")
    }
  }, [ready, user, router])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    setLoading(true)

    try {
      const signedInUser = await login({ identifier, password })
      router.replace(signedInUser.must_change_password ? "/profile" : "/")
    } catch (err: any) {
      setError(err?.message || "Unable to sign in")
    } finally {
      setLoading(false)
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#1a0a12] flex items-center justify-center">
        <motion.div
          animate={{ opacity: [0.55, 1, 0.55] }}
          transition={{ repeat: Infinity, duration: 1.6 }}
          className="text-sm font-medium tracking-widest uppercase text-accent-primary"
        >
          Loading...
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#1a0a12]">
      {/* Full-bleed background image — covers the entire viewport */}
      <motion.div
        initial={{ opacity: 0, scale: 1.05 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="absolute inset-0"
      >
        <Image
          src="/shiva.png"
          alt="Shiva — Destroyer of Worlds"
          fill
          className="object-cover object-center select-none"
          priority
          draggable={false}
        />
      </motion.div>

      {/* Overlay: subtle noise/grain for depth */}
      <div className="absolute inset-0 opacity-[0.04] mix-blend-overlay" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
      }} />

      {/* Gradient: right side fade for form readability */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent via-40% to-[#1a0a12]/95 lg:to-[#1a0a12]" />

      {/* Gradient: bottom edge fade */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#1a0a12] via-[#1a0a12]/40 via-20% to-transparent" />

      {/* Gradient: top edge fade */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#1a0a12]/70 via-transparent via-30% to-transparent" />

      {/* Mobile: stronger center overlay for form readability */}
      <div className="absolute inset-0 bg-[#1a0a12]/60 lg:hidden" />

      {/* Content layer */}
      <div className="relative z-10 min-h-screen flex flex-col lg:flex-row">

        {/* Left: Hero area with branding text (occupies image space) */}
        <div className="hidden lg:flex lg:w-1/2 xl:w-[55%] relative flex-col justify-between p-8 xl:p-12">
          {/* Top-left branding */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex items-center gap-3"
          >
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md border border-white/10">
              <Zap size={20} className="text-accent-primary" />
            </span>
            <span className="text-white/90 text-xl font-bold tracking-tight">Shiva</span>
          </motion.div>

          {/* Bottom tagline */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.6 }}
            className="max-w-lg"
          >
            <div className="text-white/90 text-3xl xl:text-4xl font-bold tracking-tight leading-tight">
              Now I am become Death,
              <br />
              <span className="text-accent-primary drop-shadow-[0_0_20px_rgba(226,0,116,0.5)]">
                the destroyer of worlds.
              </span>
            </div>
            <div className="mt-4 text-white/35 text-sm leading-relaxed max-w-sm">
              Distributed load testing platform with multi-worker orchestration.
              Push your infrastructure to the absolute limit.
            </div>
          </motion.div>
        </div>

        {/* Right: Login Form */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-10 lg:px-8">

          {/* Mobile-only branding (visible below lg) */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="text-center mb-8 lg:hidden"
          >
            <div className="flex items-center justify-center gap-2.5 mb-3">
              <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md border border-white/10">
                <Zap size={22} className="text-accent-primary" />
              </span>
              <span className="text-2xl font-bold text-white">Shiva</span>
            </div>
            <div className="text-[11px] tracking-[0.2em] uppercase text-white/40">
              Now I am become Death, the destroyer of worlds
            </div>
          </motion.div>

          {/* Login Card — glass morphism style */}
          <motion.div
            variants={staggerGroup}
            initial="initial"
            animate="enter"
            className="w-full max-w-sm"
          >
            <div className="bg-white/[0.07] backdrop-blur-xl border border-white/[0.12] rounded-2xl shadow-2xl shadow-black/40 overflow-hidden">
              {/* Accent glow line */}
              <div className="h-px bg-gradient-to-r from-transparent via-accent-primary to-transparent" />

              <div className="p-6 sm:p-8 space-y-6">
                <motion.div variants={revealItem} className="space-y-1">
                  <div className="text-white text-xl font-bold">Sign In</div>
                  <div className="text-white/40 text-sm">Enter your credentials to continue</div>
                </motion.div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="border border-red-500/30 bg-red-500/10 backdrop-blur px-4 py-3 text-sm text-red-300 rounded-lg"
                  >
                    {error}
                  </motion.div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <motion.div variants={revealItem} className="space-y-1.5">
                    <label className="text-white/50 text-xs font-medium uppercase tracking-wider">
                      Username or Email
                    </label>
                    <input
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      className="w-full bg-white/[0.06] border border-white/[0.1] rounded-lg px-4 py-2.5 text-white placeholder-white/25 focus:outline-none focus:border-accent-primary/60 focus:ring-1 focus:ring-accent-primary/30 transition"
                      placeholder="user@example.com"
                      autoComplete="username"
                    />
                  </motion.div>

                  <motion.div variants={revealItem} className="space-y-1.5">
                    <label className="text-white/50 text-xs font-medium uppercase tracking-wider">
                      Password
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="w-full bg-white/[0.06] border border-white/[0.1] rounded-lg px-4 py-2.5 text-white placeholder-white/25 focus:outline-none focus:border-accent-primary/60 focus:ring-1 focus:ring-accent-primary/30 transition"
                      placeholder="Enter your password"
                      autoComplete="current-password"
                    />
                  </motion.div>

                  <motion.div variants={revealItem} className="pt-1">
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full px-4 py-3 text-sm font-semibold rounded-lg bg-accent-primary text-white hover:bg-pink-600 hover:shadow-lg hover:shadow-accent-primary/25 transition-all duration-200 disabled:opacity-50"
                    >
                      {loading ? "Signing in..." : "Sign In"}
                    </button>
                  </motion.div>

                  <motion.div variants={revealItem} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-white/35">Need help accessing your account?</span>
                    <Link
                      href="/forgot-password"
                      className="text-accent-primary hover:text-pink-300 transition-colors"
                    >
                      Forgot password
                    </Link>
                  </motion.div>
                </form>

                <motion.div variants={revealItem} className="text-xs text-white/25 border-t border-white/[0.08] pt-4 text-center">
                  Contact your administrator if you cannot sign in.
                </motion.div>
              </div>
            </div>
          </motion.div>

          {/* Feature highlights */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-[11px] text-white/30 tracking-wide"
          >
            {[
              "Multi-worker orchestration",
              "Real-time metrics",
              "Distributed execution",
              "Role-based access",
            ].map((text, i) => (
              <span key={text} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-white/15 hidden sm:inline">&middot;</span>}
                {text}
              </span>
            ))}
          </motion.div>
        </div>
      </div>
    </div>
  )
}
