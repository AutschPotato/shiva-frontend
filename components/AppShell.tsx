"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import Header from "@/components/Header"
import Sidebar from "@/components/Sidebar"
import { useSession } from "@/context/SessionContext"

/** Routes that render inside the app chrome (sidebar + header). */
const APP_ROUTE_PATTERN = /^\/(load-test|schedule|templates|users|profile|result|worker-dashboards)(\/|$)|^\/$/

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useSession()

  const showChrome = useMemo(() => APP_ROUTE_PATTERN.test(pathname), [pathname])

  useEffect(() => {
    if (!user?.must_change_password) return
    if (pathname === "/profile") return
    router.replace("/profile")
  }, [user, pathname, router])

  if (!showChrome) {
    return <main className="min-h-screen">{children}</main>
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        setCollapsed={setCollapsed}
      />

      <div
        className={`flex-1 min-w-0 flex flex-col transition-all duration-300 ${
          collapsed ? "lg:ml-20" : "lg:ml-64"
        }`}
      >
        <Header
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          setMobileOpen={setMobileOpen}
        />

        <main className="p-4 sm:p-6 md:p-8 min-w-0">{children}</main>
      </div>
    </div>
  )
}
