import { useEffect, useEffectEvent, useRef } from 'react'
import {
  ACESFilmicToneMapping,
  AnimationClip,
  AnimationMixer,
  DirectionalLight,
  Group,
  Mesh,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Timer,
  WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import mascotUrl from '../assets/brainbro-mascot.glb?url'

// The model stands on its origin, about 2.2 units tall; its body center is here.
const BODY_CENTER = 1.05
const ENTRANCE_SECONDS = 1.1
// A slight three-quarter view, as in the brand renders.
const RESTING_TURN = 0.22

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
function easeOutBack(t: number) {
  const overshoot = 1.9
  return 1 + (overshoot + 1) * (t - 1) ** 3 + overshoot * (t - 1) ** 2
}

/**
 * The 3D Blob: spins up from nothing, then idles, blinks and turns toward the
 * pointer. Loaded lazily, so three.js only downloads with the welcome screen.
 */
export default function MascotStage({
  still,
  onReady,
  onError,
}: {
  /** Reduced motion: no entrance and no idle animation. */
  still: boolean
  onReady: () => void
  onError: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  // The scene is built once, whatever the callbacks' identity.
  const ready = useEffectEvent(onReady)
  const fail = useEffectEvent(onError)

  useEffect(() => {
    const element = host.current
    if (!element) return

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      fail()
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    element.appendChild(renderer.domElement)

    const scene = new Scene()
    const pmrem = new PMREMGenerator(renderer)
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = environment
    // A warm key light from the upper left, over the even room light.
    const key = new DirectionalLight('#fff4e6', 1.2)
    key.position.set(-3, 5, 4)
    scene.add(key)

    const camera = new PerspectiveCamera(30, 1, 0.1, 100)
    camera.position.set(0, BODY_CENTER + 0.15, 6.4)
    camera.lookAt(0, BODY_CENTER, 0)

    // Turns and scales around the body's center, not its feet.
    const pivot = new Group()
    pivot.position.y = BODY_CENTER
    scene.add(pivot)

    const resize = () => {
      const { width, height } = element.getBoundingClientRect()
      if (!width || !height) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)

    // Where the pointer is, from -1 to 1 across the window.
    const pointer = { x: 0, y: 0 }
    const onPointerMove = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1
    }
    if (!still) window.addEventListener('pointermove', onPointerMove)

    const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`)
    draco.setDecoderConfig({ type: 'wasm' })
    const loader = new GLTFLoader().setDRACOLoader(draco)
    const timer = new Timer()
    let mixer: AnimationMixer | null = null
    let shownAt: number | null = null
    let disposed = false

    loader.load(
      mascotUrl,
      (gltf) => {
        if (disposed) return
        gltf.scene.position.y = -BODY_CENTER
        pivot.add(gltf.scene)
        const clip = AnimationClip.findByName(gltf.animations, 'BlinkIdle')
        if (clip && !still) {
          mixer = new AnimationMixer(gltf.scene)
          mixer.clipAction(clip).play()
        }
        shownAt = timer.getElapsed()
        ready()
      },
      undefined,
      () => {
        if (!disposed) fail()
      },
    )

    renderer.setAnimationLoop((time) => {
      timer.update(time)
      const elapsed = timer.getElapsed()
      mixer?.update(timer.getDelta())

      if (shownAt === null) {
        pivot.scale.setScalar(0)
      } else if (still) {
        pivot.scale.setScalar(1)
        pivot.rotation.set(0, RESTING_TURN, 0)
      } else {
        const t = Math.min(1, (elapsed - shownAt) / ENTRANCE_SECONDS)
        pivot.scale.setScalar(Math.max(0.001, easeOutBack(t)))
        // A full turn that settles into the resting angle, rising as it grows.
        const spin = (1 - easeOutCubic(t)) * Math.PI * 2
        pivot.position.y = BODY_CENTER - (1 - easeOutCubic(t)) * 0.5
        // Then it follows the pointer, gently.
        const sway = Math.sin(elapsed * 0.7) * 0.06
        const lookY = RESTING_TURN + sway + pointer.x * 0.45
        const lookX = pointer.y * 0.18
        const settle = t < 1 ? 1 : 0.06
        pivot.rotation.y += (lookY - spin - pivot.rotation.y) * settle
        pivot.rotation.x += (lookX - pivot.rotation.x) * (t < 1 ? 1 : 0.06)
      }
      renderer.render(scene, camera)
    })

    return () => {
      disposed = true
      renderer.setAnimationLoop(null)
      observer.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      draco.dispose()
      pivot.traverse((object) => {
        if (!(object instanceof Mesh)) return
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => material.dispose())
      })
      environment.dispose()
      pmrem.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [still])

  return <div ref={host} className="size-full" aria-hidden="true" />
}
