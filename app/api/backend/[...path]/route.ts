import { NextRequest } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CONTROLLER_URL = process.env.CONTROLLER_URL || "http://localhost:8080"
const CONTROLLER_KEY = process.env.CONTROLLER_API_KEY || ""
const FRONTEND_PROXY_PREFIX = "/api/backend"

function sanitizeSearch(searchParams: URLSearchParams): string {
  const forwarded = new URLSearchParams(searchParams)
  forwarded.delete("auth_token")
  const query = forwarded.toString()
  return query ? `?${query}` : ""
}

function rawPathFromURL(rawURL: string): string {
  const withoutOrigin = rawURL.replace(/^https?:\/\/[^/]+/i, "")
  const queryIndex = withoutOrigin.indexOf("?")
  return queryIndex >= 0 ? withoutOrigin.slice(0, queryIndex) : withoutOrigin
}

function resolveUpstreamUrl(rawURL: string, searchParams: URLSearchParams): string {
  const pathname = rawPathFromURL(rawURL)
  const backendPrefix = `${FRONTEND_PROXY_PREFIX}/`
  const resolvedPath = pathname.startsWith(backendPrefix)
    ? pathname.slice(FRONTEND_PROXY_PREFIX.length)
    : pathname
  return `${CONTROLLER_URL}${resolvedPath}${sanitizeSearch(searchParams)}`
}

function authTokenFromReferer(req: NextRequest): string {
  const referer = req.headers.get("referer")
  if (!referer) return ""

  try {
    const refererUrl = new URL(referer)
    return refererUrl.searchParams.get("auth_token") || ""
  } catch {
    return ""
  }
}

function forwardAuth(req: NextRequest): Record<string, string> {
  const incoming = req.headers
  const value = incoming.get("authorization")
  const queryToken = req.nextUrl.searchParams.get("auth_token")
  const refererToken = authTokenFromReferer(req)
  const resolved = value && value !== "Bearer undefined" && value !== "Bearer null"
    ? value
    : queryToken
      ? `Bearer ${queryToken}`
      : refererToken
        ? `Bearer ${refererToken}`
        : ""

  if (!resolved || resolved === "Bearer undefined" || resolved === "Bearer null") return {}
  return { Authorization: resolved, "X-Forwarded-Auth": resolved }
}

function buildOutgoingHeaders(req: NextRequest): Record<string, string> {
  const incoming = req.headers
  const outgoing: Record<string, string> = {
    "x-api-key": CONTROLLER_KEY,
    "accept-encoding": "identity",
    ...forwardAuth(req),
  }

  const ct = incoming.get("content-type")
  if (ct) outgoing["content-type"] = ct

  const accept = incoming.get("accept")
  if (accept) outgoing["accept"] = accept

  return outgoing
}

function buildProxyInit(req: NextRequest, outgoing: Record<string, string>): RequestInit {
  const hasBody = req.method !== "GET" && req.method !== "HEAD"
  const init: RequestInit = {
    method: req.method,
    headers: outgoing,
    body: hasBody ? req.body : undefined,
    cache: "no-store",
  }

  // Required for streaming request bodies in Node.js fetch
  if (hasBody && init.body) {
    ;(init as Record<string, unknown>).duplex = "half"
  }

  return init
}

function sanitizeResponseHeaders(headers: Headers): Headers {
  const responseHeaders = new Headers(headers)
  for (const h of ["connection", "transfer-encoding", "content-encoding", "content-length"]) {
    responseHeaders.delete(h)
  }
  return responseHeaders
}

function isDashboardUIRequest(rawURL: string): boolean {
  const pathname = rawPathFromURL(rawURL)
  return /\/api\/backend\/api\/admin\/workers\/[^/]+\/dashboard\/ui\/?$/i.test(pathname)
}

function rewriteDashboardHTML(rawURL: string, html: string): string {
  const pathname = rawPathFromURL(rawURL)
  const baseHref = pathname.endsWith("/") ? pathname : `${pathname}/`
  if (html.includes("<base ")) {
    return html
  }
  return html.replace("<head>", `<head>\n    <base href="${baseHref}" />`)
}

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  await ctx.params
  const upstream = resolveUpstreamUrl(req.url, req.nextUrl.searchParams)
  const outgoing = buildOutgoingHeaders(req)
  const init = buildProxyInit(req, outgoing)

  let upstream_res: Response
  try {
    upstream_res = await fetch(upstream, init)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return new Response(`Upstream unreachable: ${detail}`, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  }

  const responseHeaders = sanitizeResponseHeaders(upstream_res.headers)
  const contentType = upstream_res.headers.get("content-type") || ""
  if (contentType.includes("text/html") && isDashboardUIRequest(req.url)) {
    const html = await upstream_res.text()
    return new Response(rewriteDashboardHTML(req.url, html), {
      status: upstream_res.status,
      headers: responseHeaders,
    })
  }

  return new Response(upstream_res.body, {
    status: upstream_res.status,
    headers: responseHeaders,
  })
}

export const GET = forward
export const POST = forward
export const PUT = forward
export const PATCH = forward
export const DELETE = forward
