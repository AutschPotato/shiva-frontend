"use client"

interface MetricRow {
  label: string
  value: string | number
}

function fmt(v: unknown, suffix = ""): string {
  if (v === undefined || v === null) return "N/A"
  if (typeof v === "number") return `${v.toFixed(2)}${suffix}`
  return String(v)
}

export default function ResultTable({ metrics }: { metrics: any }) {
  if (!metrics) return null

  const duration = metrics.http_req_duration ?? {}
  const reqs = metrics.http_reqs ?? {}
  const checks = metrics.checks ?? {}

  const rows: MetricRow[] = [
    { label: "Avg Latency (ms)", value: fmt(duration.avg) },
    { label: "P95 Latency (ms)", value: fmt(duration["p(95)"]) },
    { label: "P99 Latency (ms)", value: fmt(duration["p(99)"]) },
    { label: "Total Requests", value: reqs.count ?? "N/A" },
    {
      label: "Error Rate",
      value:
        checks.error_rate !== undefined
          ? `${(checks.error_rate * 100).toFixed(2)}%`
          : "N/A",
    },
  ]

  return (
    <section className="bg-white rounded-lg border border-app-border shadow-card p-4 sm:p-6">
      <h3 className="text-lg font-semibold mb-4 text-accent-primary">
        Performance Metrics
      </h3>

      <div className="overflow-x-auto -mx-4 sm:-mx-6">
        <table className="w-full text-sm min-w-[320px]">
          <thead>
            <tr className="border-b border-app-border text-left">
              <th className="py-2 px-4 sm:px-6 font-medium text-text-muted text-xs uppercase tracking-wide">
                Metric
              </th>
              <th className="py-2 px-4 sm:px-6 font-medium text-text-muted text-xs uppercase tracking-wide">
                Value
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="py-3 px-4 sm:px-6 font-medium text-text-primary">
                  {row.label}
                </td>
                <td className="py-3 px-4 sm:px-6 text-text-muted tabular-nums">
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
