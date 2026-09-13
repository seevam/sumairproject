import { SignIn, SignUp } from '@clerk/clerk-react'

/**
 * Clerk's hosted forms, isolated so they land in the lazy Clerk chunk rather
 * than the main bundle. The surrounding card and tabs stay ours.
 */
export default function ClerkForms({ mode }: { mode: 'login' | 'signup' }) {
  const appearance = {
    elements: {
      rootBox: 'w-full',
      cardBox: 'w-full shadow-none border-none',
      card: 'bg-transparent shadow-none p-0',
      header: 'hidden',
      footer: 'hidden',
    },
  }

  return mode === 'login' ? (
    <SignIn routing="virtual" signUpUrl="/auth" forceRedirectUrl="/onboarding/1" appearance={appearance} />
  ) : (
    <SignUp routing="virtual" signInUrl="/auth" forceRedirectUrl="/onboarding/1" appearance={appearance} />
  )
}
