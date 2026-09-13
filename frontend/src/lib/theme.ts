import type { PostureState } from '../types'

/**
 * Palette values for contexts that cannot use a Tailwind class: canvas strokes
 * and SVG attributes. These mirror tailwind.config.js - change both together.
 */
export const COLOR = {
  bg: '#050A07',
  surface: '#0B120E',
  surface2: '#111A15',
  accent: '#4ADE80',
  accentStrong: '#22C55E',
  muted: '#7C8F85',
  warn: '#F0A500',
  danger: '#F04438',
  line: '#1C2A22',
  onAccent: '#04140A',
} as const

/** The posture badge, camera overlay and break ring all share this mapping. */
export const POSTURE_COLOR: Record<PostureState, string> = {
  good: COLOR.accent,
  warning: COLOR.warn,
  poor: COLOR.danger,
  absent: COLOR.muted,
}
