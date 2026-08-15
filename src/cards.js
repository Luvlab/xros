import * as THREE from 'three'

/**
 * Builds and manages the floating result cards arranged on a sphere around
 * the user, plus the expanded detail panel.
 */
const BASE_W = 1.05 // card width at font size 13 (scales with fontSize)
const BASE_H = 0.64 // shorter cards — more economical, more results in view
const RADIUS = 4.2

export class ResultsLayer {
  constructor(scene) {
    this.scene = scene
    this.group = new THREE.Group()
    this.scene.add(this.group)
    this.cards = [] // { mesh, data, basePos, baseQuat }
    this.reader = null // THREE.Group (panel + controls) or null
    this._readerPanel = null
    this._readerCtrls = []
    this._article = null
    this._pages = []
    this._page = 0
    this.answer = null
    this._texLoader = new THREE.TextureLoader()
    this._texLoader.setCrossOrigin('anonymous')
    this._t = 0
    this._results = []
    this._ad = null // in-feed ad creative, slotted among the results
    // View config: horizontal wrap (deg), vertical spread (± deg), and
    // fontSize which sets card size → how densely results pack.
    this.view = { coverage: 120, vertical: 22, fontSize: 13 }
  }

  /** Set the in-feed ad creative (rendered as a card between results). */
  setAd(creative) {
    this._ad = creative
    if (this._results.length) this._layout()
  }

  /** Update the immersion/view and re-lay out the current results. */
  setView(coverage, vertical, fontSize) {
    if (coverage != null) this.view.coverage = coverage
    if (vertical != null) this.view.vertical = vertical
    if (fontSize != null) this.view.fontSize = fontSize
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
    this.hideReader()
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
  /**
   * Masonry layout: every card is sized to its own content (no empty space),
   * then stacked into columns spread across the coverage arc. Columns fill up
   * and down from eye level, so results wrap above and below the horizon.
   */
  _layout() {
    this.clear()
    const items = this._results.slice()
    if (this._ad) items.splice(Math.min(3, items.length), 0, { __ad: true, creative: this._ad })
    if (!items.length) return

    const coverage = this.view.coverage
    const fullRing = coverage >= 330
    const arc = fullRing ? Math.PI * 2 : THREE.MathUtils.degToRad(coverage)
    const cardW = BASE_W * ((this.view.fontSize || 13) / 13)

    const azStep = (cardW * 1.12) / RADIUS
    const cols = Math.max(
      1,
      fullRing ? Math.floor((2 * Math.PI) / azStep) : Math.floor(arc / azStep) + 1
    )
    const rowGapAng = (cardW * 0.06) / RADIUS

    // Build every card (content-sized), then distribute round-robin into columns.
    const built = items.map((data) => {
      const mesh = data.__ad
        ? this._makeAdCard(data.creative, cardW)
        : this._makeCard(data, cardW)
      if (data.__ad) mesh.userData.ad = data.creative
      else mesh.userData.result = data
      return { mesh, data }
    })
    const columns = Array.from({ length: cols }, () => [])
    built.forEach((b, i) => columns[i % cols].push(b))

    columns.forEach((col, c) => {
      const az = fullRing
        ? c * ((2 * Math.PI) / cols)
        : (c - (cols - 1) / 2) * azStep
      let total = -rowGapAng
      col.forEach((b) => (total += b.mesh.userData.worldH / RADIUS + rowGapAng))
      let cur = total / 2 // start at the top of the column
      col.forEach((b) => {
        const angH = b.mesh.userData.worldH / RADIUS
        placeOnSphere(b.mesh, az, cur - angH / 2, RADIUS)
        b.mesh.lookAt(0, 0, 0)
        cur -= angH + rowGapAng
        this.group.add(b.mesh)
        this.cards.push({ mesh: b.mesh, data: b.data, basePos: b.mesh.position.clone(), baseScale: 1 })
      })
    })
  }

  _makeAdCard(creative, cardW = BASE_W) {
    const layout = { W: 512, kind: 'ad', bandH: 0 }
    _mctx.font = '700 26px ui-monospace, Menlo, monospace'
    layout.titleLines = wrapLines(_mctx, creative.title || '', 512 - 44, 2)
    _mctx.font = '400 19px ui-monospace, Menlo, monospace'
    layout.snipLines = wrapLines(_mctx, creative.body || '', 512 - 44, 4)
    layout.H = 20 + 40 + layout.titleLines.length * 30 + 8 + layout.snipLines.length * 24 + 18
    return this._buildMesh({ ...creative, kind: 'ad' }, layout, cardW)
  }

  _makeCard(data, cardW = BASE_W) {
    const layout = this._measure(data)
    const mesh = this._buildMesh(data, layout, cardW)
    // Async thumbnail — redraw in place (height is fixed, so no relayout).
    if (data.thumb) {
      this._texLoader.load(
        data.thumb,
        (img) => {
          mesh.material.map?.dispose()
          mesh.material.map = this._drawCard(data, layout, img.image)
          mesh.material.needsUpdate = true
        },
        undefined,
        () => {}
      )
    }
    return mesh
  }

  _buildMesh(data, layout, cardW) {
    const worldH = cardW * (layout.H / layout.W)
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(cardW, worldH),
      new THREE.MeshBasicMaterial({
        map: this._drawCard(data, layout),
        transparent: true,
        side: THREE.DoubleSide,
      })
    )
    mesh.userData.worldH = worldH
    return mesh
  }

  /** Measure content -> {W,H,kind,bandH,titleLines,snipLines}. No empty space. */
  _measure(data) {
    const W = 512
    const pad = 20
    if (data.kind === 'image') {
      _mctx.font = '700 24px ui-monospace, Menlo, monospace'
      return { W, H: 384, kind: 'image', titleLines: wrapLines(_mctx, data.title, W - 48, 2), bandH: 0 }
    }
    const bandH = data.thumb && data.kind !== 'place' ? 236 : 0
    _mctx.font = '700 25px ui-monospace, Menlo, monospace'
    const titleLines = wrapLines(_mctx, data.title, W - 2 * pad, 3)
    _mctx.font = '400 19px ui-monospace, Menlo, monospace'
    const snipLines = data.snippet ? wrapLines(_mctx, data.snippet, W - 2 * pad, bandH ? 2 : 4) : []
    const top = bandH ? 14 + bandH + 10 : pad
    const H = top + titleLines.length * 30 + (snipLines.length ? 6 + snipLines.length * 24 : 0) + pad
    return { W, H: Math.max(Math.round(H), 84), kind: data.kind, bandH, titleLines, snipLines }
  }

  /** Draw a content-sized card face -> CanvasTexture. */
  _drawCard(data, layout, image = null) {
    const { W, H, kind, bandH } = layout
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    const accent = cssVar('--accent', '#6af7ff')
    const accent2 = cssVar('--accent2', '#b96bff')

    // Panel
    roundRect(ctx, 4, 4, W - 8, H - 8, 18)
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    if (kind === 'ad') {
      grad.addColorStop(0, 'rgba(18,12,28,0.97)')
      grad.addColorStop(1, 'rgba(12,10,22,0.97)')
    } else {
      grad.addColorStop(0, 'rgba(18,22,40,0.96)')
      grad.addColorStop(1, 'rgba(10,12,24,0.96)')
    }
    ctx.fillStyle = grad
    ctx.fill()
    ctx.lineWidth = kind === 'ad' ? 3 : 2
    ctx.strokeStyle = kind === 'ad' ? accent2 : 'rgba(122,134,184,0.35)'
    ctx.stroke()

    // Full-bleed image cards
    if (kind === 'image') {
      if (image) {
        ctx.save()
        roundRect(ctx, 6, 6, W - 12, H - 12, 14)
        ctx.clip()
        const c = cover(image.width, image.height, W - 12, H - 12)
        ctx.drawImage(image, c.sx, c.sy, c.sw, c.sh, 6, 6, W - 12, H - 12)
        const g = ctx.createLinearGradient(0, H - 130, 0, H)
        g.addColorStop(0, 'rgba(6,6,10,0)')
        g.addColorStop(1, 'rgba(6,6,10,0.9)')
        ctx.fillStyle = g
        ctx.fillRect(6, H - 130, W - 12, 124)
        ctx.restore()
      }
      ctx.fillStyle = '#e8ecff'
      ctx.font = '700 23px ui-monospace, Menlo, monospace'
      drawLines(ctx, layout.titleLines, 22, image ? H - 58 : 44, 27)
      return finishTex(canvas)
    }

    let y = 20

    // Thumbnail band (wiki, video)
    if (bandH) {
      ctx.save()
      roundRect(ctx, 14, 14, W - 28, bandH, 12)
      ctx.clip()
      if (image) {
        const c = cover(image.width, image.height, W - 28, bandH)
        ctx.drawImage(image, c.sx, c.sy, c.sw, c.sh, 14, 14, W - 28, bandH)
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.04)'
        ctx.fillRect(14, 14, W - 28, bandH)
      }
      ctx.restore()
      if (data.kind === 'video') {
        const cy = 14 + bandH / 2
        ctx.fillStyle = 'rgba(6,6,10,0.6)'
        ctx.beginPath()
        ctx.arc(W / 2, cy, 28, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.moveTo(W / 2 - 9, cy - 14)
        ctx.lineTo(W / 2 - 9, cy + 14)
        ctx.lineTo(W / 2 + 15, cy)
        ctx.closePath()
        ctx.fill()
      }
      y = 14 + bandH + 10
    }

    // AD chip
    if (kind === 'ad') {
      ctx.fillStyle = accent2
      roundRect(ctx, 20, 18, 60, 30, 8)
      ctx.fill()
      ctx.fillStyle = '#0a0a12'
      ctx.font = '700 19px ui-monospace, Menlo, monospace'
      ctx.fillText('AD', 34, 39)
      y = 62
    }

    // Place pin
    if (kind === 'place') {
      ctx.font = '700 26px ui-monospace, Menlo, monospace'
      ctx.fillText('📍', 20, y + 22)
    }

    // Title
    ctx.fillStyle = kind === 'ad' ? '#f2ecff' : '#e8ecff'
    ctx.font = '700 25px ui-monospace, Menlo, monospace'
    y += 24
    drawLines(ctx, layout.titleLines, 20, y, 30)
    y += (layout.titleLines.length - 1) * 30

    // Snippet
    if (layout.snipLines && layout.snipLines.length) {
      ctx.fillStyle = kind === 'ad' ? '#c7b9e6' : '#9aa4d4'
      ctx.font = '400 19px ui-monospace, Menlo, monospace'
      y += 28
      drawLines(ctx, layout.snipLines, 20, y, 24)
    }
    return finishTex(canvas)
  }

  intersectables() {
    // While the reader is open, only its controls are interactive (the result
    // cards sit behind it); otherwise the cards themselves.
    if (this.reader) return [...this._readerCtrls]
    return this.cards.map((c) => c.mesh)
  }

  /** Pulse the card the user is currently looking at / hovering. */
  setHover(mesh) {
    for (const c of this.cards) {
      const target = c.mesh === mesh ? 1.12 : 1
      c.mesh.scale.lerp(new THREE.Vector3(target, target, target), 0.25)
    }
  }

  /**
   * In-XROS reader — opens the full article as a paginated 3D panel in front of
   * the viewer, so results are read *inside* the browser (works in cardboard),
   * never handed off to an external tab. Pass camera to place it where you look.
   *
   * @param {{title:string,text:string,thumb?:string,url?:string}|null} article
   *        null => a "Loading…" placeholder while the fetch is in flight.
   */
  showReader(article, camera) {
    this.hideReader()
    this._article = article
    this._page = 0
    this._pages = article ? this._paginate(article.text) : [['Loading…']]

    // Panel + controls live in a group placed in front of the camera.
    const group = new THREE.Group()
    if (camera) {
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
      group.position.copy(camera.position).add(dir.multiplyScalar(3.4))
      group.quaternion.copy(camera.quaternion)
    } else {
      group.position.set(0, 0, -3.4)
    }
    this.reader = group
    this.scene.add(group)

    // Panel mesh (texture rebuilt per page)
    const geo = new THREE.PlaneGeometry(3.4, 2.15)
    const mat = new THREE.MeshBasicMaterial({ transparent: true })
    const panel = new THREE.Mesh(geo, mat)
    panel.userData.readerPanel = true
    group.add(panel)
    this._readerPanel = panel

    // Controls: prev / close / open-source / next (each its own mesh)
    this._readerCtrls = [
      this._makeCtrl('‹', 'prev', -0.9),
      this._makeCtrl('✕', 'close', -0.3),
      this._makeCtrl('↗', 'source', 0.3),
      this._makeCtrl('›', 'next', 0.9),
    ]
    for (const c of this._readerCtrls) {
      c.position.y = -1.28
      group.add(c)
    }

    this._renderReaderPage()
    return group
  }

  _makeCtrl(label, action, x) {
    const s = 128
    const canvas = document.createElement('canvas')
    canvas.width = s
    canvas.height = s
    const ctx = canvas.getContext('2d')
    const accent = cssVar('--accent', '#6af7ff')
    ctx.beginPath()
    ctx.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(12,14,26,0.96)'
    ctx.fill()
    ctx.lineWidth = 4
    ctx.strokeStyle = accent
    ctx.stroke()
    ctx.fillStyle = accent
    ctx.font = '700 64px ui-monospace, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, s / 2, s / 2 + 2)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.34),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    )
    mesh.userData.readerCtrl = action
    mesh.position.x = x
    return mesh
  }

  readerArticle() {
    return this._article
  }

  _renderReaderPage() {
    const a = this._article
    const W = 1024
    const H = 648
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    const accent = cssVar('--accent', '#6af7ff')

    roundRect(ctx, 8, 8, W - 16, H - 16, 28)
    ctx.fillStyle = 'rgba(10,12,24,0.98)'
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = hexA(accent, 0.6)
    ctx.stroke()

    // Header: title + page indicator
    ctx.fillStyle = accent
    ctx.font = '700 34px ui-monospace, Menlo, monospace'
    wrapText(ctx, a ? a.title : 'Loading…', 44, 56, W - 200, 40, 1)
    ctx.fillStyle = '#7c86b8'
    ctx.font = '400 22px ui-monospace, Menlo, monospace'
    ctx.textAlign = 'right'
    ctx.fillText(`${this._page + 1}/${this._pages.length}`, W - 44, 52)
    ctx.textAlign = 'left'
    ctx.fillText(a?.url ? shortUrl(a.url) : '', 44, 92)

    // Body: current page lines
    ctx.fillStyle = '#dbe1ff'
    ctx.font = '400 25px ui-monospace, Menlo, monospace'
    let y = 150
    for (const line of this._pages[this._page] || []) {
      ctx.fillText(line, 44, y)
      y += 34
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    this._readerPanel.material.map?.dispose()
    this._readerPanel.material.map = tex
    this._readerPanel.material.needsUpdate = true
  }

  /** Split article text into pages of lines that fit the panel. */
  _paginate(text) {
    const W = 1024
    const maxW = W - 88
    const linesPerPage = 13
    // Measure with a scratch canvas at the body font.
    const ctx = document.createElement('canvas').getContext('2d')
    ctx.font = '400 25px ui-monospace, Menlo, monospace'
    const lines = []
    for (const para of String(text || '').split('\n')) {
      if (!para.trim()) {
        lines.push('')
        continue
      }
      let line = ''
      for (const word of para.split(/\s+/)) {
        const test = line ? line + ' ' + word : word
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line)
          line = word
        } else line = test
      }
      if (line) lines.push(line)
      lines.push('') // paragraph gap
    }
    const pages = []
    for (let i = 0; i < lines.length; i += linesPerPage) {
      pages.push(lines.slice(i, i + linesPerPage))
    }
    return pages.length ? pages : [['(no content)']]
  }

  readerPage(delta) {
    if (!this.reader) return
    const next = this._page + delta
    if (next < 0 || next >= this._pages.length) return
    this._page = next
    this._renderReaderPage()
  }

  /** Called once the async article arrives, replacing the loading panel. */
  setReaderArticle(article, camera) {
    // Only swap if a reader is still open.
    if (this.reader) this.showReader(article, camera)
  }

  hideReader() {
    if (!this.reader) return
    this.reader.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose()
        o.material.map?.dispose()
        o.material.dispose()
      }
    })
    this.scene.remove(this.reader)
    this.reader = null
    this._readerCtrls = []
    this._readerPanel = null
    this._article = null
    this._pages = []
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
    // Cards hold still while reading, so the field behind the reader is calm.
    if (!this.reader) {
      for (let i = 0; i < this.cards.length; i++) {
        const c = this.cards[i]
        const bob = Math.sin(this._t * 0.6 + i * 0.9) * 0.03
        c.mesh.position.y = c.basePos.y + bob
      }
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
// Shared scratch context for measuring text (content-fit card sizing).
const _mctx = document.createElement('canvas').getContext('2d')

// Wrap text into an array of lines that fit maxW, capped at maxLines (last
// line ellipsized if truncated).
function wrapLines(ctx, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const all = []
  let line = ''
  for (const w of words) {
    const test = line ? line + ' ' + w : w
    if (ctx.measureText(test).width > maxW && line) {
      all.push(line)
      line = w
    } else line = test
  }
  if (line) all.push(line)
  if (all.length <= maxLines) return all
  const kept = all.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (ctx.measureText(last + '…').width > maxW && last.length > 1) last = last.slice(0, -1)
  kept[maxLines - 1] = last + '…'
  return kept
}

function drawLines(ctx, lines, x, y, lh) {
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x, y + i * lh)
}

function finishTex(canvas) {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
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
