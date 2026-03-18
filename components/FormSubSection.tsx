import type { ReactNode } from "react"

type FormSubSectionProps = {
  children: ReactNode
  className?: string
}

type FormSubSectionTitleProps = {
  title: string
  description?: string
  aside?: ReactNode
}

type FormSubSectionContentProps = {
  children: ReactNode
  className?: string
}

function joinClasses(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ")
}

export function FormSubSection({ children, className }: FormSubSectionProps) {
  return (
    <section
      className={joinClasses(
        "ml-4 rounded-lg border border-app-border bg-app-surface p-4",
        className,
      )}
    >
      {children}
    </section>
  )
}

export function FormSubSectionTitle({ title, description, aside }: FormSubSectionTitleProps) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {description && <p className="mt-1 text-xs text-text-muted">{description}</p>}
      </div>
      {aside}
    </div>
  )
}

export function FormSubSectionContent({ children, className }: FormSubSectionContentProps) {
  return <div className={joinClasses("space-y-4", className)}>{children}</div>
}
