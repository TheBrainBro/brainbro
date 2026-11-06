import { useEffect, useRef } from 'react'

// The mascot's palette: skin, light violet, strap gold, cheek pink, white.
const COLORS = ['#b9a2ee', '#dccff7', '#9b80e0', '#f2b630', '#f39bbf', '#ffffff']
const BURST = 150

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  age: number
  life: number
  drag: number
}

const random = (min: number, max: number) => min + Math.random() * (max - min)
const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)]

/**
 * A burst of glowing sparks from the center of the screen, then a slow drift
 * of motes rising around it. Nothing moves with reduced motion.
 */
export function Particles({ still, className = '' }: { still: boolean; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context || still) return

    const ratio = Math.min(window.devicePixelRatio, 2)
    let width = 0
    let height = 0
    const resize = () => {
      width = element.clientWidth
      height = element.clientHeight
      element.width = width * ratio
      element.height = height * ratio
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const particles: Particle[] = []
    for (let index = 0; index < BURST; index++) {
      const angle = random(0, Math.PI * 2)
      const speed = random(2, 13)
      particles.push({
        x: width / 2,
        y: height / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: random(0.8, 3.2),
        color: pick(COLORS),
        // Once the backdrop is dark: on a light page the sparks would wash out.
        age: -random(12, 20),
        life: random(50, 130),
        drag: random(0.93, 0.965),
      })
    }

    // A mote rising somewhere around the center.
    const mote = (): Particle => {
      const angle = random(0, Math.PI * 2)
      const distance = random(90, Math.min(width, height) * 0.55)
      return {
        x: width / 2 + Math.cos(angle) * distance,
        y: height / 2 + Math.sin(angle) * distance * 0.8,
        vx: random(-0.15, 0.15),
        vy: random(-0.6, -0.2),
        size: random(0.6, 2),
        color: pick(COLORS),
        age: 0,
        life: random(140, 260),
        drag: 1,
      }
    }

    let frame = 0
    let last = performance.now()
    let spawn = 0
    const draw = (now: number) => {
      // In 60 fps frames, so speeds hold on any refresh rate.
      const step = Math.min(3, (now - last) / 16.67)
      last = now
      spawn += step
      if (spawn > 5) {
        spawn = 0
        particles.push(mote())
      }

      context.clearRect(0, 0, width, height)
      context.globalCompositeOperation = 'lighter'
      for (let index = particles.length - 1; index >= 0; index--) {
        const particle = particles[index]
        particle.age += step
        if (particle.age < 0) continue
        if (particle.age > particle.life) {
          particles.splice(index, 1)
          continue
        }
        const drag = particle.drag ** step
        particle.vx *= drag
        particle.vy *= drag
        particle.x += particle.vx * step
        particle.y += particle.vy * step
        // Fades in fast, out slowly, and twinkles on the way.
        const progress = particle.age / particle.life
        const fade = Math.min(1, progress * 8) * (1 - progress) ** 1.4
        const twinkle = 0.75 + 0.25 * Math.sin(particle.age * 0.3 + particle.size * 10)
        const alpha = fade * twinkle
        context.globalAlpha = alpha * 0.25
        context.fillStyle = particle.color
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size * 3.5, 0, Math.PI * 2)
        context.fill()
        context.globalAlpha = alpha
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
        context.fill()
      }
      context.globalAlpha = 1
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [still])

  return <canvas ref={canvas} className={className} aria-hidden="true" />
}
