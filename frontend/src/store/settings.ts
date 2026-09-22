import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  ActivityType,
  BehaviorType,
  Mode,
  ModeSettings,
  Settings,
  UserProfile,
} from '../types'

/**
 * Starting configuration for each mode (PRD 7.4). These are defaults, not
 * fixed behaviour: once a user edits a mode, their own values are kept and
 * restored every time they switch back to it.
 */
export const MODE_DEFAULTS: Record<Mode, ModeSettings> = {
  study: {
    breakIntervalMin: 45,
    sensitivity: 'medium',
    notificationStyles: ['visual', 'audio', 'desktop'],
    postureAlertSeconds: 90,
  },
  entertainment: {
    breakIntervalMin: 30,
    sensitivity: 'high',
    notificationStyles: ['visual', 'audio', 'desktop'],
    postureAlertSeconds: 60,
  },
}

export const MODE_META: Record<Mode, { label: string; blurb: string }> = {
  study: {
    label: 'Study',
    blurb: 'Longer focus blocks and a longer grace period before a posture alert. Quieter audio, silent desktop notifications.',
  },
  entertainment: {
    label: 'Entertainment',
    blurb: 'Shorter blocks and a quicker posture alert, because gaming focus is harder to interrupt. Full-intensity audio and notifications.',
  },
}

/**
 * Which mode a persona starts in. A gamer's default session is the harder one
 * to interrupt, so they begin in Entertainment; students and desk workers
 * begin in Study.
 */
export const BEHAVIOR_DEFAULT_MODE: Record<BehaviorType, Mode> = {
  student: 'study',
  gamer: 'entertainment',
  worker: 'study',
}

export const BEHAVIOR_DEFAULT_ACTIVITY: Record<BehaviorType, ActivityType> = {
  student: 'studying',
  gamer: 'gaming',
  worker: 'working',
}

/** Anonymous, stable, generated locally. Nothing about it identifies a person. */
function newParticipantId(): string {
  return `P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

const EMPTY_PROFILE: UserProfile = {
  age: null,
  behaviorType: null,
  preferredActivity: null,
}

interface SettingsStore extends Settings {
  /** Configuration for the mode currently in use. */
  active: () => ModeSettings
  /** Switch modes. The target mode's own saved settings come back with it. */
  setMode: (mode: Mode) => void
  /** Patch one mode's settings; defaults to the active mode. */
  updateMode: (patch: Partial<ModeSettings>, mode?: Mode) => void
  /** Patch top-level settings (participant id, backend URL, indicator). */
  update: (patch: Partial<Omit<Settings, 'modes' | 'profile'>>) => void
  setProfile: (patch: Partial<UserProfile>) => void
  /** Apply a persona: selects its default mode and preferred activity. */
  applyBehaviorType: (behaviorType: BehaviorType) => void
  resetModes: () => void
}

function freshModes(): Record<Mode, ModeSettings> {
  return {
    study: { ...MODE_DEFAULTS.study, notificationStyles: [...MODE_DEFAULTS.study.notificationStyles] },
    entertainment: {
      ...MODE_DEFAULTS.entertainment,
      notificationStyles: [...MODE_DEFAULTS.entertainment.notificationStyles],
    },
  }
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set, get) => ({
      mode: 'study',
      modes: freshModes(),
      profile: { ...EMPTY_PROFILE },
      showCameraIndicator: true,
      participantId: newParticipantId(),
      apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',

      active: () => get().modes[get().mode],

      setMode: (mode) => set({ mode }),

      updateMode: (patch, mode) =>
        set((state) => {
          const target = mode ?? state.mode
          return { modes: { ...state.modes, [target]: { ...state.modes[target], ...patch } } }
        }),

      update: (patch) => set(patch as Partial<Settings>),

      setProfile: (patch) => set((state) => ({ profile: { ...state.profile, ...patch } })),

      applyBehaviorType: (behaviorType) =>
        set((state) => ({
          profile: {
            ...state.profile,
            behaviorType,
            // Only fill the activity if the user has not chosen one themselves.
            preferredActivity: state.profile.preferredActivity ?? BEHAVIOR_DEFAULT_ACTIVITY[behaviorType],
          },
          mode: BEHAVIOR_DEFAULT_MODE[behaviorType],
        })),

      resetModes: () => set({ modes: freshModes() }),
    }),
    {
      name: 'postureguard:settings',
      version: 2,
      /**
       * v1 stored a single flat set of settings shared by both modes. Those
       * values were whatever the user last had active, so they migrate into the
       * mode that was selected at the time; the other mode starts from its
       * defaults.
       */
      migrate: (persisted, version) => {
        if (version >= 2) return persisted as SettingsStore

        const old = (persisted ?? {}) as Record<string, unknown>
        const mode = (old.mode === 'entertainment' ? 'entertainment' : 'study') as Mode
        const modes = freshModes()

        modes[mode] = {
          breakIntervalMin:
            typeof old.breakIntervalMin === 'number' ? old.breakIntervalMin : modes[mode].breakIntervalMin,
          sensitivity: (old.sensitivity as ModeSettings['sensitivity']) ?? modes[mode].sensitivity,
          notificationStyles: Array.isArray(old.notificationStyles)
            ? (old.notificationStyles as ModeSettings['notificationStyles'])
            : modes[mode].notificationStyles,
          postureAlertSeconds: MODE_DEFAULTS[mode].postureAlertSeconds,
        }

        return {
          ...(persisted as object),
          mode,
          modes,
          profile: {
            ...EMPTY_PROFILE,
            // v1's single activityType becomes the profile's preferred activity.
            preferredActivity: (old.activityType as ActivityType) ?? null,
          },
        } as SettingsStore
      },
    },
  ),
)

/** Non-React read of the active mode's settings. */
export function activeMode(): ModeSettings {
  return useSettings.getState().active()
}
