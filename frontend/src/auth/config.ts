/**
 * Clerk is optional by design.
 *
 * PostureGuard is guest-first: a participant must be able to calibrate, run a
 * session and export their data with no account, no network dependency on a
 * third party, and no email address stored anywhere. Sign-in exists only to
 * unlock cross-device sync.
 *
 * So the publishable key is allowed to be absent. When it is, the app runs in
 * guest-only mode rather than failing to boot - which also keeps local
 * development and CI free of Clerk credentials.
 */
export const CLERK_PUBLISHABLE_KEY: string = (
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? ''
).trim()

export const authAvailable = (): boolean => CLERK_PUBLISHABLE_KEY.length > 0
