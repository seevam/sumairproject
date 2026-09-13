import type { ReactNode } from 'react'
import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-react'
import { AuthContext, type AuthState } from './context'
import { CLERK_PUBLISHABLE_KEY } from './config'

/**
 * The only module that imports Clerk. Loaded lazily and solely when a
 * publishable key is configured, so it becomes its own chunk.
 */
export default function ClerkGate({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      afterSignOutUrl="/auth"
      appearance={{
        variables: {
          colorPrimary: '#4ADE80',
          colorBackground: '#0B120E',
          colorText: '#FFFFFF',
          colorInputBackground: '#111A15',
          colorInputText: '#FFFFFF',
          borderRadius: '10px',
          fontFamily: 'Inter Variable, Inter, system-ui, sans-serif',
        },
      }}
    >
      <Bridge>{children}</Bridge>
    </ClerkProvider>
  )
}

/** Maps Clerk's hooks onto the app's own auth shape. */
function Bridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth()
  const { user } = useUser()

  const value: AuthState = {
    available: true,
    ready: isLoaded,
    signedIn: Boolean(isSignedIn),
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    userId: user?.id ?? null,
    getToken: async () => {
      try {
        return await getToken()
      } catch {
        return null
      }
    },
    signOut: async () => {
      await signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
