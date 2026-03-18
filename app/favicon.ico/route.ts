import { NextRequest } from "next/server"

export const runtime = "nodejs"

export function GET(req: NextRequest) {
  // Use a relative redirect so the browser stays on the same origin.
  // (Absolute redirects inside containers can point to non-resolvable hostnames.)
  return new Response(null, {
    status: 307,
    headers: {
      location: "/icon.svg",
    },
  })
}
