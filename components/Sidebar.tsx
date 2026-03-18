"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useEffect, useMemo } from "react"
import {
  Globe,
  Rocket,
  TrendingUp,
  Users,
  Zap,
  Layers,
  Calendar,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  Sun,
  Moon,
  Monitor,
} from "lucide-react"
import { useSession } from "@/context/SessionContext"
import { useTheme } from "@/context/ThemeContext"

export default function Sidebar({
  collapsed,
  mobileOpen,
  setMobileOpen,
  setCollapsed,
}: {
  collapsed: boolean
  mobileOpen: boolean
  setMobileOpen: (v: boolean) => void
  setCollapsed: (v: boolean) => void
}) {
  const pathname = usePathname()
  const { user, signOut: logout } = useSession()
  const { theme, toggleTheme } = useTheme()

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname, setMobileOpen])

  const mainLinks = useMemo(
    () => [
      { href: "/", label: "Overview", icon: Globe },
      { href: "/load-test", label: "Run Test", icon: Rocket },
      { href: "/schedule", label: "Schedule", icon: Calendar },
      { href: "/templates", label: "Templates", icon: Layers },
      { href: "/result", label: "Results", icon: TrendingUp },
    ],
    []
  )

  const accountLinks = useMemo(() => {
    const links: { href: string; label: string; icon: typeof Users }[] = []
    if (user?.role === "admin") links.push({ href: "/worker-dashboards", label: "Worker Dashboards", icon: Monitor })
    if (user?.role === "admin") links.push({ href: "/users", label: "Users", icon: Users })
    return links
  }, [user])

  const isActive = (path: string) =>
    pathname === path || (path !== "/" && pathname.startsWith(path + "/"))

  const linkClass = (path: string) => {
    const active = isActive(path)
    return `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors relative ${
      active
        ? "text-white font-semibold bg-white/10"
        : "text-sidebar-dim hover:text-sidebar-text hover:bg-white/5"
    }`
  }

  const activeBar = (path: string) =>
    isActive(path) ? (
      <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full bg-accent-primary" />
    ) : null

  // User initials for avatar
  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : "?"

  return (
    <>
      {/* Mobile Overlay */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 lg:hidden ${
          mobileOpen ? "opacity-100 visible" : "opacity-0 invisible"
        }`}
        onClick={() => setMobileOpen(false)}
      />

      <aside
        className={`
          fixed top-0 left-0 h-full bg-sidebar-bg z-50
          flex flex-col
          transform transition-all duration-300 ease-in-out

          ${collapsed ? "lg:w-20" : "lg:w-64"}

          ${
            mobileOpen
              ? "translate-x-0 w-64"
              : "-translate-x-full w-64"
          }

          lg:translate-x-0
        `}
      >
        {/* LOGO — click to toggle sidebar collapse */}
        <div className={`px-4 pt-5 pb-4 ${collapsed ? "flex justify-center" : ""}`}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-2.5 w-full group cursor-pointer"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-accent-primary/15 shrink-0">
              <Zap size={20} className="text-accent-primary" />
            </span>
            {!collapsed && (
              <>
                <div className="leading-tight text-left flex-1 min-w-0">
                  <div className="text-[15px] font-bold text-sidebar-text tracking-tight">Shiva</div>
                  <div className="text-[10px] text-sidebar-dim tracking-wider uppercase">Destroyer of Servers</div>
                </div>
                <ChevronsLeft size={16} className="text-sidebar-dim opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </>
            )}
            {collapsed && (
              <ChevronsRight size={16} className="absolute left-[72px] text-sidebar-dim opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </button>
        </div>

        {/* DIVIDER */}
        <div className="mx-4 border-t border-sidebar-border" />

        {/* NAVIGATION */}
        <nav className="flex-1 overflow-y-auto py-4">
          {/* Main Section */}
          {!collapsed && (
            <div className="px-4 pb-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-dim">
              Main
            </div>
          )}
          <div className="space-y-0.5">
            {mainLinks.map((link) => (
              <Link key={link.href} href={link.href} className={linkClass(link.href)}>
                {activeBar(link.href)}
                <link.icon size={20} />
                {!collapsed && <span>{link.label}</span>}
              </Link>
            ))}
          </div>

          {/* Account Section */}
          {accountLinks.length > 0 && (
            <>
              <div className={`mx-4 my-3 border-t border-sidebar-border`} />
              {!collapsed && (
                <div className="px-4 pb-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-dim">
                  Account
                </div>
              )}
              <div className="space-y-0.5">
                {accountLinks.map((link) => (
                  <Link key={link.href} href={link.href} className={linkClass(link.href)}>
                    {activeBar(link.href)}
                    <link.icon size={20} />
                    {!collapsed && <span>{link.label}</span>}
                  </Link>
                ))}
              </div>
            </>
          )}
        </nav>

        {/* THEME TOGGLE */}
        <div className="mx-4 border-t border-sidebar-border" />
        <button
          onClick={toggleTheme}
          className={`mx-2 my-2 flex items-center gap-3 px-4 py-2.5 text-sm text-sidebar-dim hover:text-sidebar-text hover:bg-white/5 rounded-md transition-colors ${
            collapsed ? "justify-center" : ""
          }`}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          {!collapsed && (
            <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
          )}
        </button>

        {/* SHIVA WATERMARK */}
        <div className="absolute bottom-0 left-0 right-0 h-64 overflow-hidden pointer-events-none opacity-[0.03] dark:opacity-[0.08]">
          <Image
            src="/shiva.png"
            alt=""
            fill
            className="object-cover object-center"
            aria-hidden="true"
          />
        </div>

        {/* USER FOOTER */}
        {user && (
          <div className="relative z-10 border-t border-sidebar-border p-3">
            {collapsed ? (
              <Link href="/profile" className="flex justify-center" title="Profile">
                <span className="w-9 h-9 rounded-full bg-accent-primary/20 text-accent-primary text-xs font-bold flex items-center justify-center hover:bg-accent-primary/30 transition-colors">
                  {initials}
                </span>
              </Link>
            ) : (
              <div className="flex items-center gap-3">
                <Link href="/profile" title="Profile" className="shrink-0">
                  <span className="w-9 h-9 rounded-full bg-accent-primary/20 text-accent-primary text-xs font-bold flex items-center justify-center hover:bg-accent-primary/30 transition-colors">
                    {initials}
                  </span>
                </Link>
                <Link href="/profile" className="flex-1 min-w-0 hover:opacity-80 transition-opacity">
                  <div className="text-sm font-medium text-sidebar-text truncate">{user.username}</div>
                  <div className="text-[11px] text-sidebar-dim truncate">
                    {user.role === "admin" ? "Administrator" : "Maintainer"}
                  </div>
                </Link>
                <button
                  onClick={logout}
                  className="p-1.5 rounded-md text-sidebar-dim hover:text-sidebar-text hover:bg-white/10 transition-colors"
                  title="Sign out"
                >
                  <LogOut size={16} />
                </button>
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  )
}
