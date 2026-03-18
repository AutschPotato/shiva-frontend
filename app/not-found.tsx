"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "@/context/SessionContext"

export default function NotFound() {
  const router = useRouter()
  const { initialized: ready, user } = useSession()

  const target = useMemo(() => {
    if (!ready) return null
    return user ? "/" : "/login"
  }, [ready, user])

  return (
    <div className="min-h-screen bg-white text-text-primary flex items-center justify-center p-6">
      <div className="w-full max-w-xl border border-app-border bg-white shadow-card p-6 sm:p-10 rounded-lg">
        <div className="text-text-muted text-xs tracking-widest uppercase">404</div>
        <div className="mt-2 text-2xl sm:text-3xl font-bold text-accent-primary">Page Not Found</div>
        <div className="mt-3 text-sm text-text-muted leading-relaxed">
          The route you requested does not exist.
        </div>

        <div className="mt-8 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (!target) return
              router.replace(target)
            }}
            className="px-5 py-2.5 bg-accent-primary text-white hover:bg-pink-700 rounded-md"
            disabled={!target}
          >
            {target ? "Go Home" : "Loading..."}
          </button>
          <div className="text-xs text-text-muted">
            {target === "/" ? "Redirects to dashboard" : target === "/login" ? "Redirects to login" : "Checking session..."}
          </div>
        </div>
      </div>
    </div>
  )
}
