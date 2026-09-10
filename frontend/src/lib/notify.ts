import type { Mode, NotificationStyle } from '../types'

/**
 * JITAI delivery (PRD 7.4). Three channels; the user picks any combination.
 * Mode changes intensity, not availability: Study Mode is quieter than
 * Entertainment Mode but still reaches the user.
 */

let audioCtx: AudioContext | null = null

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    audioCtx = new Ctor()
  }
  return audioCtx
}

/**
 * Browsers refuse to start audio without a user gesture. Call this from the
 * click that starts a session so later alerts are actually audible.
 */
export async function unlockAudio(): Promise<void> {
  const c = ctx()
  if (c && c.state === 'suspended') {
    try {
      await c.resume()
    } catch {
      /* the next gesture will retry */
    }
  }
}

/** A short two-tone chime. Gain is halved in Study Mode. */
function chime(mode: Mode, urgent: boolean) {
  const c = ctx()
  if (!c) return
  const peak = (mode === 'study' ? 0.05 : 0.12) * (urgent ? 1.4 : 1)
  const notes = urgent ? [660, 880] : [523.25, 659.25]

  notes.forEach((freq, i) => {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const t0 = c.currentTime + i * 0.18
    // Ramped envelope; a raw start/stop produces an audible click.
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22)
    osc.connect(gain).connect(c.destination)
    osc.start(t0)
    osc.stop(t0 + 0.25)
  })
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

function desktop(title: string, body: string, tag: string, mode: Mode) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    new Notification(title, {
      body,
      tag, // replaces rather than stacks a repeat of the same alert
      silent: mode === 'study',
      requireInteraction: false,
    })
  } catch {
    /* some browsers block construction outside a service worker; visual + audio still fire */
  }
}

export interface AlertOptions {
  title: string
  body: string
  tag: string
  styles: NotificationStyle[]
  mode: Mode
  urgent?: boolean
}

/** Fires every channel the user enabled. Visual is handled by the UI store. */
export function fireAlert({ title, body, tag, styles, mode, urgent = false }: AlertOptions): void {
  if (styles.includes('audio')) chime(mode, urgent)
  if (styles.includes('desktop')) desktop(title, body, tag, mode)
}
