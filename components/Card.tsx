interface CardProps {
  title?: string
  children: React.ReactNode
  className?: string
  noPadding?: boolean
}

export default function Card({ title, children, className, noPadding }: CardProps) {
  return (
    <section
      className={`rounded-xl border border-app-border shadow-card ${
        noPadding ? "" : "p-4 sm:p-6"
      } ${className ?? ""}`}
      style={{
        background: "var(--color-card-bg)",
        backdropFilter: "blur(4px)",
        borderTop: "1px solid var(--color-card-border-top)",
      }}
    >
      {title && (
        <h2 className="section-heading text-base sm:text-lg font-semibold mb-4 sm:mb-6 text-accent-primary break-words">
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}
