import * as THREE from 'three'

/**
 * Unified look controls for a fixed-position camera.
 *
 * Two input sources, blended by mode:
 *   - Drag  : pointer drag rotates the camera (desktop + as a fallback on phone)
 *   - Tilt  : device orientation drives the camera (magic window / cardboard)
 *
 * The camera stays at the origin and only rotates — results are placed on a
 * sphere around the user, so rotation is all we need to look around.
 */
export class LookControls {
  constructor(camera, domElement) {
    this.camera = camera
    this.dom = domElement

    this.enabled = true
    this.useDeviceOrientation = false

    // Drag state (yaw/pitch in radians)
    this.yaw = 0
    this.pitch = 0
    this._dragging = false
    this._lastX = 0
    this._lastY = 0
    this._dragSpeed = 0.0045

    // Device orientation state
    this._deviceEuler = new THREE.Euler()
    this._deviceQuat = new THREE.Quaternion()
    this._screenTransform = new THREE.Quaternion()
    this._worldTransform = new THREE.Quaternion(
      -Math.sqrt(0.5),
      0,
      0,
      Math.sqrt(0.5)
    ) // -PI/2 around X: device frame -> three.js frame
    this._zee = new THREE.Vector3(0, 0, 1)
    this._orientation = 0
    this._hasDeviceData = false
    // Yaw offset so a fresh tilt session faces forward (-Z) regardless of compass
    this._yawOffset = null

    this._onPointerDown = this._onPointerDown.bind(this)
    this._onPointerMove = this._onPointerMove.bind(this)
    this._onPointerUp = this._onPointerUp.bind(this)
    this._onDeviceOrientation = this._onDeviceOrientation.bind(this)
    this._onScreenOrientation = this._onScreenOrientation.bind(this)

    this._bindDrag()
  }

  _bindDrag() {
    this.dom.addEventListener('pointerdown', this._onPointerDown)
    window.addEventListener('pointermove', this._onPointerMove)
    window.addEventListener('pointerup', this._onPointerUp)
  }

  _onPointerDown(e) {
    if (!this.enabled || this.useDeviceOrientation) return
    // Ignore drags that start on UI chrome
    if (e.target.closest('#ui') && !e.target.closest('#scene')) return
    this._dragging = true
    this._lastX = e.clientX
    this._lastY = e.clientY
  }

  _onPointerMove(e) {
    if (!this._dragging) return
    const dx = e.clientX - this._lastX
    const dy = e.clientY - this._lastY
    this._lastX = e.clientX
    this._lastY = e.clientY
    this.yaw -= dx * this._dragSpeed
    this.pitch -= dy * this._dragSpeed
    const lim = Math.PI / 2 - 0.05
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch))
  }

  _onPointerUp() {
    this._dragging = false
  }

  /** Enable/disable the device-orientation input source. */
  async enableDeviceOrientation() {
    // iOS 13+ gate: must be called from a user gesture.
    const DOE = window.DeviceOrientationEvent
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission()
        if (res !== 'granted') return false
      } catch (err) {
        return false
      }
    }
    this._orientation = this._screenAngle()
    this._yawOffset = null
    this._hasDeviceData = false
    window.addEventListener('deviceorientation', this._onDeviceOrientation)
    window.addEventListener('orientationchange', this._onScreenOrientation)
    this.useDeviceOrientation = true
    return true
  }

  disableDeviceOrientation() {
    window.removeEventListener('deviceorientation', this._onDeviceOrientation)
    window.removeEventListener('orientationchange', this._onScreenOrientation)
    this.useDeviceOrientation = false
  }

  _screenAngle() {
    const a =
      (screen.orientation && screen.orientation.angle) ||
      window.orientation ||
      0
    return THREE.MathUtils.degToRad(a)
  }

  _onScreenOrientation() {
    this._orientation = this._screenAngle()
  }

  _onDeviceOrientation(e) {
    if (e.alpha == null) return
    this._alpha = THREE.MathUtils.degToRad(e.alpha)
    this._beta = THREE.MathUtils.degToRad(e.beta || 0)
    this._gamma = THREE.MathUtils.degToRad(e.gamma || 0)
    this._hasDeviceData = true
  }

  /** Recenter: make wherever the user currently looks the new "forward". */
  recenter() {
    if (this.useDeviceOrientation) {
      this._yawOffset = null // recomputed on next frame
    } else {
      this.yaw = 0
      this.pitch = 0
    }
  }

  update() {
    if (!this.enabled) return

    if (this.useDeviceOrientation && this._hasDeviceData) {
      // Compose the device quaternion in three.js space.
      this._deviceEuler.set(this._beta, this._alpha, -this._gamma, 'YXZ')
      this._deviceQuat.setFromEuler(this._deviceEuler)
      this._deviceQuat.multiply(this._worldTransform)
      this._deviceQuat.multiply(
        this._screenTransform.setFromAxisAngle(this._zee, -this._orientation)
      )

      // Capture initial yaw so the first look faces -Z (into the scene).
      if (this._yawOffset === null) {
        const e = new THREE.Euler().setFromQuaternion(this._deviceQuat, 'YXZ')
        this._yawOffset = e.y
      }
      this.camera.quaternion.copy(this._deviceQuat)
      // Apply yaw offset around world-up so content sits in front.
      const offset = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        -this._yawOffset
      )
      this.camera.quaternion.premultiply(offset)
    } else {
      // Drag mode: yaw around world up, pitch around local right.
      const q = new THREE.Quaternion()
      q.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'))
      this.camera.quaternion.copy(q)
    }
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this._onPointerDown)
    window.removeEventListener('pointermove', this._onPointerMove)
    window.removeEventListener('pointerup', this._onPointerUp)
    this.disableDeviceOrientation()
  }
}
