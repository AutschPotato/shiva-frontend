"use client"

import { type ReactNode, useEffect, useRef } from "react"
import { X } from "lucide-react"

interface ModalProps {
  children: ReactNode
  onClose: () => void
  title?: string
  wide?: boolean
}

export default function Modal({ children, onClose, title, wide }: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null)

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose])

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`relative bg-white border border-app-border shadow-lg rounded-lg p-6 w-full ${
          wide ? "max-w-2xl" : "max-w-lg"
        }`}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-app-surface transition-colors"
        >
          <X size={18} />
        </button>

        {title && (
          <h2 className="text-xl font-semibold mb-4 text-accent-primary pr-8">
            {title}
          </h2>
        )}

        {children}
      </div>
    </div>
  )
}
