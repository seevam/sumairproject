/**
 * End-to-end smoke test against a built app.
 *
 *   npm run build && npm run preview &
 *   npm run smoke
 *
 * Chromium runs with a fake camera device, so the pose model loads and runs but
 * never sees a person - which is exactly what we want to assert here: that the
 * camera opens, MediaPipe initialises, every route renders, settings persist,
 * and the CSV export produces the columns the pilot study needs.
 *
 * Point it at a deployment with SMOKE_BASE_URL=https://... npm run smoke
 */
import { chromium } from 'playwright'

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:4173'
const errors = []
let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' :: ' + detail}`)
  if (!cond) failures++
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const ctx = await browser.newContext({ permissions: ['camera', 'notifications'] })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

console.log('\n== routing ==')
await page.goto(BASE, { waitUntil: 'networkidle' })
check('root redirects into the app', page.url().includes('/calibrate') || page.url().includes('/dashboard'), page.url())

console.log('\n== dashboard gates on calibration ==')
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
check('prompts for calibration with no baseline', await page.getByText('Calibration needed').isVisible())

console.log('\n== calibration intro ==')
await page.goto(`${BASE}/calibrate`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
check('shows the 3 instruction steps', (await page.locator('ol li').count()) === 3)
check('reports a camera present', await page.getByText(/Camera detected/).isVisible())

console.log('\n== live calibration: camera + MediaPipe ==')
await page.getByRole('button', { name: 'Start calibration' }).click()
await page.waitForURL('**/calibrate/active')
// The fake device renders a rolling test pattern with no person in it, so the
// model should load and run but never report a pose.
await page.waitForFunction(() => {
  const v = document.querySelector('video')
  return v && v.videoWidth > 0
}, { timeout: 20000 })
check('camera stream is live', true)

const status = await page.waitForFunction(
  () => {
    const t = document.body.innerText
    if (t.includes('Position detected') || t.includes('Capturing')) return 'detected'
    if (t.includes('Move so your head')) return 'no-pose'
    if (t.includes('Cannot start the camera')) return 'error'
    return null
  },
  { timeout: 40000 },
).then((h) => h.jsonValue())
check('pose model loaded and is running', status !== 'error', `status=${status}`)
console.log(`     model reached state: ${status}`)

console.log('\n== dev panel ==')
await page.goto(`${BASE}/dashboard?dev=1`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
check('dev panel is visible with ?dev=1', await page.getByText('Dev / test mode').isVisible())
check('exposes clock speed controls', await page.getByRole('button', { name: '60x' }).isVisible())

console.log('\n== other routes render ==')
for (const [route, marker] of [
  ['/data', 'Your data'],
  ['/settings', 'Settings'],
  ['/settings/privacy', 'Privacy'],
]) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  check(`${route} renders`, await page.getByRole('heading', { name: marker, exact: false }).first().isVisible())
}

console.log('\n== settings persist ==')
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: '60 min' }).click()
await page.getByRole('button', { name: 'high', exact: true }).click()
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('postureguard:settings')).state)
check('break interval persisted', persisted.breakIntervalMin === 60, JSON.stringify(persisted.breakIntervalMin))
check('sensitivity persisted', persisted.sensitivity === 'high', persisted.sensitivity)

console.log('\n== CSV export downloads ==')
// Seed a completed session directly into IndexedDB so export has something real.
await page.goto(`${BASE}/data`, { waitUntil: 'networkidle' })
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('postureguard', 1)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  await new Promise((res, rej) => {
    const tx = db.transaction('sessions', 'readwrite')
    tx.objectStore('sessions').put({
      id: 'seed1', participantId: 'P-SEED', startTime: Date.now() - 3600000,
      endTime: Date.now(), durationSeconds: 3600, mode: 'study',
      avgDeviationPct: 11.5, deviationSamples: 3000, postureAlerts: 2,
      breaksPrompted: 2, breaksTaken: 1, breaksSnoozed: 1, sittingSeconds: 3000, synced: false,
    })
    tx.oncomplete = res; tx.onerror = () => rej(tx.error)
  })
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
check('seeded session appears in the list', await page.getByText('P-SEED').isVisible().catch(() => false) || (await page.locator('li', { hasText: 'alerts' }).count()) > 0)

const dl = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.getByRole('button', { name: 'Export sessions CSV' }).click(),
]).then(([d]) => d)
const path = await dl.path()
const body = (await import('node:fs')).readFileSync(path, 'utf8')
check('CSV has the PRD header', body.includes('session_duration_min') && body.includes('compliance_rate_pct'))
check('CSV contains the seeded row', body.includes('P-SEED'))
console.log('     first two CSV lines:')
body.split('\r\n').slice(0, 2).forEach((l) => console.log('       ' + l))

console.log('\n== console errors ==')
const real = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e))
check('no uncaught page errors', real.length === 0, real.slice(0, 3).join(' | '))

await browser.close()
console.log(failures === 0 ? '\nSMOKE TEST PASSED\n' : `\n${failures} SMOKE CHECK(S) FAILED\n`)
process.exit(failures ? 1 : 0)
