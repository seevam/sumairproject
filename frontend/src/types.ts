/** Shared domain types. Kept free of React/DOM so they can be reused by the sync layer. */

export type Mode = 'study' | 'entertainment'
export type PostureState = 'good' | 'warning' | 'poor' | 'absent'
export type Sensitivity = 'low' | 'medium' | 'high'
export type NotificationStyle = 'visual' | 'audio' | 'desktop'
export type ActivityType = 'studying' | 'gaming' | 'working'

/**
 * Stable persona, as opposed to ActivityType which is what the user is doing in
 * a given session. Behaviour type picks the default mode and is reported as a
 * grouping variable in the pilot analysis; activity can change session to
 * session without changing who the participant is.
 */
export type BehaviorType = 'student' | 'gamer' | 'worker'

export interface UserProfile {
  /** Whole years. Null until the user supplies it. */
  age: number | null
  behaviorType: BehaviorType | null
  preferredActivity: ActivityType | null
}

/**
 * Everything that differs between Study and Entertainment mode.
 *
 * Each mode keeps its own copy, so switching modes restores that mode's
 * configuration rather than carrying the other one's settings across.
 */
export interface ModeSettings {
  breakIntervalMin: number
  sensitivity: Sensitivity
  notificationStyles: NotificationStyle[]
  /** Seconds of sustained deviation before a posture alert fires. */
  postureAlertSeconds: number
}

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
  /** Profile snapshot at the time of the session, for the research dataset. */
  age: number | null
  behaviorType: BehaviorType | null
  activityType: ActivityType | null
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
  /** Which mode is currently active. */
  mode: Mode
  /** Per-mode configuration, kept independently. */
  modes: Record<Mode, ModeSettings>
  profile: UserProfile
  showCameraIndicator: boolean
  participantId: string
  apiBaseUrl: string
}
