import * as THREE from 'three'

/**
 * 360° background system.
 *   - Procedural presets rendered by a shader on an inside-out sphere. These
 *     are generated in-GPU, so they're animated and completely rights-free.
 *   - Equirectangular images (the standard 360 format) via URL or file upload,
 *     applied as the scene background.
 *
 * Theme colours feed the shaders, so backgrounds match the active theme.
 */
export const BG_PRESETS = [
  { id: 'stars', label: 'Stars' },
  { id: 'tunnel', label: 'Tunnel ◎' },
  { id: 'moire', label: 'Moiré ◫' },
  { id: 'spiral', label: 'Spiral ✺' },
  { id: 'grid', label: 'Neon grid ▦' },
  { id: 'plasma', label: 'Plasma ∿' },
  { id: 'aurora', label: 'Aurora ☾' },
]
const MODE = { tunnel: 1, moire: 2, spiral: 3, grid: 4, plasma: 5, aurora: 6 }

const VERT = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`

const FRAG = `
  precision highp float;
  varying vec3 vDir;
  uniform float uTime; uniform int uMode;
  uniform vec3 uAccent; uniform vec3 uAccent2; uniform vec3 uBg;
  #define PI 3.141592653589793
  void main() {
    vec3 d = normalize(vDir);
    float u = atan(d.z, d.x);
    float v = asin(clamp(d.y, -1.0, 1.0));
    float t = uTime;
    vec3 col = uBg;
    if (uMode == 1) {                 // tunnel — hypnotic depth rings
      float r = 1.0 / (abs(v) + 0.14);
      float rings = 0.5 + 0.5 * sin(r * 3.0 - t * 2.0);
      float spokes = 0.5 + 0.5 * sin(u * 18.0);
      col = mix(uBg, mix(uAccent, uAccent2, spokes), rings * spokes);
    } else if (uMode == 2) {          // moiré — optical interference
      float a = 0.5 + 0.5 * sin(u * 40.0 + t);
      float b = 0.5 + 0.5 * sin((u + 0.05 * sin(t)) * 43.0 - v * 39.0);
      col = mix(uBg, uAccent, smoothstep(0.0, 0.14, abs(a - b)));
    } else if (uMode == 3) {          // spiral
      float s = 0.5 + 0.5 * sin(u * 6.0 + v * 26.0 - t * 1.5);
      col = mix(uBg, mix(uAccent2, uAccent, s), smoothstep(0.35, 0.85, s));
    } else if (uMode == 4) {          // neon grid
      float lat = smoothstep(0.88, 1.0, abs(sin(v * 24.0)));
      float lon = smoothstep(0.88, 1.0, abs(sin(u * 24.0)));
      col = mix(uBg, uAccent, max(lat, lon));
      col += uAccent2 * lat * 0.3;
    } else if (uMode == 5) {          // plasma
      float p = sin(u * 4.0 + t) + sin(v * 6.0 - t * 1.2) + sin((u + v) * 5.0 + t * 0.7);
      p = 0.5 + 0.166 * p;
      col = mix(uBg, mix(uAccent, uAccent2, 0.5 + 0.5 * sin(p * 6.283 + t)), p);
    } else if (uMode == 6) {          // aurora
      float band = 0.5 + 0.5 * sin(u * 3.0 + t * 0.6);
      float horizon = smoothstep(0.7, 0.0, abs(v - (0.15 + 0.1 * sin(u * 4.0 + t * 0.5))));
      col = mix(uBg, mix(uAccent2, uAccent, band), horizon);
    }
    gl_FragColor = vec4(col, 1.0);
  }`

export class Background {
  constructor(scene) {
    this.scene = scene
    this.stars = scene.getObjectByName('stars')
    this._t = 0
    this.preset = 'stars'
    this.imageTex = null
    this._objectUrl = null

    this.uniforms = {
      uTime: { value: 0 },
      uMode: { value: 1 },
      uAccent: { value: new THREE.Color(0x6af7ff) },
      uAccent2: { value: new THREE.Color(0xb96bff) },
      uBg: { value: new THREE.Color(0x05060a) },
    }
    this.sphere = new THREE.Mesh(
      new THREE.SphereGeometry(60, 48, 32),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      })
    )
    this.sphere.renderOrder = -1
    this.sphere.visible = false
    scene.add(this.sphere)
  }

  setThemeColors({ accent, accent2, bg }) {
    if (accent) this.uniforms.uAccent.value.set(accent)
    if (accent2) this.uniforms.uAccent2.value.set(accent2)
    if (bg) this.uniforms.uBg.value.set(bg)
    this._apply() // reflect new colours in whatever is showing
  }

  setPreset(id) {
    this.preset = id
    this._clearImage()
    this._apply()
  }

  _apply() {
    if (this.imageTex) {
      this.scene.background = this.imageTex
      this.sphere.visible = false
      if (this.stars) this.stars.visible = false
      return
    }
    if (this.preset === 'stars') {
      this.sphere.visible = false
      if (this.stars) this.stars.visible = true
      this.scene.background = new THREE.Color(this.uniforms.uBg.value)
      if (this.scene.fog) this.scene.fog.color.copy(this.uniforms.uBg.value)
      return
    }
    this.uniforms.uMode.value = MODE[this.preset] || 1
    this.sphere.visible = true
    if (this.stars) this.stars.visible = false
    this.scene.background = new THREE.Color(0x000000)
  }

  /** Load an equirectangular 360 image by URL. */
  setImage(url, { revoke = false } = {}) {
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(
      url,
      (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping
        tex.colorSpace = THREE.SRGBColorSpace
        this._clearImage()
        this.imageTex = tex
        this._objectUrl = revoke ? url : null
        this._apply()
      },
      undefined,
      () => {
        if (revoke) URL.revokeObjectURL(url)
      }
    )
  }

  /** Load an equirectangular 360 image from a user-selected File. */
  setImageFromFile(file) {
    const url = URL.createObjectURL(file)
    this.setImage(url, { revoke: true })
  }

  _clearImage() {
    if (this.imageTex) {
      this.imageTex.dispose()
      this.imageTex = null
    }
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl)
      this._objectUrl = null
    }
  }

  update(dt) {
    this._t += dt
    this.uniforms.uTime.value = this._t
  }
}
