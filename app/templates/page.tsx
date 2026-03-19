"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "@/context/SessionContext"
import {
  AuthConfigSection,
  createDefaultAuthInput,
  hydrateAuthInput,
  validateAuthInput,
} from "@/components/AuthConfigSection"
import {
  deleteTemplate,
  demoteTemplateFromSystem,
  exportSystemTemplates,
  exportTemplate,
  importSystemTemplates,
  listTemplates,
  promoteTemplateToSystem,
  updateTemplate,
  type Template,
  type TemplatePayload,
} from "@/lib/api"
import { motion } from "framer-motion"
import { staggerContainer, revealItem } from "@/lib/motion-variants"

interface Stage {
  duration: string
  target: number
}

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

const VALID_HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"]

function methodAllowsPayload(method: HttpMethod) {
  return method !== "GET"
}

function systemBadgeClass() {
  return "status-badge status-badge--info px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
}

function modeBadgeClass(mode: Template["mode"]) {
  return mode === "builder"
    ? "status-badge status-badge--info px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
    : "status-badge status-badge--neutral px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
}

function executorBadgeClass() {
  return "status-badge status-badge--neutral px-2 py-0.5 text-[10px] font-medium font-mono"
}

function artifactBadgeClass(kind: "script" | "config") {
  return kind === "script"
    ? "status-badge status-badge--warning px-1.5 py-0.5 text-[10px] font-medium"
    : "status-badge status-badge--info px-1.5 py-0.5 text-[10px] font-medium"
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function TemplatesPage() {
  const router = useRouter()
  const { user, token, initialized: ready } = useSession()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<TemplatePayload>({ name: "", description: "", mode: "builder" })
  const [editStages, setEditStages] = useState<Stage[]>([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [templateActionId, setTemplateActionId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [editPayloadFileName, setEditPayloadFileName] = useState("")
  const editPayloadInputRef = useRef<HTMLInputElement | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const isAdmin = user?.role === "admin"
  const systemTemplates = useMemo(() => templates.filter((t) => t.system), [templates])
  const personalTemplates = useMemo(() => templates.filter((t) => !t.system), [templates])
  const personalTemplateLabel = isAdmin ? "User Templates" : "My Templates"

  const currentEditMethod = ((editForm.http_method as HttpMethod | undefined) || "GET")
  const editPayloadEnabled = methodAllowsPayload(currentEditMethod)
  const editAuthValue = useMemo(
    () => editForm.auth ? { ...createDefaultAuthInput(), ...editForm.auth } : createDefaultAuthInput(),
    [editForm.auth],
  )
  const editPayloadError = (() => {
    if (!editPayloadEnabled || !editForm.payload_json?.trim()) return null
    try {
      JSON.parse(editForm.payload_json)
      return null
    } catch {
      return "Payload JSON must be valid JSON"
    }
  })()
  const editAuthError = useMemo(() => {
    if (editForm.mode !== "builder") return null
    return validateAuthInput(editAuthValue, {
      requireSecret: !!editAuthValue.auth_persist_secret && !editAuthValue.auth_secret_configured,
    })
  }, [editAuthValue, editForm.mode])

  useEffect(() => {
    if (ready && !user) router.replace("/login")
  }, [ready, user, router])

  const loadTemplates = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await listTemplates(token)
      setTemplates(res.templates ?? [])
    } catch {
      setToast({ type: "error", message: "Failed to load templates" })
    } finally {
      setLoading(false)
    }
  }, [token])
  useEffect(() => {
    if (!token) return
    const timer = setTimeout(() => {
      void loadTemplates()
    }, 0)
    return () => clearTimeout(timer)
  }, [token, loadTemplates])

  const handleDelete = async (id: string) => {
    if (!token) return
    try {
      await deleteTemplate(id, token)
      setTemplates((prev) => prev.filter((t) => t.id !== id))
      setDeleteConfirm(null)
      setToast({ type: "success", message: "Template deleted" })
    } catch {
      setToast({ type: "error", message: "Failed to delete template" })
    }
  }

  const handlePromote = async (template: Template) => {
    if (!token) return
    setTemplateActionId(template.id)
    try {
      const updated = await promoteTemplateToSystem(template.id, token)
      setTemplates((prev) => prev.map((t) => (t.id === template.id ? updated : t)))
      setToast({ type: "success", message: `"${template.name}" is now a system template` })
    } catch {
      setToast({ type: "error", message: "Failed to promote template" })
    }
    setTemplateActionId(null)
  }

  const handleDemote = async (template: Template) => {
    if (!token) return
    setTemplateActionId(template.id)
    try {
      const updated = await demoteTemplateFromSystem(template.id, token)
      setTemplates((prev) => prev.map((t) => (t.id === template.id ? updated : t)))
      setToast({ type: "success", message: `"${template.name}" moved back to the regular templates` })
    } catch {
      setToast({ type: "error", message: "Failed to demote system template" })
    }
    setTemplateActionId(null)
  }

  const handleExportTemplate = async (template: Template) => {
    if (!token) return
    setTemplateActionId(template.id)
    try {
      const payload = await exportTemplate(template.id, token)
      downloadJson(`${template.name.replace(/[^a-z0-9-_]+/gi, "_").toLowerCase() || "system-template"}.json`, payload)
      setToast({ type: "success", message: "System template exported" })
    } catch {
      setToast({ type: "error", message: "Failed to export system template" })
    }
    setTemplateActionId(null)
  }

  const handleExportAllSystemTemplates = async () => {
    if (!token) return
    setTemplateActionId("__export_all__")
    try {
      const payload = await exportSystemTemplates(token)
      downloadJson("system-templates.json", payload)
      setToast({ type: "success", message: "System templates exported" })
    } catch {
      setToast({ type: "error", message: "Failed to export system templates" })
    }
    setTemplateActionId(null)
  }

  const handleImportTemplates = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !token) return

    setImporting(true)
    try {
      const text = await file.text()
      const payload = JSON.parse(text)
      const res = await importSystemTemplates(payload, token)
      setTemplates((prev) => [...(res.templates ?? []), ...prev])
      setToast({ type: "success", message: `${res.total ?? 0} system template(s) imported` })
    } catch {
      setToast({ type: "error", message: "Failed to import system templates" })
    }
    if (importInputRef.current) {
      importInputRef.current.value = ""
    }
    setImporting(false)
  }

  const startEdit = (t: Template) => {
    setEditId(t.id)
    setEditPayloadFileName("")
    setEditForm({
      name: t.name,
      description: t.description,
      mode: t.mode,
      url: t.url,
      stages: t.stages,
      script_content: t.script_content,
      config_content: t.config_content,
      http_method: t.http_method,
      content_type: t.content_type,
      payload_json: t.payload_json,
      payload_target_kib: t.payload_target_kib,
      auth: hydrateAuthInput(t.auth),
    })
    setEditStages(t.stages && t.stages.length > 0 ? [...t.stages] : [{ duration: "", target: 0 }])
  }

  const handleSave = async () => {
    if (!token || !editId) return
    if (editPayloadError) {
      setToast({ type: "error", message: editPayloadError })
      return
    }
    if (editAuthError) {
      setToast({ type: "error", message: editAuthError })
      return
    }
    setSaving(true)
    try {
      const payload: TemplatePayload = {
        ...editForm,
        auth: editForm.mode === "builder" ? editAuthValue : undefined,
        stages: editForm.mode === "builder" ? editStages : editForm.stages,
      }
      const updated = await updateTemplate(editId, payload, token)
      setTemplates((prev) => prev.map((t) => (t.id === editId ? updated : t)))
      setEditId(null)
      setToast({ type: "success", message: "Template saved" })
    } catch {
      setToast({ type: "error", message: "Failed to save template" })
    }
    setSaving(false)
  }

  const handleEditPayloadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    if (!file) {
      setEditPayloadFileName("")
      return
    }

    setEditPayloadFileName(file.name)
    const reader = new FileReader()
    reader.onload = (event) => {
      setEditForm((prev) => ({ ...prev, payload_json: (event.target?.result as string) || "" }))
    }
    reader.onerror = () => {
      setEditPayloadFileName("")
      setToast({ type: "error", message: "Failed to read payload file" })
    }
    reader.readAsText(file)
  }

  const handleUseTemplate = (t: Template) => {
    const cloneData: Record<string, unknown> = { mode: t.mode }
    if (t.script_content) cloneData.script_content = t.script_content
    if (t.config_content) cloneData.config_content = t.config_content
    if (t.url) cloneData.url = t.url
    if (t.executor) cloneData.executor = t.executor
    if (t.http_method) cloneData.http_method = t.http_method
    if (t.content_type) cloneData.content_type = t.content_type
    if (t.payload_json) cloneData.payload_json = t.payload_json
    if (t.payload_target_kib) cloneData.payload_target_kib = t.payload_target_kib
    if (t.auth?.auth_enabled) cloneData.auth = t.auth
    if (t.stages) cloneData.stages = t.stages
    localStorage.setItem("k6-clone-test", JSON.stringify(cloneData))
    router.push("/load-test?clone=true")
  }

  const handleScheduleTemplate = (t: Template) => {
    const schedData: Record<string, unknown> = {
      name: t.name,
      project_name: t.name,
    }
    if (t.script_content) schedData.script_content = t.script_content
    if (t.config_content) schedData.config_content = t.config_content
    if (t.url) schedData.url = t.url
    if (t.mode) schedData.mode = t.mode
    if (t.executor) schedData.executor = t.executor
    if (t.stages) schedData.stages = t.stages
    if (t.http_method) schedData.http_method = t.http_method
    if (t.content_type) schedData.content_type = t.content_type
    if (t.payload_json) schedData.payload_json = t.payload_json
    if (t.payload_target_kib) schedData.payload_target_kib = t.payload_target_kib
    if (t.auth?.auth_enabled) schedData.auth = t.auth
    localStorage.setItem("k6-schedule-test", JSON.stringify(schedData))
    router.push("/schedule/new?schedule=true")
  }

  if (!ready || !user) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="text-sm text-text-muted">Loading...</div>
      </div>
    )
  }

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="enter" className="space-y-6">
      {/* Toast */}
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleImportTemplates}
      />

      {/* Header */}
      <motion.div variants={revealItem} className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary section-heading">Templates</h1>
          <p className="text-text-muted text-sm mt-1">Save and reuse test configurations</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
                className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
              >
                {importing ? "Importing..." : "Import System Templates"}
              </button>
              <button
                type="button"
                onClick={handleExportAllSystemTemplates}
                disabled={templateActionId === "__export_all__" || systemTemplates.length === 0}
                className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
              >
                Export System Templates
              </button>
            </>
          )}
          <div className="text-sm text-text-muted">{templates.length} template{templates.length !== 1 ? "s" : ""}</div>
        </div>
      </motion.div>

      {loading ? (
        <motion.div variants={revealItem} className="text-sm text-text-muted py-12 text-center">Loading templates...</motion.div>
      ) : templates.length === 0 ? (
        <motion.div
          variants={revealItem}
          className="border border-app-border rounded-xl p-12 text-center"
          style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)", borderTop: "1px solid var(--color-card-border-top)" }}
        >
          <div className="text-text-muted text-sm mb-4">No templates yet.</div>
          <p className="text-text-muted text-xs">
            Create templates from the Run Test page or from test results.
          </p>
        </motion.div>
      ) : (
        <div className="space-y-4">
          {/* Section header for system templates */}
          {systemTemplates.length > 0 && (
            <motion.div variants={revealItem} className="flex items-center gap-3">
              <h2 className="section-heading text-sm font-semibold text-text-muted uppercase tracking-wider">System Templates</h2>
              <div className="flex-1 border-t border-app-border" />
            </motion.div>
          )}
          {systemTemplates.map((t) => (
            <motion.div
              key={t.id}
              variants={revealItem}
              className="border border-accent-primary/15 dark:border-accent-primary/20 rounded-xl shadow-card"
              style={{ background: "rgba(226, 0, 116, 0.04)", backdropFilter: "blur(4px)" }}
            >
              <div className="p-5">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-text-primary truncate">{t.name}</h3>
                      <span className={systemBadgeClass()}>
                        System
                      </span>
                      {t.executor && (
                        <span className={executorBadgeClass()}>
                          {t.executor}
                        </span>
                      )}
                      {t.http_method && (
                        <span className="status-badge status-badge--info px-2 py-0.5 text-[10px] font-mono">
                          {t.http_method}
                        </span>
                      )}
                      {t.auth?.auth_enabled && (
                        <span className="status-badge status-badge--info px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                          Auth
                        </span>
                      )}
                      {t.auth?.auth_secret_configured && (
                        <span className="status-badge status-badge--neutral px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                          Secret stored
                        </span>
                      )}
                    </div>
                    {t.description && (
                      <p className="text-text-primary/70 dark:text-text-primary/60 text-sm mb-2">{t.description}</p>
                    )}
                    <div className="flex flex-wrap gap-3 text-xs text-text-primary/60 dark:text-text-primary/50">
                      {t.script_content && (
                        <span className={artifactBadgeClass("script")}>
                          Script ({(t.script_content.length / 1024).toFixed(1)} KB)
                        </span>
                      )}
                      {t.payload_json && (
                        <span className="status-badge status-badge--warning px-1.5 py-0.5 text-[10px] font-medium">
                          Payload ({(t.payload_json.length / 1024).toFixed(1)} KB)
                        </span>
                      )}
                      {t.config_content && (
                        <span className={artifactBadgeClass("config")}>
                          Config
                        </span>
                      )}
                      <span>by {t.username}</span>
                      <span>{new Date(t.updated_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                    {deleteConfirm === t.id ? (
                      <div className="flex flex-col items-end gap-2">
                        <p className="max-w-md text-xs text-text-muted text-right">
                          You are deleting a system template. Consider exporting it first if you may want to restore it later.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleExportTemplate(t)}
                            disabled={templateActionId === t.id}
                            className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
                          >
                            Export JSON
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleDelete(t.id)}
                            className="px-4 py-2 text-sm font-medium rounded-md border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-900/20 transition disabled:opacity-50"
                          >
                            Confirm Delete
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => handleExportTemplate(t)}
                              disabled={templateActionId === t.id}
                              className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
                            >
                              Export JSON
                            </button>
                            <button
                              onClick={() => handleDemote(t)}
                              disabled={templateActionId === t.id}
                              className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
                            >
                              Remove System Flag
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(t.id)}
                              className="px-4 py-2 text-sm font-medium rounded-md border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-900/20 transition disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleUseTemplate(t)}
                          className="px-4 py-2 text-sm font-medium rounded-md bg-accent-primary text-white hover:bg-pink-700 transition disabled:opacity-50"
                        >
                          Use Template
                        </button>
                        <button
                          onClick={() => handleScheduleTemplate(t)}
                          className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition"
                        >
                          Schedule
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}

          {/* Section header for user templates */}
          {personalTemplates.length > 0 && (
            <motion.div variants={revealItem} className="flex items-center gap-3 mt-6">
              <h2 className="section-heading text-sm font-semibold text-text-muted uppercase tracking-wider">{personalTemplateLabel}</h2>
              <div className="flex-1 border-t border-app-border" />
            </motion.div>
          )}
          {personalTemplates.map((t) => (
            <motion.div
              key={t.id}
              variants={revealItem}
              className="border border-app-border rounded-xl shadow-card"
              style={{ background: "var(--color-card-bg)", backdropFilter: "blur(4px)", borderTop: "1px solid var(--color-card-border-top)" }}
            >
              {editId === t.id ? (
                /* ===== EDIT MODE ===== */
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Name</label>
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Description</label>
                    <textarea
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      rows={2}
                      className="w-full border border-app-border rounded-md px-3 py-2 text-sm"
                    />
                  </div>

                  {editForm.mode === "builder" && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-1">Target URL</label>
                        <input
                          value={editForm.url || ""}
                          onChange={(e) => setEditForm({ ...editForm, url: e.target.value })}
                          className="w-full"
                        />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-text-muted mb-1">HTTP Method</label>
                          <select
                            value={(editForm.http_method as HttpMethod | undefined) || "GET"}
                            onChange={(e) => setEditForm({ ...editForm, http_method: e.target.value as HttpMethod })}
                            className="w-full border border-app-border rounded-md px-3 py-2 text-sm"
                          >
                            {VALID_HTTP_METHODS.map((method) => (
                              <option key={method} value={method}>{method}</option>
                            ))}
                          </select>
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-xs font-medium text-text-muted mb-1">Content-Type</label>
                          <input
                            value={editForm.content_type || "application/json"}
                            onChange={(e) => setEditForm({ ...editForm, content_type: e.target.value })}
                            disabled={!methodAllowsPayload(((editForm.http_method as HttpMethod | undefined) || "GET"))}
                            className="w-full disabled:opacity-60"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-[2fr,1fr] gap-3">
                        <div>
                          <label className="block text-xs font-medium text-text-muted mb-1">Payload JSON</label>
                          <input
                            ref={editPayloadInputRef}
                            type="file"
                            accept=".json,application/json"
                            className="hidden"
                            onChange={handleEditPayloadFile}
                          />
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => editPayloadInputRef.current?.click()}
                              disabled={!editPayloadEnabled}
                              className="px-3 py-1.5 text-xs font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-60"
                            >
                              Upload payload.json
                            </button>
                            {editPayloadFileName && (
                              <span className="inline-flex items-center gap-2 rounded-md border border-app-border px-2 py-1 text-[11px] text-text-muted">
                                <span className="font-medium text-text-primary">{editPayloadFileName}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditPayloadFileName("")
                                    setEditForm((prev) => ({ ...prev, payload_json: "" }))
                                    if (editPayloadInputRef.current) editPayloadInputRef.current.value = ""
                                  }}
                                  className="text-red-500 hover:text-red-600"
                                >
                                  Clear
                                </button>
                              </span>
                            )}
                          </div>
                          <textarea
                            value={editForm.payload_json || ""}
                            onChange={(e) => {
                              setEditForm({ ...editForm, payload_json: e.target.value })
                              if (editPayloadFileName) setEditPayloadFileName("")
                            }}
                            disabled={!editPayloadEnabled}
                            rows={5}
                            className={`w-full border rounded-md px-3 py-2 text-xs font-mono disabled:opacity-60 ${
                              editPayloadError ? "border-red-500" : "border-app-border"
                            }`}
                          />
                          {editPayloadEnabled && (
                            <p className="mt-2 text-[11px] text-text-muted">
                              Paste JSON directly or load a `.json` payload file.
                            </p>
                          )}
                          {editPayloadError && (
                            <p className="mt-2 text-xs text-red-500">{editPayloadError}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-muted mb-1">Target Size (KiB)</label>
                          <input
                            type="number"
                            min="0"
                            value={editForm.payload_target_kib || 0}
                            onChange={(e) => setEditForm({ ...editForm, payload_target_kib: Number(e.target.value) || 0 })}
                            disabled={!methodAllowsPayload(((editForm.http_method as HttpMethod | undefined) || "GET"))}
                            className="w-full disabled:opacity-60"
                          />
                        </div>
                      </div>
                      <AuthConfigSection
                        value={editAuthValue}
                        onChange={(auth) => setEditForm({ ...editForm, auth })}
                        mode="template"
                      />
                      {editAuthError && (
                        <p className="text-xs text-red-500">{editAuthError}</p>
                      )}
                      <div>
                        <label className="block text-xs font-medium text-text-muted mb-2">Stages</label>
                        {editStages.map((stage, i) => (
                          <div key={i} className="flex gap-3 mb-2 items-center">
                            <input
                              value={stage.duration}
                              placeholder="Duration (30s, 1m)"
                              onChange={(e) => {
                                const updated = [...editStages]
                                updated[i].duration = e.target.value
                                setEditStages(updated)
                              }}
                              className="w-1/2"
                            />
                            <input
                              type="number"
                              value={stage.target || ""}
                              placeholder="Target VUs"
                              onChange={(e) => {
                                const updated = [...editStages]
                                updated[i].target = Number(e.target.value)
                                setEditStages(updated)
                              }}
                              className="w-1/2"
                            />
                            {editStages.length > 1 && (
                              <button
                                onClick={() => setEditStages(editStages.filter((_, idx) => idx !== i))}
                                className="text-red-500 text-lg px-2"
                              >
                                x
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          onClick={() => setEditStages([...editStages, { duration: "", target: 0 }])}
                          className="text-accent-primary text-xs hover:underline"
                        >
                          + Add Stage
                        </button>
                      </div>
                    </>
                  )}

                  {editForm.mode === "upload" && editForm.script_content && (
                    <div>
                      <label className="block text-xs font-medium text-text-muted mb-1">Script Preview</label>
                      <pre className="border border-app-border bg-app-surface text-text-primary font-mono text-xs p-3 rounded-md overflow-auto max-h-40">
                        {editForm.script_content.slice(0, 2000)}
                        {editForm.script_content.length > 2000 && "\n..."}
                      </pre>
                    </div>
                  )}

                  {editForm.config_content && (
                    <div>
                      <label className="block text-xs font-medium text-text-muted mb-1">Config JSON</label>
                      <textarea
                        value={(() => {
                          try { return JSON.stringify(JSON.parse(editForm.config_content), null, 2) }
                          catch { return editForm.config_content }
                        })()}
                        onChange={(e) => setEditForm({ ...editForm, config_content: e.target.value })}
                        rows={4}
                        className="w-full border border-app-border rounded-md px-3 py-2 text-xs font-mono"
                      />
                    </div>
                  )}

                  <div className="flex gap-2 pt-2 justify-end">
                    <button
                      onClick={() => setEditId(null)}
                      className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving || !editForm.name.trim()}
                      className="px-4 py-2 text-sm font-medium rounded-md bg-accent-primary text-white hover:bg-pink-700 transition disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                /* ===== VIEW MODE ===== */
                <div className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-semibold text-text-primary truncate">{t.name}</h3>
                        {t.system && (
                          <span className={systemBadgeClass()}>
                            System
                          </span>
                        )}
                        <span className={modeBadgeClass(t.mode)}>
                          {t.mode}
                        </span>
                        {t.executor && (
                          <span className={executorBadgeClass()}>
                            {t.executor}
                          </span>
                        )}
                        {t.http_method && (
                          <span className="status-badge status-badge--info px-2 py-0.5 text-[10px] font-mono">
                            {t.http_method}
                          </span>
                        )}
                        {t.auth?.auth_enabled && (
                          <span className="status-badge status-badge--info px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                            Auth
                          </span>
                        )}
                        {t.auth?.auth_secret_configured && (
                          <span className="status-badge status-badge--neutral px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                            Secret stored
                          </span>
                        )}
                      </div>
                      {t.description && (
                        <p className="text-text-muted text-sm mb-2">{t.description}</p>
                      )}
                      <div className="flex flex-wrap gap-3 text-xs text-text-muted">
                        {t.url && <span className="font-mono truncate max-w-[300px]">{t.url}</span>}
                        {t.stages && t.stages.length > 0 && (
                          <span>
                            {t.stages.map((s, i) => (
                              <span key={i}>
                                {i > 0 && " \u2192 "}
                                {s.duration}/{s.target}VUs
                              </span>
                            ))}
                          </span>
                        )}
                        {t.script_content && (
                          <span className={artifactBadgeClass("script")}>
                            Script ({(t.script_content.length / 1024).toFixed(1)} KB)
                          </span>
                        )}
                        {t.payload_json && (
                          <span className="status-badge status-badge--warning px-1.5 py-0.5 text-[10px] font-medium">
                            Payload ({(t.payload_json.length / 1024).toFixed(1)} KB)
                          </span>
                        )}
                        {t.config_content && (
                          <span className={artifactBadgeClass("config")}>
                            Config
                          </span>
                        )}
                        <span>by {t.username}</span>
                        <span>{new Date(t.updated_at).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="flex gap-2 shrink-0">
                      {deleteConfirm === t.id ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleDelete(t.id)}
                            className="px-4 py-2 text-sm font-medium rounded-md border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-900/20 transition disabled:opacity-50"
                          >
                            Confirm Delete
                          </button>
                        </div>
                      ) : (
                        <>
                          <>
                            {isAdmin && (
                              <button
                                onClick={() => handlePromote(t)}
                                disabled={templateActionId === t.id}
                                className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
                              >
                                Make System
                              </button>
                            )}
                            <>
                              <button
                                onClick={() => setDeleteConfirm(t.id)}
                                className="px-4 py-2 text-sm font-medium rounded-md border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-900/20 transition disabled:opacity-50"
                              >
                                Delete
                              </button>
                              <button
                                onClick={() => startEdit(t)}
                                className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition disabled:opacity-50"
                              >
                                Edit
                              </button>
                            </>
                          </>
                          <button
                            onClick={() => handleUseTemplate(t)}
                            className="px-4 py-2 text-sm font-medium rounded-md bg-accent-primary text-white hover:bg-pink-700 transition disabled:opacity-50"
                          >
                            Use Template
                          </button>
                          <button
                            onClick={() => handleScheduleTemplate(t)}
                            className="px-4 py-2 text-sm font-medium rounded-md border border-app-border text-text-muted hover:bg-app-surface-alt transition"
                          >
                            Schedule
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  )
}

/* Toast with auto-dismiss */
function Toast({ type, message, onClose }: { type: "success" | "error"; message: string; onClose: () => void }) {
  useEffect(() => {
    const timeout = type === "error" ? 8000 : 4000
    const timer = setTimeout(onClose, timeout)
    return () => clearTimeout(timer)
  }, [type, message, onClose])

  return (
    <div
      className={`fixed top-6 right-6 max-w-md px-5 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-in z-[60] cursor-pointer ${
        type === "error" ? "bg-red-500 text-white" : "bg-green-600 text-white"
      }`}
      onClick={onClose}
    >
      {message}
    </div>
  )
}


