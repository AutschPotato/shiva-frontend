import { useTheme } from "@/context/ThemeContext"

export function useChartColors() {
  const { theme } = useTheme()
  const dark = theme === "dark"
  return {
    grid: dark ? "rgba(255,255,255,0.08)" : "#E0E0E0",
    axis: dark ? "#6A5A64" : "#888888",
    tooltipBg: dark ? "#2a1a22" : "#FFFFFF",
    tooltipBorder: dark ? "rgba(255,255,255,0.1)" : "#E0E0E0",
    tooltipText: dark ? "#E8E0E3" : "#333333",
  }
}
