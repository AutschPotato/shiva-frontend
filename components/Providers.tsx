"use client"

import { SessionProvider } from "@/context/SessionContext"
import { ThemeProvider } from "@/context/ThemeContext"

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SessionProvider>{children}</SessionProvider>
    </ThemeProvider>
  )
}
