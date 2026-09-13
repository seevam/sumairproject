import { useContext } from 'react'
import { AuthContext, type AuthState } from './context'

/**
 * Single read point for auth across the app.
 *
 * Deliberately does not import Clerk: that keeps the SDK out of the main
 * bundle, so a guest-only deployment never downloads or executes third-party
 * auth code at all.
 */
export function useAuthState(): AuthState {
  return useContext(AuthContext)
}

export type { AuthState }
