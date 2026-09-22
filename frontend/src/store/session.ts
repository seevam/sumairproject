import { create } from 'zustand'
import type { PostureState, SessionEvent, SessionEventType, SessionRecord } from '../types'
import { appendEvent, saveSession } from '../lib/db'
import { fireAlert } from '../lib/notify'
import { useSettings } from './settings'
import { queueSync } from '../lib/sync'
import { thresholdFor } from '../lib/posture'

/** Seconds without visible landmarks before the session timer pauses (PRD 7.3). */
export const ABSENCE_GRACE_SECONDS = 60
/** Landmark absence required for a break to count as complete (PRD 7.3). */
export const BREAK_MIN_SECONDS = 180
export const SNOOZE_MINUTES = 5

export type Phase = 'idle' | 'active' | 'break_prompt' | 'break' | 'ended'

interface SessionState {
  phase: Phase
  sessionId: string | null
  participantId: string
  startTime: number | null

  /** Seconds of continuous sitting since the session began or the last break. */
  sittingSeconds: number
  /** Total seconds the session timer has advanced across the whole session. */
  totalSittingSeconds: number
  /** Wall-clock seconds since the session started, including breaks and absence. */
  elapsedSeconds: number

  present: boolean
  absentSeconds: number

  postureState: PostureState
  deviationPct: number
  /** How long deviation has stayed above the warning threshold, in seconds. */
  sustainedSeconds: number
  /** Set while a posture alert is live, cleared once posture recovers. */
  alertActive: boolean

  breaksPrompted: number
  breaksTaken: number
  breaksSnoozed: number
  snoozeUsed: boolean
  snoozeSecondsRemaining: number

  breakSeconds: number
  breakAbsenceSeconds: number

  deviationSum: number
  deviationSamples: number
  postureAlerts: number

  /** Dev/test only: multiplies how fast every timer advances. */
  timeScale: number
  /** Dev/test only: when set, overrides the deviation coming from the camera. */
  forcedDeviation: number | null
  /** Dev/test only: pretends the camera sees nobody. */
  forcedAbsent: boolean

  lastSummaryId: string | null
}

interface SessionActions {
  start: () => Promise<void>
  end: () => Promise<string | null>
  ingest: (deviationPct: number, present: boolean) => void
  tick: () => void
  startBreak: () => void
  endBreak: () => void
  snoozeBreak: () => void
  setTimeScale: (scale: number) => void
  setForcedDeviation: (value: number | null) => void
  setForcedAbsent: (value: boolean) => void
  forceBreakPrompt: () => void
  reset: () => void
}

const initial: SessionState = {
  phase: 'idle',
  sessionId: null,
  participantId: '',
  startTime: null,
  sittingSeconds: 0,
  totalSittingSeconds: 0,
  elapsedSeconds: 0,
  present: false,
  absentSeconds: 0,
  postureState: 'absent',
  deviationPct: 0,
  sustainedSeconds: 0,
  alertActive: false,
  breaksPrompted: 0,
  breaksTaken: 0,
  breaksSnoozed: 0,
  snoozeUsed: false,
  snoozeSecondsRemaining: 0,
  breakSeconds: 0,
  breakAbsenceSeconds: 0,
  deviationSum: 0,
  deviationSamples: 0,
  postureAlerts: 0,
  timeScale: 1,
  forcedDeviation: null,
  forcedAbsent: false,
  lastSummaryId: null,
}

function newSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function log(sessionId: string, type: SessionEventType, extra: Partial<SessionEvent> = {}) {
  void appendEvent({ sessionId, type, timestamp: Date.now(), ...extra })
}

/** Snapshot the current store state into the persisted session record. */
function snapshot(s: SessionState, ended: boolean): SessionRecord {
  const settings = useSettings.getState()
  return {
    id: s.sessionId!,
    participantId: s.participantId || settings.participantId,
    age: settings.profile.age,
    behaviorType: settings.profile.behaviorType,
    activityType: settings.profile.preferredActivity,
    startTime: s.startTime!,
    endTime: ended ? Date.now() : null,
    durationSeconds: Math.round(s.elapsedSeconds),
    mode: settings.mode,
    avgDeviationPct: s.deviationSamples > 0 ? s.deviationSum / s.deviationSamples : 0,
    deviationSamples: s.deviationSamples,
    postureAlerts: s.postureAlerts,
    breaksPrompted: s.breaksPrompted,
    breaksTaken: s.breaksTaken,
    breaksSnoozed: s.breaksSnoozed,
    sittingSeconds: Math.round(s.totalSittingSeconds),
    synced: false,
  }
}

export const useSession = create<SessionState & SessionActions>()((set, get) => ({
  ...initial,

  start: async () => {
    const settings = useSettings.getState()
    const id = newSessionId()
    set({
      ...initial,
      phase: 'active',
      sessionId: id,
      participantId: settings.participantId,
      startTime: Date.now(),
      // Timer preferences are per-session, so keep whatever the dev panel set.
      timeScale: get().timeScale,
    })
    log(id, 'session_start')
    await saveSession(snapshot(get(), false))
  },

  end: async () => {
    const s = get()
    if (!s.sessionId) return null
    const id = s.sessionId
    log(id, 'session_end', { durationSeconds: Math.round(s.elapsedSeconds) })
    const record = snapshot(s, true)
    await saveSession(record)
    queueSync(record)
    set({ ...initial, phase: 'ended', lastSummaryId: id, timeScale: s.timeScale })
    return id
  },

  /**
   * Called once per detected frame (~15-30fps). Cheap by design: it only
   * accumulates, and leaves every threshold decision to tick() so the
   * thresholds are expressed in real seconds regardless of frame rate.
   */
  ingest: (deviationPct, present) => {
    const s = get()
    if (s.phase === 'idle' || s.phase === 'ended') return

    const effectivePresent = s.forcedAbsent ? false : present
    const effectiveDeviation = s.forcedDeviation ?? deviationPct

    set({
      present: effectivePresent,
      deviationPct: effectivePresent ? effectiveDeviation : s.deviationPct,
    })
  },

  /** Advances every timer. Driven at 1Hz; timeScale multiplies the step. */
  tick: () => {
    const s = get()
    if (s.phase === 'idle' || s.phase === 'ended') return

    const settings = useSettings.getState()
    const modeSettings = settings.active()
    const step = s.timeScale
    const patch: Partial<SessionState> = { elapsedSeconds: s.elapsedSeconds + step }

    // --- presence -----------------------------------------------------------
    if (s.present) {
      if (s.absentSeconds >= ABSENCE_GRACE_SECONDS && s.sessionId) {
        log(s.sessionId, 'user_present')
      }
      patch.absentSeconds = 0
    } else {
      patch.absentSeconds = s.absentSeconds + step
      if (s.absentSeconds < ABSENCE_GRACE_SECONDS && s.absentSeconds + step >= ABSENCE_GRACE_SECONDS && s.sessionId) {
        log(s.sessionId, 'user_absent')
      }
    }

    const detected = s.present || s.absentSeconds + step < ABSENCE_GRACE_SECONDS

    // --- break in progress --------------------------------------------------
    if (s.phase === 'break') {
      patch.breakSeconds = s.breakSeconds + step
      if (!s.present) patch.breakAbsenceSeconds = s.breakAbsenceSeconds + step

      // The user came back after a full break: resume automatically.
      if (s.present && s.breakAbsenceSeconds >= BREAK_MIN_SECONDS) {
        set(patch)
        get().endBreak()
        return
      }
      set(patch)
      return
    }

    // --- snooze countdown ---------------------------------------------------
    if (s.snoozeSecondsRemaining > 0) {
      const remaining = s.snoozeSecondsRemaining - step
      patch.snoozeSecondsRemaining = Math.max(0, remaining)
      if (remaining <= 0 && s.phase === 'active') {
        patch.phase = 'break_prompt'
        patch.breaksPrompted = s.breaksPrompted + 1
        if (s.sessionId) log(s.sessionId, 'break_prompt', { durationSeconds: Math.round(s.sittingSeconds) })
        fireAlert({
          title: 'Time for a break',
          body: `You have been sitting for ${Math.round(s.sittingSeconds / 60)} minutes.`,
          tag: 'break',
          styles: modeSettings.notificationStyles,
          mode: settings.mode,
          urgent: true,
        })
      }
      set(patch)
      return
    }

    if (s.phase === 'break_prompt') {
      set(patch)
      return
    }

    // --- active session -----------------------------------------------------
    if (!detected) {
      // Timer is paused while the user is away; nothing below should advance.
      patch.postureState = 'absent'
      patch.sustainedSeconds = 0
      set(patch)
      return
    }

    patch.sittingSeconds = s.sittingSeconds + step
    patch.totalSittingSeconds = s.totalSittingSeconds + step
    patch.deviationSum = s.deviationSum + s.deviationPct * step
    patch.deviationSamples = s.deviationSamples + step

    // --- posture state machine ---------------------------------------------
    const { warning } = thresholdFor(modeSettings.sensitivity)
    const over = s.deviationPct >= warning
    const dwell = modeSettings.postureAlertSeconds

    if (over) {
      const sustained = s.sustainedSeconds + step
      patch.sustainedSeconds = sustained

      if (sustained >= dwell) {
        patch.postureState = 'poor'
        if (!s.alertActive) {
          patch.alertActive = true
          patch.postureAlerts = s.postureAlerts + 1
          if (s.sessionId) {
            log(s.sessionId, 'posture_alert', {
              deviationPct: s.deviationPct,
              durationSeconds: Math.round(sustained),
              alertTriggered: true,
            })
          }
          fireAlert({
            title: 'Check your posture',
            body: `You have been slouching for ${Math.round(dwell)}s. Sit back and lift your chest.`,
            tag: 'posture',
            styles: modeSettings.notificationStyles,
            mode: settings.mode,
          })
        }
      } else {
        patch.postureState = 'warning'
        if (s.postureState !== 'warning' && s.sessionId) {
          log(s.sessionId, 'posture_warning', { deviationPct: s.deviationPct })
        }
      }
    } else {
      patch.sustainedSeconds = 0
      patch.postureState = 'good'
      if (s.alertActive) {
        patch.alertActive = false
        if (s.sessionId) {
          log(s.sessionId, 'posture_recovered', { deviationPct: s.deviationPct })
        }
      }
    }

    // --- break due ----------------------------------------------------------
    const intervalSeconds = modeSettings.breakIntervalMin * 60
    if ((patch.sittingSeconds ?? 0) >= intervalSeconds) {
      patch.phase = 'break_prompt'
      patch.breaksPrompted = s.breaksPrompted + 1
      if (s.sessionId) {
        log(s.sessionId, 'break_prompt', { durationSeconds: Math.round(patch.sittingSeconds ?? 0) })
      }
      fireAlert({
        title: 'Time for a break',
        body: `You have been sitting for ${Math.round((patch.sittingSeconds ?? 0) / 60)} minutes.`,
        tag: 'break',
        styles: modeSettings.notificationStyles,
        mode: settings.mode,
        urgent: true,
      })
    }

    set(patch)
  },

  startBreak: () => {
    const s = get()
    if (s.sessionId) log(s.sessionId, 'break_start')
    set({
      phase: 'break',
      breaksTaken: s.breaksTaken + 1,
      breakSeconds: 0,
      breakAbsenceSeconds: 0,
      sustainedSeconds: 0,
      alertActive: false,
    })
  },

  endBreak: () => {
    const s = get()
    if (s.sessionId) {
      log(s.sessionId, 'break_end', {
        durationSeconds: Math.round(s.breakSeconds),
      })
    }
    // Sitting time restarts from zero: this is the point of the intervention.
    set({
      phase: 'active',
      sittingSeconds: 0,
      breakSeconds: 0,
      breakAbsenceSeconds: 0,
      snoozeUsed: false,
    })
  },

  snoozeBreak: () => {
    const s = get()
    if (s.snoozeUsed) return
    if (s.sessionId) log(s.sessionId, 'break_snooze', { durationSeconds: SNOOZE_MINUTES * 60 })
    set({
      phase: 'active',
      snoozeUsed: true,
      breaksSnoozed: s.breaksSnoozed + 1,
      snoozeSecondsRemaining: SNOOZE_MINUTES * 60,
      // Hold sitting time just under the threshold so only the snooze timer can re-fire.
      sittingSeconds: Math.min(s.sittingSeconds, useSettings.getState().active().breakIntervalMin * 60 - 1),
    })
  },

  setTimeScale: (timeScale) => set({ timeScale }),
  setForcedDeviation: (forcedDeviation) => set({ forcedDeviation }),
  setForcedAbsent: (forcedAbsent) => set({ forcedAbsent }),

  forceBreakPrompt: () => {
    const s = get()
    if (s.phase !== 'active') return
    set({ sittingSeconds: useSettings.getState().active().breakIntervalMin * 60 - 1 })
  },

  reset: () => set({ ...initial, timeScale: get().timeScale }),
}))

/** Single 1Hz heartbeat for the whole app. Started once from App. */
let heartbeat: number | null = null

export function startHeartbeat(): void {
  if (heartbeat !== null) return
  heartbeat = window.setInterval(() => useSession.getState().tick(), 1000)
}

export function stopHeartbeat(): void {
  if (heartbeat !== null) {
    clearInterval(heartbeat)
    heartbeat = null
  }
}
