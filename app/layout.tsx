import "./global.css"
import type { Viewport, Metadata } from "next"
import Providers from "@/components/Providers"
import AppShell from "@/components/AppShell"

export const metadata: Metadata = {
  title: "Shiva — Now I am become Death, the destroyer of worlds",
  description: "Distributed load testing platform with multi-worker orchestration",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  )
}
