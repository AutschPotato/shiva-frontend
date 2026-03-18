"use client"

import { Suspense, useEffect } from "react"
import { useRouter } from "next/navigation"
import Card from "@/components/Card"
import RunForm from "@/components/RunForm"
import { useSession } from "@/context/SessionContext"

export default function LoadTestPage() {
  const router = useRouter()
  const { user, initialized: ready } = useSession()

  useEffect(() => {
    if (ready && !user) {
      router.replace("/login")
    }
  }, [ready, user, router])

  if (!ready || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-text-muted">Loading...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary section-heading">Run Test</h1>
        <p className="text-text-muted text-sm mt-1">Configure and execute a load test against your target</p>
      </div>
      <Card>
        <Suspense fallback={<div className="text-sm text-text-muted">Loading...</div>}>
          <RunForm />
        </Suspense>
      </Card>
    </div>
  )
}
