"use client"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body style={{ fontFamily: "monospace", padding: "2rem", background: "#fff", color: "#333" }}>
        <h1 style={{ color: "red" }}>Client Error</h1>
        <pre style={{ whiteSpace: "pre-wrap", background: "#f5f5f5", padding: "1rem", borderRadius: "8px" }}>
          {error.message}
        </pre>
        <pre style={{ whiteSpace: "pre-wrap", background: "#f5f5f5", padding: "1rem", borderRadius: "8px", fontSize: "0.8rem" }}>
          {error.stack}
        </pre>
        <button onClick={reset} style={{ marginTop: "1rem", padding: "0.5rem 1rem", cursor: "pointer" }}>
          Retry
        </button>
      </body>
    </html>
  )
}
