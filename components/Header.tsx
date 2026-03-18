"use client"

import { Menu } from "lucide-react"

export default function Header({
  setMobileOpen,
}: {
  collapsed?: boolean
  setCollapsed?: (v: boolean) => void
  setMobileOpen: (v: boolean) => void
}) {
  return (
    <header
      className="h-14 border-b border-app-border flex items-center px-4 md:px-6 lg:hidden"
      style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)" }}
    >
      <button
        onClick={() => setMobileOpen(true)}
        className="p-2 rounded-md hover:bg-app-surface-alt transition lg:hidden text-text-primary"
      >
        <Menu size={20} />
      </button>
    </header>
  )
}
