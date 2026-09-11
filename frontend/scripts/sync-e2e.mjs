/**
 * End-to-end check of the deployed topology: frontend and Python backend on one
 * origin, with /api routed to the backend (repo-root vercel.json in production,
 * the vite proxy locally).
 *
 * Asserts that sync is off until the user opts in, that opting in is what
 * actually enables transmission, and that a completed session reaches the
 * backend's research export.
 */
import { chromium } from 'playwright'

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:4173'
let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' :: ' + detail}`)
  if (!cond) failures++
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const page = await (await browser.newContext({ permissions: ['camera'] })).newPage()

console.log('\n== sync is opt-in ==')
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
check('detects the backend on this origin', await page.getByText(/This deployment includes a research server/).isVisible())
check('sync is off until the user acts', await page.evaluate(() => {
  const raw = localStorage.getItem('postureguard:settings')
  return !raw || !JSON.parse(raw).state.apiBaseUrl
}))

const before = await (await fetch(`${BASE}/api/sessions`)).json()
check('backend has no sessions yet', before.sessions.length === 0, String(before.sessions.length))

console.log('\n== opting in ==')
await page.getByRole('button', { name: 'Sync to this server' }).click()
await page.waitForTimeout(300)
check('setting switched to same-origin', await page.evaluate(
  () => JSON.parse(localStorage.getItem('postureguard:settings')).state.apiBaseUrl) === 'same-origin')
check('UI confirms syncing', await page.getByText(/Syncing completed sessions/).isVisible())

console.log('\n== a completed session reaches the backend ==')
// Drive the engine directly: the fake camera never produces a pose, and this
// check is about the sync path, not detection (covered by smoke.mjs).
await page.goto(`${BASE}/dashboard?dev=1`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const sessionId = await page.evaluate(async () => {
  const store = window.__pgSession
  await store.getState().start()
  const s = store.getState()
  for (let i = 0; i < 120; i++) { s.ingest(20, true); store.getState().tick() }
  const id = store.getState().sessionId
  await store.getState().end()
  return id
})
check('a session id was produced', Boolean(sessionId), String(sessionId))

await page.waitForTimeout(2500)
const after = await (await fetch(`${BASE}/api/sessions`)).json()
check('session arrived at the backend', after.sessions.length === 1, JSON.stringify(after.sessions.length))
if (after.sessions.length) {
  const row = after.sessions[0]
  check('participant id carried through', String(row.participant_id).startsWith('P-'), row.participant_id)
  check('duration recorded', row.duration_seconds > 0, String(row.duration_seconds))
  check('posture alert recorded', row.posture_alerts >= 1, String(row.posture_alerts))
}

const events = await (await fetch(`${BASE}/api/events/export`)).text()
check('events reached the backend export', events.includes('posture_alert'), events.slice(0, 120))

const csv = await (await fetch(`${BASE}/api/sessions/export`)).text()
check('server CSV has the PRD header', csv.includes('avg_posture_deviation_pct') && csv.includes('compliance_rate_pct'))
console.log('     server CSV:')
csv.trim().split('\n').slice(0, 2).forEach((l) => console.log('       ' + l))

console.log('\n== the privacy guarantee is enforced server-side ==')
const rejected = await fetch(`${BASE}/api/session/sync`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ session: { id: 'x', landmarks: [{ x: 1, y: 2 }] } }),
})
check('a payload carrying landmarks is refused', rejected.status === 400, String(rejected.status))

console.log('\n== turning sync back off ==')
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
await page.getByRole('button', { name: 'Turn off' }).click()
await page.waitForTimeout(300)
check('setting cleared', await page.evaluate(
  () => JSON.parse(localStorage.getItem('postureguard:settings')).state.apiBaseUrl) === '')

await browser.close()
console.log(failures === 0 ? '\nSYNC E2E PASSED\n' : `\n${failures} SYNC CHECK(S) FAILED\n`)
process.exit(failures ? 1 : 0)
