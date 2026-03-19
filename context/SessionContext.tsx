"use client"

import { useRouter } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { authenticate, type Credentials } from "@/lib/api"
import type { UserProfile } from "@/types/user"

const PERSIST_KEY = "ent-session"

interface SessionState {
  user: UserProfile | null
  token: string | null
  initialized: boolean
}

interface SessionActions {
  signIn: (credentials: Credentials) => Promise<UserProfile>
  signOut: () => void
  updateUser: (user: UserProfile) => void
}

type SessionContextValue = SessionState & SessionActions & { isAdmin: boolean }

const Ctx = createContext<SessionContextValue | null>(null)

type PersistedSession = { user: UserProfile; token: string }

function parsePersistedSession(raw: string | null): PersistedSession | null {
  if (!raw) return null
  const parsed = JSON.parse(raw)
  if (parsed?.user && parsed?.token) return parsed
  return null
}

function loadPersistedSession(): PersistedSession | null {
  if (typeof window === "undefined") return null
  try {
    return parsePersistedSession(window.localStorage.getItem(PERSIST_KEY))
  } catch {
    return null
  }
}

function persistSession(session: PersistedSession | null) {
  if (typeof window === "undefined") return
  if (session) {
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(session))
  } else {
    window.localStorage.removeItem(PERSIST_KEY)
  }
}

function applySessionState(
  session: PersistedSession | null,
  setUser: (user: UserProfile | null) => void,
  setToken: (token: string | null) => void,
) {
  setUser(session?.user ?? null)
  setToken(session?.token ?? null)
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const persisted = loadPersistedSession()
    applySessionState(persisted, setUser, setToken)
    setInitialized(true)
  }, [])

  const signIn = useCallback(async (credentials: Credentials) => {
    const response = await authenticate(credentials)
    const session = { user: response.user, token: response.token }
    applySessionState(session, setUser, setToken)
    persistSession(session)
    setInitialized(true)
    return response.user
  }, [])

  const signOut = useCallback(() => {
    applySessionState(null, setUser, setToken)
    persistSession(null)
    setInitialized(true)
    router.push("/login")
  }, [router])

  const updateUser = useCallback((nextUser: UserProfile) => {
    setUser((currentUser) => {
      const resolvedToken = token ?? loadPersistedSession()?.token ?? null
      if (resolvedToken) {
        persistSession({ user: nextUser, token: resolvedToken })
      }
      return nextUser
    })
  }, [token])

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      token,
      initialized,
      isAdmin: user?.role === "admin",
      signIn,
      signOut,
      updateUser,
    }),
    [user, token, initialized, signIn, signOut, updateUser],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error("useSession requires a <SessionProvider> ancestor")
  }
  return ctx
}
