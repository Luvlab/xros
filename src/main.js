import * as THREE from 'three'
import { StereoEffect } from 'three/examples/jsm/effects/StereoEffect.js'
import { createWorld } from './scene.js'
import { LookControls } from './controls.js'
import { ResultsLayer } from './cards.js'
import { search, fetchArticle } from './search.js'
import {
  Settings,
  PRESETS,
  THEME_VARS,
  COVERAGE_FOV,
  COVERAGE_STEPS,
} from './settings.js'
import { aiAnswer, PROVIDERS } from './ai.js'
import { Auth } from './auth.js'
import { AdLayer } from './ads.js'
import { Shell } from './shell.js'
import { can, roleLabel } from './rbac.js'

const container = document.getElementById('scene')
const { scene, camera, renderer } = createWorld(container)
const controls = new LookControls(camera, renderer.domElement)
const results = new ResultsLayer(scene)
const ads = new AdLayer(scene)
const shell = new Shell(scene)
const auth = new Auth()

// ---- settings + theme ----
const settings = new Settings()
settings.onThemeChange((t) => {
  // Keep the 3D world in sync with the CSS background colour.
  const col = new THREE.Color(t.bg)
  scene.background = col
  scene.fog.color = col
})
settings.applyTheme()

const stereo = new StereoEffect(renderer)
stereo.setEyeSeparation(0.064)
stereo.setSize(container.clientWidth, container.clientHeight)

// ---- DOM ----
const ui = {
  form: document.getElementById('search-form'),
  input: document.getElementById('search-input'),
  status: document.getElementById('status'),
  reticle: document.getElementById('reticle'),
  reticleFill: document.querySelector('.reticle-fill'),
  exitVr: document.getElementById('exit-vr'),
  modeBtns: [...document.querySelectorAll('.mode-btn[data-mode]')],
}

// ---- state ----
let mode = 'desktop' // 'desktop' | 'tilt' | 'cardboard'
const raycaster = new THREE.Raycaster()
const centerNdc = new THREE.Vector2(0, 0)
let hovered = null
let dwell = 0
const DWELL_TIME = 1.4 // seconds of gaze to trigger

// ---- search flow ----
let searchToken = 0
async function runSearch(q) {
  if (!q.trim()) return
  const token = ++searchToken
  setStatus('Searching…')
  try {
    const items = await search(q, 10)
    if (token !== searchToken) return // a newer search superseded this one
    if (!items.length) {
      setStatus(`No results for “${q}”.`)
      results.clear()
      return
    }
    setStatus('')
    results.setResults(items)
    controls.recenter()
    maybeAnswer(q, items, token)
  } catch (err) {
    console.error(err)
    setStatus('Search failed — check your connection.')
  }
}

// AI answer card — runs alongside results when a provider is configured.
async function maybeAnswer(q, items, token) {
  const ai = settings.data.ai
  if (!ai.provider || ai.provider === 'none') return
  if (PROVIDERS[ai.provider]?.needsKey && !ai.apiKey) return

  results.showAnswer('', q, 'loading')
  const context = items
    .slice(0, 5)
    .map((it) => `- ${it.title}: ${it.snippet}`)
    .join('\n')
  try {
    const text = await aiAnswer(ai, q, context)
    if (token !== searchToken) return
    results.showAnswer(text, q, 'done')
  } catch (err) {
    console.error(err)
    if (token !== searchToken) return
    results.showAnswer(String(err.message || err), q, 'error')
  }
}

ui.form.addEventListener('submit', (e) => {
  e.preventDefault()
  ui.input.blur()
  runSearch(ui.input.value)
})

function setStatus(text) {
  if (!text) {
    ui.status.classList.add('hidden')
    ui.status.textContent = ''
  } else {
    ui.status.textContent = text
    ui.status.classList.remove('hidden')
  }
}

// ---- mode switching ----
ui.modeBtns.forEach((btn) => {
  btn.addEventListener('click', () => enterMode(btn.dataset.mode))
})
ui.exitVr.addEventListener('click', () => enterMode('desktop'))

async function enterMode(next) {
  if (next === mode) {
    // toggle off -> back to desktop
    return enterMode('desktop')
  }

  if (next === 'desktop') {
    mode = 'desktop'
    controls.disableDeviceOrientation()
    document.body.classList.remove('stereo')
    ui.reticle.classList.add('hidden')
    ui.exitVr.classList.add('hidden')
    updateModeButtons()
    onResize()
    return
  }

  // tilt or cardboard -> both want device orientation (gesture-gated)
  const ok = await controls.enableDeviceOrientation()
  // ok=false on desktops without a sensor; we still allow drag + stereo.

  mode = next
  updateModeButtons()

  if (next === 'cardboard') {
    document.body.classList.add('stereo')
    ui.reticle.classList.remove('hidden')
    ui.exitVr.classList.remove('hidden')
    requestFullscreen()
  } else {
    document.body.classList.remove('stereo')
    ui.reticle.classList.add('hidden')
    ui.exitVr.classList.add('hidden')
  }

  if (!ok && next !== 'desktop') {
    setStatus(
      next === 'cardboard'
        ? 'No motion sensor — drag to look. (Best on a phone in a cardboard.)'
        : 'No motion sensor here — drag to look. Open on your phone for tilt.'
    )
    setTimeout(() => setStatus(''), 3500)
  }
  onResize()
}

function updateModeButtons() {
  ui.modeBtns.forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode)
  )
}

function requestFullscreen() {
  const el = document.documentElement
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {})
}

// ---- settings panel ----
const sEl = {
  panel: document.getElementById('settings'),
  open: document.getElementById('settings-btn'),
  close: document.getElementById('settings-close'),
  tabs: [...document.querySelectorAll('.stab')],
  bodies: [...document.querySelectorAll('.settings-body')],
  presetRow: document.getElementById('preset-row'),
  themeFields: document.getElementById('theme-fields'),
  customCss: document.getElementById('custom-css'),
  themeReset: document.getElementById('theme-reset'),
  provider: document.getElementById('ai-provider'),
  keyWrap: document.getElementById('ai-key-wrap'),
  key: document.getElementById('ai-key'),
  ollamaWrap: document.getElementById('ai-ollama-wrap'),
  ollama: document.getElementById('ai-ollama'),
  model: document.getElementById('ai-model'),
  note: document.getElementById('ai-note'),
}

function buildSettingsUI() {
  // Presets
  Object.keys(PRESETS).forEach((name) => {
    const b = document.createElement('button')
    b.className = 'preset-chip'
    b.textContent = name
    b.addEventListener('click', () => {
      settings.applyPreset(name)
      syncThemeInputs()
    })
    sEl.presetRow.appendChild(b)
  })

  // Theme colour/text fields
  THEME_VARS.forEach((v) => {
    const row = document.createElement('div')
    row.className = 'theme-field'
    const label = document.createElement('label')
    label.textContent = v.label
    const input = document.createElement('input')
    input.type = v.type === 'color' ? 'color' : 'text'
    input.dataset.key = v.key
    input.addEventListener('input', () => {
      settings.data.theme[v.key] = input.value
      settings.save()
      settings.applyTheme()
    })
    row.appendChild(label)
    row.appendChild(input)
    sEl.themeFields.appendChild(row)
  })

  sEl.customCss.addEventListener('input', () => {
    settings.data.theme.customCss = sEl.customCss.value
    settings.save()
    settings.applyTheme()
  })
  sEl.themeReset.addEventListener('click', () => {
    settings.reset()
    syncThemeInputs()
    syncAiInputs()
  })

  // AI providers
  Object.entries(PROVIDERS).forEach(([id, p]) => {
    const opt = document.createElement('option')
    opt.value = id
    opt.textContent = p.label
    sEl.provider.appendChild(opt)
  })
  sEl.provider.addEventListener('change', () => {
    settings.data.ai.provider = sEl.provider.value
    settings.data.ai.model = '' // reset to provider default
    settings.save()
    syncAiInputs()
  })
  sEl.key.addEventListener('input', () => {
    settings.data.ai.apiKey = sEl.key.value.trim()
    settings.save()
  })
  sEl.ollama.addEventListener('input', () => {
    settings.data.ai.ollamaUrl = sEl.ollama.value.trim()
    settings.save()
  })
  sEl.model.addEventListener('input', () => {
    settings.data.ai.model = sEl.model.value.trim()
    settings.save()
  })

  // Tabs
  sEl.tabs.forEach((t) => {
    t.addEventListener('click', () => {
      sEl.tabs.forEach((x) => x.classList.toggle('active', x === t))
      sEl.bodies.forEach((b) =>
        b.classList.toggle('hidden', b.dataset.panel !== t.dataset.tab)
      )
    })
  })

  sEl.open.addEventListener('click', () =>
    sEl.panel.classList.toggle('hidden')
  )
  sEl.close.addEventListener('click', () =>
    sEl.panel.classList.add('hidden')
  )

  syncThemeInputs()
  syncAiInputs()
}

function syncThemeInputs() {
  THEME_VARS.forEach((v) => {
    const input = sEl.themeFields.querySelector(`[data-key="${v.key}"]`)
    if (input) input.value = settings.data.theme[v.key]
  })
  sEl.customCss.value = settings.data.theme.customCss || ''
}

function syncAiInputs() {
  const ai = settings.data.ai
  sEl.provider.value = ai.provider
  sEl.key.value = ai.apiKey || ''
  sEl.ollama.value = ai.ollamaUrl || ''
  sEl.model.value = ai.model || ''
  const p = PROVIDERS[ai.provider] || {}
  sEl.model.placeholder = p.defaultModel || '(default)'
  sEl.keyWrap.classList.toggle('hidden', !p.needsKey)
  sEl.ollamaWrap.classList.toggle('hidden', ai.provider !== 'ollama')
  sEl.note.textContent = aiNote(ai.provider)
}

function aiNote(provider) {
  switch (provider) {
    case 'none':
      return 'AI answers are off. Pick a provider to add an AI answer card above your results.'
    case 'openrouter':
      return 'Best for browser use. Free models available. Key stays in your browser; for a hosted site, proxy it server-side.'
    case 'ollama':
      return 'Runs locally — no key. Start Ollama with OLLAMA_ORIGINS="*" so the page can reach it.'
    case 'anthropic':
      return 'Works direct from the browser. Note: your key is exposed client-side — fine for local/self-host, proxy for production.'
    case 'openai':
    case 'groq':
      return 'Heads up: these usually block direct browser calls (CORS). Works via a proxy — OpenRouter is the easier browser path.'
    default:
      return ''
  }
}

buildSettingsUI()

// ---- account tab ----
const aEl = {
  signedOut: document.getElementById('acct-signedout'),
  signedIn: document.getElementById('acct-signedin'),
  status: document.getElementById('acct-status'),
  email: document.getElementById('acct-email'),
  signin: document.getElementById('acct-signin'),
  google: document.getElementById('acct-google'),
  name: document.getElementById('acct-name'),
  roleBadge: document.getElementById('acct-role-badge'),
  advertiser: document.getElementById('acct-advertiser'),
  signout: document.getElementById('acct-signout'),
}

function wireAccount() {
  aEl.signin.addEventListener('click', async () => {
    const email = aEl.email.value.trim()
    if (!email) return
    try {
      await auth.signInWithEmail(email)
      aEl.status.textContent = 'Check your email for the magic link.'
    } catch (err) {
      aEl.status.textContent = String(err.message || err)
    }
  })
  aEl.google.addEventListener('click', () =>
    auth.signInWithOAuth('google').catch((e) => {
      aEl.status.textContent = String(e.message || e)
    })
  )
  aEl.signout.addEventListener('click', () => auth.signOut())
}

function syncAccountUI() {
  const signedIn = !!auth.profile
  if (!auth.enabled) {
    aEl.status.textContent =
      'Accounts are off — no backend configured. Add Supabase env vars to enable sign-in, saved bookmarks, and the advertiser portal.'
    aEl.email.disabled = true
    aEl.signin.disabled = true
    aEl.google.disabled = true
  }
  aEl.signedOut.classList.toggle('hidden', signedIn)
  aEl.signedIn.classList.toggle('hidden', !signedIn)
  if (signedIn) {
    aEl.name.textContent = auth.profile.display_name || auth.profile.email
    aEl.roleBadge.textContent = roleLabel(auth.role)
    aEl.advertiser.classList.toggle(
      'hidden',
      !can(auth.profile, 'campaign:manage')
    )
  }
}
wireAccount()

// ---- view / immersion (FOV + horizon spread) ----
const vEl = {
  fovBtn: document.getElementById('fov-btn'),
  coverageRow: document.getElementById('coverage-row'),
  verticalRange: document.getElementById('vertical-range'),
  verticalVal: document.getElementById('vertical-val'),
}

function applyView() {
  const v = settings.data.view
  camera.fov = COVERAGE_FOV[v.coverage] || 70
  camera.updateProjectionMatrix()
  results.setView(v.coverage, v.vertical)
  syncViewUI()
}

function setCoverage(c) {
  settings.data.view.coverage = c
  settings.save()
  applyView()
}

function wireView() {
  COVERAGE_STEPS.forEach((c) => {
    const b = document.createElement('button')
    b.className = 'preset-chip'
    b.dataset.cov = String(c)
    b.textContent = c === 360 ? '360°' : `${c}°`
    b.addEventListener('click', () => setCoverage(c))
    vEl.coverageRow.appendChild(b)
  })
  vEl.verticalRange.addEventListener('input', () => {
    settings.data.view.vertical = Number(vEl.verticalRange.value)
    settings.save()
    applyView()
  })
  // Quick-cycle button in the top bar.
  vEl.fovBtn.addEventListener('click', () => {
    const i = COVERAGE_STEPS.indexOf(settings.data.view.coverage)
    setCoverage(COVERAGE_STEPS[(i + 1) % COVERAGE_STEPS.length])
  })
}

function syncViewUI() {
  const v = settings.data.view
  vEl.fovBtn.textContent = `◐ ${v.coverage}°`
  vEl.verticalRange.value = String(v.vertical)
  vEl.verticalVal.textContent = `±${v.vertical}°`
  ;[...vEl.coverageRow.children].forEach((b) =>
    b.classList.toggle('active', Number(b.dataset.cov) === v.coverage)
  )
}
wireView()

// ---- selection (click on desktop, gaze dwell in xr) ----
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (mode !== 'desktop') return
  const rect = renderer.domElement.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  )
  const hit = pick(ndc)
  if (hit) select(hit)
})

function pick(ndc) {
  raycaster.setFromCamera(ndc, camera)
  const targets = [
    ...results.intersectables(),
    ...ads.intersectables(),
    ...shell.intersectables(),
  ]
  const hits = raycaster.intersectObjects(targets, false)
  return hits.length ? hits[0].object : null
}

let readerToken = 0
function select(mesh) {
  // Reader navigation controls take priority while the reader is open.
  const ctrl = mesh.userData.readerCtrl
  if (ctrl === 'close') return results.hideReader()
  if (ctrl === 'prev') return results.readerPage(-1)
  if (ctrl === 'next') return results.readerPage(1)

  if (mesh.userData.ad) {
    ads.activate(auth.user?.id || null)
    return
  }
  if (mesh.userData.app) {
    shell.activate(mesh)
    return
  }
  if (mesh.userData.result) {
    openReader(mesh.userData.result)
  }
}

// Open the article INSIDE XROS — fetch content, render it as a 3D reader panel.
// No external tab.
async function openReader(data) {
  const token = ++readerToken
  results.showReader(null, camera) // loading placeholder, placed where you look
  try {
    const article = await fetchArticle(data.id)
    if (token !== readerToken) return
    results.setReaderArticle(article, camera)
  } catch (err) {
    console.error(err)
    if (token !== readerToken) return
    results.setReaderArticle(
      { title: data.title, text: data.snippet || 'Could not load this article.', url: data.url },
      camera
    )
  }
}

// ---- gaze loop (tilt + cardboard) ----
function updateGaze(dt) {
  const active = mode === 'cardboard'
  if (!active) {
    if (hovered) {
      hovered = null
      results.setHover(null)
    }
    return
  }
  const hit = pick(centerNdc)
  results.setHover(hit)

  if (hit && hit === hovered) {
    dwell += dt
    const p = Math.min(dwell / DWELL_TIME, 1)
    ui.reticleFill.style.strokeDashoffset = String(251.2 * (1 - p))
    if (p >= 1) {
      select(hit)
      dwell = -0.6 // cooldown so it doesn't retrigger instantly
    }
  } else {
    hovered = hit
    dwell = 0
    ui.reticleFill.style.strokeDashoffset = '251.2'
  }
}

// ---- resize ----
function onResize() {
  const w = container.clientWidth
  const h = container.clientHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  stereo.setSize(w, h)
}
window.addEventListener('resize', onResize)

// ---- render loop ----
const clock = new THREE.Clock()
function tick() {
  const dt = Math.min(clock.getDelta(), 0.1)
  controls.update()
  results.update(dt)
  ads.update(dt)
  shell.update(dt)
  updateGaze(dt)

  if (mode === 'cardboard') {
    stereo.render(scene, camera)
  } else {
    renderer.render(scene, camera)
  }
  requestAnimationFrame(tick)
}

// ---- boot ----
auth.init().then(() => {
  auth.onChange(() => syncAccountUI())
  syncAccountUI()
})
ads.load()
shell.load()
applyView()
runSearch('extended reality')
tick()

// expose for quick console tinkering
window.__xr = { scene, camera, controls, results, ads, shell, auth, runSearch, can, roleLabel }
