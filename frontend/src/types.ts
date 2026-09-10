/** Shared domain types. Kept free of React/DOM so they can be reused by the sync layer. */

export type Mode = 'study' | 'entertainment'
export type PostureState = 'good' | 'warning' | 'poor' | 'absent'
export type Sensitivity = 'low' | 'medium' | 'high'
export type NotificationStyle = 'visual' | 'audio' | 'desktop'
export type ActivityType = 'studying' | 'gaming' | 'working'

/** A single frame's worth of the landmarks we actually use (normalised 0..1). */
export interface PosturePoint {
  x: number
  y: number
}

/** Derived, camera-independent posture geometry. This is what we compare, never pixels. */
export interface PostureMetrics {
  /** Angle of the shoulder-midpoint -> nose vector, in degrees from vertical. Negative = leaning left. */
  neckAngleDeg: number
  /** |nose - shoulderMid| divided by shoulder width. Drops as the head sinks toward the shoulders. */
  neckRatio: number
  /** Shoulder width in normalised units. Grows as the user leans toward the screen. */
  shoulderWidth: number
  /** Angle of the left->right shoulder line, in degrees. Non-zero = uneven shoulders. */
  shoulderTiltDeg: number
}

export interface CalibrationBaseline {
  createdAt: number
  metrics: PostureMetrics
  /** Raw normalised landmark positions, stored for the research record. */
  landmarks: Record<string, PosturePoint>
  /** True when this is the fallback biomechanical model rather than a real capture. */
  isDefault: boolean
}

export type SessionEventType =
  | 'session_start'
  | 'session_end'
  | 'posture_warning'
  | 'posture_alert'
  | 'posture_recovered'
  | 'break_prompt'
  | 'break_start'
  | 'break_end'
  | 'break_snooze'
  | 'user_absent'
  | 'user_present'

export interface SessionEvent {
  id?: number
  sessionId: string
  type: SessionEventType
  timestamp: number
  deviationPct?: number
  durationSeconds?: number
  alertTriggered?: boolean
}

export interface SessionRecord {
  id: string
  participantId: string
  startTime: number
  endTime: number | null
  durationSeconds: number
  mode: Mode
  /** Running mean of deviation, sampled once per second while the user is present. */
  avgDeviationPct: number
  deviationSamples: number
  postureAlerts: number
  breaksPrompted: number
  breaksTaken: number
  breaksSnoozed: number
  /** Seconds the session timer actually advanced (excludes absence and breaks). */
  sittingSeconds: number
  synced: boolean
}

export interface Settings {
  mode: Mode
  activityType: ActivityType
  breakIntervalMin: number
  sensitivity: Sensitivity
  notificationStyles: NotificationStyle[]
  showCameraIndicator: boolean
  participantId: string
  apiBaseUrl: string
}
