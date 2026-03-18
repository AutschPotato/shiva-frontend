"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts"
import Card from "./Card"
import { useChartColors } from "@/lib/chart-theme"

interface ChartCardProps {
  title: string
  data: Record<string, number | number[]> | null | undefined
  color?: string
}

function normalizeEntry(value: unknown): number {
  if (typeof value === "number") return value
  if (Array.isArray(value) && value.length > 0) {
    return value.reduce((sum: number, v: number) => sum + v, 0) / value.length
  }
  return 0
}

export default function ChartCard({ title, data, color = "#E20074" }: ChartCardProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  const chart = useChartColors()

  useEffect(() => {
    if (!wrapperRef.current) return
    const ro = new ResizeObserver(() => setMounted(true))
    ro.observe(wrapperRef.current)
    return () => ro.disconnect()
  }, [])

  const chartData = useMemo(() => {
    if (!data) return []
    return Object.entries(data).map(([key, val]) => ({
      label: key,
      metric: normalizeEntry(val),
    }))
  }, [data])

  if (!chartData.length) return null

  return (
    <Card title={title}>
      <div ref={wrapperRef} className="w-full h-64" style={{ minHeight: 256 }}>
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 6" stroke={chart.grid} />
              <XAxis dataKey="label" hide />
              <YAxis stroke={chart.axis} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: chart.tooltipBg,
                  border: `1px solid ${chart.tooltipBorder}`,
                  borderRadius: 6,
                  fontSize: 12,
                  color: chart.tooltipText,
                }}
              />
              <Line
                type="monotone"
                dataKey="metric"
                stroke={color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: color }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-text-muted">
            Preparing chart...
          </div>
        )}
      </div>
    </Card>
  )
}
