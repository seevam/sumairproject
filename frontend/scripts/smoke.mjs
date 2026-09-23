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

/**
 * Visibility check that waits, unlike isVisible() which samples immediately and
 * races React's render after a navigation.
 */
const visible = async (locator, timeout = 8000) => {
  try {
    await locator.first().waitFor({ state: 'visible', timeout })
    return true
  } catch {
    return false
  }
}

/** Waits for a locator to reach an expected count before asserting on it. */
const countIs = async (locator, expected, timeout = 8000) => {
  const deadline = Date.now() + timeout
  let seen = -1
  while (Date.now() < deadline) {
    seen = await locator.count()
    if (seen === expected) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  console.log(`       (expected ${expected}, saw ${seen})`)
  return false
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
// Uncaught exceptions are always real failures.
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

// Resource failures are tracked by URL rather than console text, because
// Chromium's console message for a failed request omits the URL - filtering on
// that text would mean suppressing every resource error, real ones included.
const badResources = []
const isExpectedFailure = (url) =>
  // No Flask backend runs during this test, so the app's /api/health probe is
  // expected to fail and is handled. Backend behaviour is covered by sync-e2e.
  new URL(url, BASE).pathname.startsWith('/api/')

page.on('requestfailed', (r) => {
  const error = r.failure()?.errorText ?? ''
  // ERR_ABORTED means the browser cancelled an in-flight request, which happens
  // routinely when this test navigates quickly. It is not a load failure - the
  // resource itself is asserted separately by its status code when it does load.
  if (error.includes('ERR_ABORTED')) return
  if (!isExpectedFailure(r.url())) badResources.push(`${error} ${r.url()}`)
})
page.on('response', (r) => {
  if (r.status() >= 400 && !isExpectedFailure(r.url())) badResources.push(`HTTP ${r.status()} ${r.url()}`)
})

console.log('\n== first-run routing ==')
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
check('a new visitor lands on the entry screen', page.url().includes('/auth'), page.url())
check('guest is offered as a first-class path', await visible(page.getByRole('button', { name: 'Continue as Guest' })))
check('guest mode is explained', await visible(page.getByText(/Guest mode is fully featured/)))

console.log('\n== onboarding ==')
await page.getByRole('button', { name: 'Continue as Guest' }).click()
await page.waitForURL('**/onboarding/1')
check('step 1 shows the welcome copy', await visible(page.getByRole('heading', { name: /Welcome to PostureGuard/ })))
check('progress reads 1 / 5', await visible(page.getByText('1 / 5')))

await page.getByRole('button', { name: 'Next' }).click()
await page.waitForURL('**/onboarding/2')
check('step 2 lists all four capabilities', await countIs(page.locator('ul li'), 4))

await page.getByRole('button', { name: 'Next' }).click()
await page.waitForURL('**/onboarding/3')
check('step 3 collects the user profile', await visible(page.getByRole('heading', { name: /About You/ })))

// All three profile fields must persist, since they feed the study dataset.
await page.getByLabel('Age').fill('16')
await page.getByRole('button', { name: 'gamer', exact: true }).click()
await page.waitForTimeout(250)
const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('postureguard:settings')).state)
check('age is stored', profile.profile.age === 16, JSON.stringify(profile.profile))
check('behaviour type is stored', profile.profile.behaviorType === 'gamer', String(profile.profile.behaviorType))
check('persona selects its default activity', profile.profile.preferredActivity === 'gaming', String(profile.profile.preferredActivity))
check('persona switches the starting mode', profile.mode === 'entertainment', profile.mode)

await page.getByRole('button', { name: 'Next' }).click()
await page.waitForURL('**/onboarding/4')
check(
  'step 4 shows the per-mode preference rows',
  await countIs(
    page.getByRole('button').filter({ hasText: /Notification Style|Break Interval|Posture Sensitivity|Mode/ }),
    4,
  ),
)

// Editing here must write to the ACTIVE mode only - the whole point of item 4.
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('postureguard:settings')).state.modes)
await page.getByRole('button', { name: /Break Interval/ }).click()
await page.waitForTimeout(250)
const after = await page.evaluate(() => JSON.parse(localStorage.getItem('postureguard:settings')).state.modes)
check('editing changes the active mode', after.entertainment.breakIntervalMin !== before.entertainment.breakIntervalMin,
  `${before.entertainment.breakIntervalMin} -> ${after.entertainment.breakIntervalMin}`)
check('the other mode is untouched', after.study.breakIntervalMin === before.study.breakIntervalMin,
  `${before.study.breakIntervalMin} -> ${after.study.breakIntervalMin}`)

await page.getByRole('button', { name: 'Next' }).click()
await page.waitForURL('**/onboarding/5')
check('step 5 confirms setup is done', await visible(page.getByRole('heading', { name: /All Set/ })))

await page.getByRole('button', { name: 'Start Calibration' }).click()
await page.waitForURL('**/calibrate')
check('finishing onboarding routes to calibration', page.url().includes('/calibrate'))

console.log('\n== onboarding is not repeated ==')
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
check('a returning guest skips straight past the intro', !page.url().includes('/auth') && !page.url().includes('/onboarding'), page.url())

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
await page.waitForTimeout(600)

// Each mode has its own editor, so these controls must be scoped to one of them.
const studyEditor = page.locator('section').filter({ hasText: 'Study Mode settings' })
await studyEditor.getByRole('button', { name: '60 min' }).click()
await studyEditor.getByRole('button', { name: 'low', exact: true }).click()
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)

const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('postureguard:settings')).state)
check('break interval persisted', persisted.modes.study.breakIntervalMin === 60, String(persisted.modes.study.breakIntervalMin))
check('sensitivity persisted', persisted.modes.study.sensitivity === 'low', persisted.modes.study.sensitivity)
check('the edit did not leak into the other mode', persisted.modes.entertainment.breakIntervalMin !== 60,
  String(persisted.modes.entertainment.breakIntervalMin))

console.log('\n== mode toggle restores saved settings ==')
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('postureguard:settings'))
  raw.state.mode = 'study'
  raw.state.modes.study = { ...raw.state.modes.study, breakIntervalMin: 60, sensitivity: 'low' }
  raw.state.modes.entertainment = { ...raw.state.modes.entertainment, breakIntervalMin: 30, sensitivity: 'high' }
  localStorage.setItem('postureguard:settings', JSON.stringify(raw))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)

await page.getByRole('button', { name: /Entertainment Mode/ }).first().click()
await page.waitForTimeout(300)
let live = await page.evaluate(() => JSON.parse(localStorage.getItem('postureguard:settings')).state)
check('switching to Entertainment loads its own config',
  live.mode === 'entertainment' && live.modes.entertainment.breakIntervalMin === 30 && live.modes.entertainment.sensitivity === 'high',
  JSON.stringify(live.modes.entertainment))

await page.getByRole('button', { name: /Study Mode/ }).first().click()
await page.waitForTimeout(300)
live = await page.evaluate(() => JSON.parse(localStorage.getItem('postureguard:settings')).state)
check('switching back to Study restores its own config',
  live.mode === 'study' && live.modes.study.breakIntervalMin === 60 && live.modes.study.sensitivity === 'low',
  JSON.stringify(live.modes.study))
check('neither switch mutated the other mode',
  live.modes.entertainment.breakIntervalMin === 30 && live.modes.study.breakIntervalMin === 60)

console.log('\n== recalibrate is reachable from settings ==')
check('settings offers re-calibration', await visible(page.getByRole('link', { name: /Re-calibrate/ })))

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

console.log('\n== a crashed session is recovered into the dataset ==')
// Simulates a tab that died mid-session: its last checkpoint is in storage
// with no end time. Before the fix this session never reached the export.
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('postureguard', 1)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  await new Promise((res, rej) => {
    const tx = db.transaction('sessions', 'readwrite')
    tx.objectStore('sessions').put({
      id: 'crashed1', participantId: 'P-CRASH', age: 15, behaviorType: 'gamer', activityType: 'gaming',
      startTime: Date.now() - 3 * 3600000, endTime: null, durationSeconds: 1500, mode: 'entertainment',
      avgDeviationPct: 14, deviationSamples: 1500, postureAlerts: 3,
      breaksPrompted: 1, breaksTaken: 1, breaksSnoozed: 0, sittingSeconds: 1400, synced: false,
    })
    tx.oncomplete = res; tx.onerror = () => rej(tx.error)
  })
})
await page.reload({ waitUntil: 'networkidle' }) // app start runs recovery
await page.waitForTimeout(1200)
const recoveredCsv = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.getByRole('button', { name: 'Export sessions CSV' }).click(),
]).then(async ([d]) => (await import('node:fs')).readFileSync(await d.path(), 'utf8'))
const crashRow = recoveredCsv.split('\r\n').find((l) => l.includes('P-CRASH'))
check('the crashed session appears in the export', Boolean(crashRow), 'row missing')
check('its duration comes from the last checkpoint', Boolean(crashRow?.includes(',25,')), crashRow ?? '')

console.log('\n== page health ==')
check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
check('every resource loaded', badResources.length === 0, badResources.slice(0, 4).join(' | '))

await browser.close()
console.log(failures === 0 ? '\nSMOKE TEST PASSED\n' : `\n${failures} SMOKE CHECK(S) FAILED\n`)
process.exit(failures ? 1 : 0)
