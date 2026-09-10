import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Mode, Settings } from '../types'

/**
 * Mode presets (PRD 7.4). Switching mode moves the break interval and the
 * posture-alert dwell time together, because they are two halves of the same
 * "how interruptible is this user right now" decision.
 */
export const MODE_PRESETS: Record<Mode, { breakIntervalMin: number; postureAlertSeconds: number; label: string; blurb: string }> = {
  study: {
    breakIntervalMin: 45,
    postureAlertSeconds: 90,
    label: 'Study',
    blurb: 'Breaks every 45 min, posture alerts after 90s. Quieter audio, silent desktop notifications.',
  },
  entertainment: {
    breakIntervalMin: 30,
    postureAlertSeconds: 60,
    label: 'Entertainment',
    blurb: 'Breaks every 30 min, posture alerts after 60s. Full-intensity audio and notifications.',
  },
}

/** Anonymous, stable, generated locally. Nothing about it identifies a person. */
function newParticipantId(): string {
  return `P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

interface SettingsStore extends Settings {
  setMode: (mode: Mode) => void
  update: (patch: Partial<Settings>) => void
  postureAlertSeconds: () => number
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set, get) => ({
      mode: 'study',
      activityType: 'studying',
      breakIntervalMin: MODE_PRESETS.study.breakIntervalMin,
      sensitivity: 'medium',
      notificationStyles: ['visual', 'audio', 'desktop'],
      showCameraIndicator: true,
      participantId: newParticipantId(),
      apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',

      setMode: (mode) => set({ mode, breakIntervalMin: MODE_PRESETS[mode].breakIntervalMin }),
      update: (patch) => set(patch),
      postureAlertSeconds: () => MODE_PRESETS[get().mode].postureAlertSeconds,
    }),
    { name: 'postureguard:settings', version: 1 },
  ),
)
