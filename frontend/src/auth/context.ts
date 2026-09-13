import { createContext } from 'react'

export interface AuthState {
  /** False when the build has no Clerk key: the app is guest-only. */
  available: boolean
  /** Clerk has finished booting (always true in guest-only mode). */
  ready: boolean
  signedIn: boolean
  email: string | null
  userId: string | null
  /** Fetches a bearer token for the backend, or null when signed out. */
  getToken: () => Promise<string | null>
  signOut: () => Promise<void>
}

/**
 * Guest is the default state, not an error state. A build with no Clerk key
 * never leaves this value, and nothing in the app needs to special-case it.
 */
export const GUEST: AuthState = {
  available: false,
  ready: true,
  signedIn: false,
  email: null,
  userId: null,
  getToken: async () => null,
  signOut: async () => undefined,
}

export const AuthContext = createContext<AuthState>(GUEST)
