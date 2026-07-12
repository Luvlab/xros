import * as THREE from 'three'
import { supabase, isBackendConfigured } from './supabaseClient.js'

/**
 * XR ad serving + rendering.
 *
 * Ad formats (see docs/XR-AD-FORMAT.md):
 *   - billboard : a floating panel placed in the periphery of the result field
 *   - skybox    : a full 360 backdrop takeover (not yet rendered here)
 *   - portal    : a doorway that opens an experience (roadmap)
 *
 * Serving: pulls active creatives from Supabase when configured; otherwise
 * shows a built-in demo so the format is always visible to advertisers.
 * Impressions/clicks are logged to `ad_events` when a backend exists.
 */
const DEMO_CREATIVE = {
  id: 'demo',
  format: 'billboard',
  title: 'Your brand, in the search space',
  body: 'Buy XR & AR ad inventory on XR Search. Billboards, 360 takeovers, portals. → become an advertiser',
  media_url: null,
  click_url: 'https://luvlab.io',
}

export class AdLayer {
  constructor(scene) {
    this.scene = scene
    this.mesh = null
    this.creative = null
    this._t = 0
  }

  async load() {
    let creative = DEMO_CREATIVE
    if (isBackendConfigured) {
      try {
        // Serve one active creative. RLS exposes creatives of active campaigns.
        const { data } = await supabase
          .from('ad_creatives')
          .select('id, format, title, body, media_url, click_url, campaign!inner(status)')
          .eq('campaign.status', 'active')
          .eq('format', 'billboard')
          .limit(10)
        if (data && data.length) {
          creative = pickWeighted(data)
        }
      } catch {
        /* fall back to demo */
      }
    }
    this.render(creative)
  }

  render(creative) {
    this.clear()
    this.creative = creative
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 400
    const ctx = canvas.getContext('2d')

    const accent = cssVar('--accent2', '#b96bff')
    roundRect(ctx, 6, 6, 628, 388, 22)
    ctx.fillStyle = 'rgba(16,12,26,0.96)'
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = accent
    ctx.stroke()

    // "AD" chip
    ctx.fillStyle = accent
    roundRect(ctx, 28, 28, 66, 34, 8)
    ctx.fill()
    ctx.fillStyle = '#0a0a12'
    ctx.font = '700 20px ui-monospace, Menlo, monospace'
    ctx.fillText('AD', 46, 52)

    ctx.fillStyle = '#f2ecff'
    ctx.font = '700 30px ui-monospace, Menlo, monospace'
    wrapText(ctx, creative.title || '', 28, 110, 584, 34, 2)

    ctx.fillStyle = '#c7b9e6'
    ctx.font = '400 22px ui-monospace, Menlo, monospace'
    wrapText(ctx, creative.body || '', 28, 200, 584, 30, 5)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const geo = new THREE.PlaneGeometry(2.0, 1.25)
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    const mesh = new THREE.Mesh(geo, mat)
    // Periphery placement: to the right and slightly down, angled toward user.
    mesh.position.set(3.6, -0.4, -2.4)
    mesh.lookAt(0, 0, 0)
    mesh.userData.ad = creative
    this.mesh = mesh
    this.scene.add(mesh)

    this.logEvent('impression')
  }

  clear() {
    if (this.mesh) {
      this.mesh.geometry.dispose()
      this.mesh.material.map?.dispose()
      this.mesh.material.dispose()
      this.scene.remove(this.mesh)
      this.mesh = null
    }
  }

  intersectables() {
    return this.mesh ? [this.mesh] : []
  }

  /** Called by main.js when the ad is clicked/gazed. */
  activate(userId = null) {
    if (!this.creative) return
    this.logEvent('click', userId)
    if (this.creative.click_url) {
      window.open(this.creative.click_url, '_blank', 'noopener')
    }
  }

  async logEvent(type, userId = null) {
    if (!isBackendConfigured || !this.creative || this.creative.id === 'demo')
      return
    try {
      await supabase.from('ad_events').insert({
        creative: this.creative.id,
        event_type: type,
        user_id: userId,
      })
    } catch {
      /* analytics is best-effort */
    }
  }

  update(dt) {
    this._t += dt
    if (this.mesh) this.mesh.position.y = -0.4 + Math.sin(this._t * 0.5) * 0.04
  }
}

/* ---- helpers (kept local to avoid cross-module coupling) ---- */
function pickWeighted(list) {
  // Placeholder for budget/bid weighting — uniform for now.
  return list[Math.floor(seededFraction(list.length) * list.length)] || list[0]
}
let _seed = 1
function seededFraction() {
  _seed = (_seed * 9301 + 49297) % 233280
  return _seed / 233280
}
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return v || fallback
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = String(text).split(/\s+/)
  let line = ''
  let lines = 0
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i]
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y)
      line = words[i]
      y += lineH
      if (++lines >= maxLines) return
    } else {
      line = test
    }
  }
  ctx.fillText(line, x, y)
}
