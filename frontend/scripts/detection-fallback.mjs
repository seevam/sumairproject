/**
 * Detection fallback check: calibrates against a real person under simulated
 * GPU failures, and confirms each one either recovers or explains itself.
 *
 *   PERSON_Y4M=/path/to/person.y4m npm run test:detection
 *
 * Needs a short Y4M clip of a real person, head and shoulders in frame - the
 * fake camera's test pattern has nobody in it, so it cannot exercise
 * detection. Never commit that clip: it is a participant's image.
 *
 * Expected: normal and every silent-GPU scenario calibrate (the silent ones
 * falling back to CPU); "WebGL unavailable" cannot work with MediaPipe at all
 * and must show the actionable WebGL message instead of looping.
 */
import { chromium } from 'playwright'

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:4173'
const CLIP = process.env.PERSON_Y4M
if (!CLIP) {
  console.error('Set PERSON_Y4M to a Y4M clip of a person (see the header of this file).')
  process.exit(2)
}

// Runs in the page. Mode is a string because addInitScript JSON-encodes its
// argument, and JSON has no NaN.
function corruptGpuReadback(mode) {
  const value = mode === 'nan' ? Number.NaN : 0
  const FLOAT = 0x1406
  const everything = mode === 'all'
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext].filter(Boolean)) {
    const orig = C.prototype.readPixels
    C.prototype.readPixels = function (x, y, w, h, format, type, dst, off) {
      orig.apply(this, arguments)
      if (type === FLOAT && ArrayBuffer.isView(dst)) {
        const start = typeof off === 'number' ? off : 0
        dst.fill(value, start, start + w * h * 4)
      }
    }
  }
}

const SCENARIOS = {
  'normal GPU': null,
  'WebGL unavailable': () => {
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...a) {
      return /webgl/.test(type) ? null : orig.call(this, type, ...a)
    }
    if (window.OffscreenCanvas) {
      const o = OffscreenCanvas.prototype.getContext
      OffscreenCanvas.prototype.getContext = function (type, ...a) {
        return /webgl/.test(type) ? null : o.call(this, type, ...a)
      }
    }
  },
  // Corrupts only float readbacks - the GPU delegate's inference outputs - and
  // only the requested region. (Emscripten passes the whole WASM heap plus an
  // offset, so zeroing the entire view would wreck the engine, not the GPU.)
  'GPU returns zeros': [corruptGpuReadback, 'zero'],
  'GPU returns NaN': [corruptGpuReadback, 'nan'],
  'all readbacks garbage': [corruptGpuReadback, 'all'],
}

for (const [name, sabotage] of Object.entries(SCENARIOS).filter(([n]) => !process.env.ONLY || n === process.env.ONLY)) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
           `--use-file-for-fake-video-capture=${CLIP}`],
  })
  const ctx = await browser.newContext({ permissions: ['camera'] })
  if (Array.isArray(sabotage)) await ctx.addInitScript(sabotage[0], sabotage[1])
  else if (sabotage) await ctx.addInitScript(sabotage)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/calibrate/active`, { waitUntil: 'networkidle' })

  let done = false, t0 = Date.now()
  while (Date.now() - t0 < 45000) {
    await page.waitForTimeout(1000)
    if (await page.getByRole('heading', { name: 'Calibration complete' }).isVisible()) { done = true; break }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  const pref = await page.evaluate(() => localStorage.getItem('postureguard:pose-delegate'))
  const diag = await page.locator('.font-mono').textContent({ timeout: 1000 }).catch(() => null)
  const blocked = await page.getByText(/Pose detection needs WebGL/).isVisible().catch(() => false)
  if (blocked) console.log('   shows actionable message: "Pose detection needs WebGL ... Use graphics acceleration"')
  console.log(`${name.padEnd(20)} ${done ? 'CALIBRATED in ' + secs + 's' : 'STUCK after 45s'}  remembered delegate=${pref ?? '(none)'}`)
  if (diag) console.log('   diagnostics: ' + diag.replace(/\s+/g, ' '))
  await browser.close()
}
