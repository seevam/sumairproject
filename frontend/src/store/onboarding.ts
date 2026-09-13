import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Tracks whether the intro flow has been completed, so a returning user lands
 * straight on the dashboard. Kept separate from settings because it is
 * navigation state, not a preference the user can meaningfully edit.
 */
interface OnboardingStore {
  completed: boolean
  /** Set once the user chooses guest mode or signs in, so /auth is not re-shown. */
  entered: boolean
  complete: () => void
  enter: () => void
  reset: () => void
}

export const useOnboarding = create<OnboardingStore>()(
  persist(
    (set) => ({
      completed: false,
      entered: false,
      complete: () => set({ completed: true, entered: true }),
      enter: () => set({ entered: true }),
      reset: () => set({ completed: false, entered: false }),
    }),
    { name: 'postureguard:onboarding', version: 1 },
  ),
)
