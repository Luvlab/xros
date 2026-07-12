import * as THREE from 'three'

/**
 * Builds the immersive environment: dark space, a subtle grid floor, a
 * starfield dome, and lighting. The camera sits at the origin and only rotates.
 */
export function createWorld(container) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x05060a)
  scene.fog = new THREE.FogExp2(0x05060a, 0.035)

  const camera = new THREE.PerspectiveCamera(
    70,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  )
  camera.position.set(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(renderer.domElement)

  // Lighting
  scene.add(new THREE.AmbientLight(0x8899ff, 0.8))
  const key = new THREE.PointLight(0x6af7ff, 1.2, 40)
  key.position.set(3, 6, 2)
  scene.add(key)
  const rim = new THREE.PointLight(0xb96bff, 0.9, 40)
  rim.position.set(-4, -2, -6)
  scene.add(rim)

  // Starfield
  scene.add(makeStars(1400, 40))

  // Grid floor
  const grid = new THREE.GridHelper(60, 60, 0x2a3170, 0x141838)
  grid.position.y = -3
  grid.material.transparent = true
  grid.material.opacity = 0.5
  scene.add(grid)

  return { scene, camera, renderer }
}

function makeStars(count, radius) {
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    // Points on a sphere shell
    const u = Math.random()
    const v = Math.random()
    const theta = 2 * Math.PI * u
    const phi = Math.acos(2 * v - 1)
    const r = radius * (0.7 + Math.random() * 0.3)
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    pos[i * 3 + 1] = r * Math.cos(phi)
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({
    color: 0x9fb0ff,
    size: 0.15,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
  })
  return new THREE.Points(geo, mat)
}
