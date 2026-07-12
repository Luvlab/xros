import * as THREE from 'three'
import { supabase, isBackendConfigured } from './supabaseClient.js'

/**
 * XR OS shell — the "start page / desktop". Renders app tiles in a lower arc
 * (a spatial dock) beneath the search field. Apps come from the published
 * `apps` table when a backend exists, otherwise a built-in starter set.
 *
 * Roadmap: bookmarked-apps sync, downloads panel, window management, an SDK
 * for embedding 360-friendly web apps as portals.
 */
const DEFAULT_APPS = [
  { id: 'stamp', title: 'Stamp Maker', category: 'create', url: 'https://luvlab.io/apps/stamp-maker', color: '#6af7ff' },
  { id: 'math', title: 'Math Canvas', category: 'create', url: 'https://luvlab.io/apps/math', color: '#b96bff' },
  { id: 'vip', title: 'Vipallar 3D', category: 'shop', url: 'https://luvlab.io/vipallar', color: '#39ff9e' },
  { id: 'shop', title: 'Shop', category: 'shop', url: 'https://luvlab.io/shop', color: '#ff8a5c' },
  { id: 'aj', title: 'AJ Records', category: 'music', url: 'https://luvlab.io/aj', color: '#ff3d81' },
]

export class Shell {
  constructor(scene) {
    this.scene = scene
    this.group = new THREE.Group()
    this.scene.add(this.group)
    this.tiles = []
    this.visible = true
    this._t = 0
  }

  async load() {
    let apps = DEFAULT_APPS
    if (isBackendConfigured) {
      try {
        const { data } = await supabase
          .from('apps')
          .select('id, title, category, url, thumbnail_url')
          .eq('status', 'published')
          .limit(9)
        if (data && data.length) apps = data
      } catch {
        /* fall back to defaults */
      }
    }
    this.render(apps)
  }

  render(apps) {
    this.clear()
    const n = apps.length
    const span = THREE.MathUtils.degToRad(22)
    apps.forEach((app, i) => {
      const az = (i - (n - 1) / 2) * span
      const mesh = this._makeTile(app)
      const R = 3.6
      mesh.position.set(Math.sin(az) * R, -2.0, -Math.cos(az) * R)
      mesh.lookAt(0, -0.3, 0)
      mesh.userData.app = app
      this.group.add(mesh)
      this.tiles.push(mesh)
    })
  }

  _makeTile(app) {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 220
    const ctx = canvas.getContext('2d')
    const color = app.color || cssVar('--accent', '#6af7ff')

    roundRect(ctx, 8, 8, 304, 204, 24)
    ctx.fillStyle = 'rgba(14,16,30,0.95)'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = color
    ctx.stroke()

    // Icon puck
    ctx.beginPath()
    ctx.arc(160, 92, 44, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.fillStyle = '#0a0a12'
    ctx.font = '700 44px ui-monospace, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.fillText((app.title || '?')[0].toUpperCase(), 160, 108)

    ctx.fillStyle = '#e8ecff'
    ctx.font = '600 22px ui-monospace, Menlo, monospace'
    ctx.fillText(clip(app.title || '', 16), 160, 176)
    ctx.textAlign = 'left'

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const geo = new THREE.PlaneGeometry(1.0, 0.7)
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    return new THREE.Mesh(geo, mat)
  }

  clear() {
    for (const t of this.tiles) {
      t.geometry.dispose()
      t.material.map?.dispose()
      t.material.dispose()
      this.group.remove(t)
    }
    this.tiles = []
  }

  setVisible(v) {
    this.visible = v
    this.group.visible = v
  }

  intersectables() {
    return this.visible ? this.tiles : []
  }

  activate(mesh) {
    const app = mesh.userData.app
    if (app?.url) window.open(app.url, '_blank', 'noopener')
  }

  update(dt) {
    this._t += dt
    for (let i = 0; i < this.tiles.length; i++) {
      this.tiles[i].position.y = -2.0 + Math.sin(this._t * 0.5 + i) * 0.03
    }
  }
}

function clip(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
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
