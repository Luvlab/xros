import * as THREE from 'three'

/**
 * Builds and manages the floating result cards arranged on a sphere around
 * the user, plus the expanded detail panel.
 */
const CARD_W = 1.5
const CARD_H = 1.05
const RADIUS = 4.2

export class ResultsLayer {
  constructor(scene) {
    this.scene = scene
    this.group = new THREE.Group()
    this.scene.add(this.group)
    this.cards = [] // { mesh, data, basePos, baseQuat }
    this.detail = null
    this.answer = null
    this._texLoader = new THREE.TextureLoader()
    this._texLoader.setCrossOrigin('anonymous')
    this._t = 0
    this._results = []
    // View config: how far results wrap horizontally (deg) and how far they
    // spread above/below the horizon (± deg). Set via setView().
    this.view = { coverage: 120, vertical: 22 }
  }

  /** Update the immersion/view and re-lay out the current results. */
  setView(coverage, vertical) {
    if (coverage != null) this.view.coverage = coverage
    if (vertical != null) this.view.vertical = vertical
    if (this._results.length) this._layout()
  }

  clear() {
    for (const c of this.cards) {
      c.mesh.geometry.dispose()
      c.mesh.material.map?.dispose()
      c.mesh.material.dispose()
      this.group.remove(c.mesh)
    }
    this.cards = []
    this.hideDetail()
    this.hideAnswer()
  }

  /** @param {Array} results */
  setResults(results) {
    this._results = results || []
    this._layout()
  }

  /**
   * Distribute results across a spherical band around the user. The band's
   * horizontal arc (this.view.coverage, 90–360°) and vertical spread
   * (this.view.vertical, ± deg above/below the horizon) drive everything from
   * a flat frontal window (90) to total surround (360).
   */
  _layout() {
    this.clear()
    const results = this._results
    const n = results.length
    if (!n) return

    const coverage = this.view.coverage
    const vertRad = THREE.MathUtils.degToRad(this.view.vertical)
    const fullRing = coverage >= 330

    // More vertical spread earns more rows; wider coverage earns more columns.
    const rows = Math.max(1, Math.min(3, Math.round(this.view.vertical / 16) + 1))
    const cols = Math.ceil(n / rows)
    const arc = THREE.MathUtils.degToRad(Math.min(coverage, 360))

    results.forEach((data, i) => {
      const row = Math.floor(i / cols)
      const col = i % cols
      const colsInRow = Math.min(cols, n - row * cols)

      // Azimuth: full ring wraps 360° (front-anchored); otherwise spread ±arc/2.
      const az = fullRing
        ? col * ((2 * Math.PI) / colsInRow)
        : (col - (colsInRow - 1) / 2) * (arc / Math.max(colsInRow, 1))

      // Elevation: rows fan out symmetrically above/below the horizon.
      const elev =
        rows > 1 ? ((rows - 1) / 2 - row) * ((2 * vertRad) / (rows - 1)) : 0

      const mesh = this._makeCard(data)
      placeOnSphere(mesh, az, elev, RADIUS)
      mesh.lookAt(0, 0, 0)

      mesh.userData.result = data
      mesh.userData.index = i
      this.group.add(mesh)
      this.cards.push({
        mesh,
        data,
        basePos: mesh.position.clone(),
        baseScale: 1,
      })
    })
  }

  _makeCard(data) {
    const tex = this._drawCardTexture(data)
    const geo = new THREE.PlaneGeometry(CARD_W, CARD_H)
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geo, mat)

    // Async thumbnail: redraw the texture once the image is in.
    if (data.thumb) {
      this._texLoader.load(
        data.thumb,
        (img) => {
          const newTex = this._drawCardTexture(data, img.image)
          mesh.material.map?.dispose()
          mesh.material.map = newTex
          mesh.material.needsUpdate = true
        },
        undefined,
        () => {} // ignore image load failures, keep text-only card
      )
    }
    return mesh
  }

  /** Draw a card face to a canvas -> CanvasTexture. */
  _drawCardTexture(data, image = null) {
    const W = 512
    const H = 358
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')

    // Panel background
    roundRect(ctx, 6, 6, W - 12, H - 12, 22)
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, 'rgba(18,22,40,0.96)')
    grad.addColorStop(1, 'rgba(10,12,24,0.96)')
    ctx.fillStyle = grad
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(122,134,184,0.35)'
    ctx.stroke()

    let textTop = 30
    // Optional image band
    if (image) {
      ctx.save()
      roundRect(ctx, 18, 18, W - 36, 150, 14)
      ctx.clip()
      const { sx, sy, sw, sh } = cover(image.width, image.height, W - 36, 150)
      ctx.drawImage(image, sx, sy, sw, sh, 18, 18, W - 36, 150)
      ctx.restore()
      textTop = 190
    }

    // Title
    ctx.fillStyle = '#e8ecff'
    ctx.font = '700 26px ui-monospace, Menlo, monospace'
    wrapText(ctx, data.title, 26, textTop, W - 52, 30, 2)

    // Snippet
    ctx.fillStyle = '#9aa4d4'
    ctx.font = '400 18px ui-monospace, Menlo, monospace'
    const snipY = textTop + (image ? 68 : 76)
    wrapText(ctx, data.snippet || '—', 26, snipY, W - 52, 24, image ? 3 : 5)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    return tex
  }

  intersectables() {
    return this.cards.map((c) => c.mesh)
  }

  /** Pulse the card the user is currently looking at / hovering. */
  setHover(mesh) {
    for (const c of this.cards) {
      const target = c.mesh === mesh ? 1.12 : 1
      c.mesh.scale.lerp(new THREE.Vector3(target, target, target), 0.25)
    }
  }

  showDetail(data) {
    this.hideDetail()
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 640
    const ctx = canvas.getContext('2d')
    roundRect(ctx, 8, 8, 1008, 624, 28)
    ctx.fillStyle = 'rgba(10,12,24,0.98)'
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(106,247,255,0.6)'
    ctx.stroke()

    ctx.fillStyle = '#6af7ff'
    ctx.font = '700 40px ui-monospace, Menlo, monospace'
    wrapText(ctx, data.title, 48, 60, 928, 46, 2)

    ctx.fillStyle = '#cdd4f5'
    ctx.font = '400 26px ui-monospace, Menlo, monospace'
    wrapText(ctx, data.snippet || 'No summary available.', 48, 190, 928, 36, 10)

    ctx.fillStyle = '#7c86b8'
    ctx.font = '400 20px ui-monospace, Menlo, monospace'
    ctx.fillText('▸ look away or tap to close · opens ' + shortUrl(data.url), 48, 600)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const geo = new THREE.PlaneGeometry(3.2, 2.0)
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(0, 0, -3)
    mesh.userData.detail = true
    mesh.userData.result = data
    this.detail = mesh
    this.scene.add(mesh)
    return mesh
  }

  hideDetail() {
    if (this.detail) {
      this.detail.geometry.dispose()
      this.detail.material.map?.dispose()
      this.detail.material.dispose()
      this.scene.remove(this.detail)
      this.detail = null
    }
  }

  /**
   * The AI answer card — a wide panel floating above the result field.
   * Pass state 'loading' | 'done' | 'error' to style it.
   */
  showAnswer(text, query, state = 'done') {
    this.hideAnswer()
    const accent = cssVar('--accent', '#6af7ff')
    const W = 1024
    const H = 420
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')

    roundRect(ctx, 8, 8, W - 16, H - 16, 26)
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, 'rgba(14,18,34,0.97)')
    grad.addColorStop(1, 'rgba(9,11,22,0.97)')
    ctx.fillStyle = grad
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = state === 'error' ? '#ff6b6b' : hexA(accent, 0.7)
    ctx.stroke()

    // Header
    ctx.fillStyle = accent
    ctx.font = '700 26px ui-monospace, Menlo, monospace'
    ctx.fillText('✦ AI ANSWER', 40, 56)
    ctx.fillStyle = '#7c86b8'
    ctx.font = '400 20px ui-monospace, Menlo, monospace'
    wrapText(ctx, query, 210, 56, W - 250, 26, 1)

    // Body
    ctx.fillStyle = state === 'error' ? '#ffb3b3' : '#e8ecff'
    ctx.font = '400 26px ui-monospace, Menlo, monospace'
    const body = state === 'loading' ? 'Thinking…' : text
    wrapText(ctx, body, 40, 108, W - 80, 36, 8)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const geo = new THREE.PlaneGeometry(3.6, 1.48)
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(0, 1.75, -4)
    mesh.userData.answer = true
    this.answer = mesh
    this.scene.add(mesh)
    return mesh
  }

  hideAnswer() {
    if (this.answer) {
      this.answer.geometry.dispose()
      this.answer.material.map?.dispose()
      this.answer.material.dispose()
      this.scene.remove(this.answer)
      this.answer = null
    }
  }

  /** Gentle idle motion so the field feels alive. */
  update(dt) {
    this._t += dt
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i]
      const bob = Math.sin(this._t * 0.6 + i * 0.9) * 0.03
      c.mesh.position.y = c.basePos.y + bob
    }
    if (this.detail) {
      this.detail.position.y = Math.sin(this._t * 0.8) * 0.02
    }
    if (this.answer) {
      this.answer.position.y = 1.75 + Math.sin(this._t * 0.7) * 0.03
    }
  }
}

/* ---------- layout helper ---------- */
// Place a mesh on a sphere of radius R. az=0 is straight ahead (-Z);
// positive elevation is above the horizon.
function placeOnSphere(mesh, az, elev, R) {
  const ce = Math.cos(elev)
  mesh.position.set(
    R * ce * Math.sin(az),
    R * Math.sin(elev),
    -R * ce * Math.cos(az)
  )
}

/* ---------- canvas helpers ---------- */
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
      if (++lines >= maxLines - 1) {
        // last allowed line: append ellipsis if more remains
        let rest = line
        for (let j = i + 1; j < words.length; j++) rest += ' ' + words[j]
        while (
          ctx.measureText(rest + '…').width > maxW &&
          rest.length > 1
        ) {
          rest = rest.slice(0, -1)
        }
        ctx.fillText(
          rest + (rest.length < String(text).length ? '…' : ''),
          x,
          y
        )
        return
      }
    } else {
      line = test
    }
  }
  ctx.fillText(line, x, y)
}

function cover(iw, ih, tw, th) {
  const scale = Math.max(tw / iw, th / ih)
  const sw = tw / scale
  const sh = th / scale
  const sx = (iw - sw) / 2
  const sy = (ih - sh) / 2
  return { sx, sy, sw, sh }
}

function shortUrl(u) {
  try {
    return new URL(u).hostname.replace('www.', '')
  } catch {
    return u
  }
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return v || fallback
}

/** Apply alpha to a #rrggbb hex; passes through non-hex values unchanged. */
function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
