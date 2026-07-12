/**
 * Settings store — persisted to localStorage. Two concerns:
 *   - theme : CSS variables + arbitrary custom CSS (the "full CSS panel")
 *   - ai    : bring-your-own-key AI provider config
 *
 * Everything is client-side and open-source-friendly: no backend required.
 * (For a hosted deploy you'd proxy AI keys server-side — see README.)
 */
const KEY = 'xr-search.settings.v1'

export const THEME_VARS = [
  { key: 'bg', label: 'Background', type: 'color' },
  { key: 'fg', label: 'Text', type: 'color' },
  { key: 'dim', label: 'Muted text', type: 'color' },
  { key: 'accent', label: 'Accent', type: 'color' },
  { key: 'accent2', label: 'Accent 2', type: 'color' },
  { key: 'panel', label: 'Panel', type: 'text' },
  { key: 'font', label: 'Font family', type: 'text' },
]

export const PRESETS = {
  Neon: {
    bg: '#05060a', fg: '#e8ecff', dim: '#7c86b8',
    accent: '#6af7ff', accent2: '#b96bff',
  },
  Sunset: {
    bg: '#140a12', fg: '#ffeede', dim: '#c39a86',
    accent: '#ff8a5c', accent2: '#ff3d81',
  },
  Matrix: {
    bg: '#020604', fg: '#c9ffd6', dim: '#4f8f63',
    accent: '#39ff9e', accent2: '#00d0ff',
  },
  Paper: {
    bg: '#f3f1ea', fg: '#1c1b19', dim: '#6b6960',
    accent: '#2b6cff', accent2: '#ff5a3c',
  },
}

const DEFAULTS = {
  theme: {
    bg: '#05060a',
    fg: '#e8ecff',
    dim: '#7c86b8',
    accent: '#6af7ff',
    accent2: '#b96bff',
    panel: 'rgba(12,14,26,0.72)',
    font: 'ui-monospace, "SF Mono", Menlo, monospace',
    customCss: '',
  },
  ai: {
    provider: 'none', // none | openrouter | openai | groq | anthropic | ollama
    apiKey: '',
    model: '',
    ollamaUrl: 'http://localhost:11434',
  },
  view: {
    coverage: 120, // horizontal wrap of results: 90 | 120 | 180 | 360
    vertical: 22, // ± degrees results spread above/below the horizon (0–60)
  },
}

// Horizontal coverage presets → camera field-of-view (deg). Wider coverage
// widens the lens too, taking you from a flat window toward total immersion.
export const COVERAGE_FOV = { 90: 55, 120: 70, 180: 88, 360: 100 }
export const COVERAGE_STEPS = [90, 120, 180, 360]

function deepMerge(base, over) {
  const out = { ...base }
  for (const k of Object.keys(over || {})) {
    out[k] =
      over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])
        ? deepMerge(base[k] || {}, over[k])
        : over[k]
  }
  return out
}

export class Settings {
  constructor() {
    this.data = deepMerge(DEFAULTS, this._load())
    this._styleEl = null
    this._customEl = null
    this._onThemeChange = null
  }

  _load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}')
    } catch {
      return {}
    }
  }

  save() {
    localStorage.setItem(KEY, JSON.stringify(this.data))
  }

  reset() {
    this.data = structuredClone(DEFAULTS)
    this.save()
    this.applyTheme()
  }

  /** Register a callback so the 3D scene can react to theme colors. */
  onThemeChange(cb) {
    this._onThemeChange = cb
  }

  applyPreset(name) {
    const p = PRESETS[name]
    if (!p) return
    this.data.theme = { ...this.data.theme, ...p }
    this.save()
    this.applyTheme()
  }

  /** Write CSS variables to :root, inject custom CSS, notify the scene. */
  applyTheme() {
    const t = this.data.theme
    const root = document.documentElement
    root.style.setProperty('--bg', t.bg)
    root.style.setProperty('--fg', t.fg)
    root.style.setProperty('--dim', t.dim)
    root.style.setProperty('--accent', t.accent)
    root.style.setProperty('--accent2', t.accent2)
    root.style.setProperty('--panel', t.panel)
    root.style.setProperty('--font', t.font)

    if (!this._customEl) {
      this._customEl = document.createElement('style')
      this._customEl.id = 'xr-custom-css'
      document.head.appendChild(this._customEl)
    }
    this._customEl.textContent = t.customCss || ''

    this._onThemeChange?.(t)
  }
}
