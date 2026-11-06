// The welcome's sound, made in the browser: no file to download.

type AudioContextClass = typeof AudioContext

// When the sparks burst, after the glow starts to bloom (Particles.tsx).
const SPARKLE_AT = 0.2
// A bright major arpeggio, rising: C6, E6, G6, C7, E7.
const NOTES = [1046.5, 1318.5, 1568, 2093, 2637.0]
const VOLUME = 0.16

// Once per opening, however many times the effect runs (StrictMode runs it twice).
let lastPlayed = 0

/** A reverb tail: decaying noise as the room. */
function room(context: AudioContext, seconds: number) {
  const length = Math.floor(context.sampleRate * seconds)
  const impulse = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel)
    for (let index = 0; index < length; index++) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 3
    }
  }
  const convolver = context.createConvolver()
  convolver.buffer = impulse
  return convolver
}

/** One bell-like note: a sine with a faint octave above, struck and fading. */
function bell(context: AudioContext, out: AudioNode, frequency: number, at: number, gain: number) {
  for (const [ratio, level] of [
    [1, 1],
    [2, 0.18],
  ] as const) {
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency * ratio
    envelope.gain.setValueAtTime(0, at)
    envelope.gain.linearRampToValueAtTime(gain * level, at + 0.01)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 1.4)
    oscillator.connect(envelope).connect(out)
    oscillator.start(at)
    oscillator.stop(at + 1.5)
  }
}

/** A soft swell under it, as the glow blooms: a low fifth fading in and out. */
function swell(context: AudioContext, out: AudioNode, at: number) {
  for (const frequency of [261.6, 392]) {
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    oscillator.type = 'triangle'
    oscillator.frequency.value = frequency
    envelope.gain.setValueAtTime(0, at)
    envelope.gain.linearRampToValueAtTime(0.12, at + 0.35)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 1.6)
    oscillator.connect(envelope).connect(out)
    oscillator.start(at)
    oscillator.stop(at + 1.7)
  }
}

/**
 * Plays the welcome chime, if the browser lets the page make sound now (it
 * does after a click, like signing in). Never queued for later: late, it
 * would sound out of place, so a blocked chime is simply skipped.
 */
export async function playWelcomeChime() {
  if (Date.now() - lastPlayed < 2000) return
  lastPlayed = Date.now()
  const Context: AudioContextClass | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext
  if (!Context) return
  let context: AudioContext
  try {
    context = new Context()
  } catch {
    return
  }
  if (context.state === 'suspended') {
    // Resolves only once allowed; without a recent click it never does.
    await Promise.race([context.resume(), new Promise((resolve) => setTimeout(resolve, 150))])
  }
  if (context.state !== 'running') {
    void context.close()
    return
  }

  const master = context.createGain()
  master.gain.value = VOLUME
  master.connect(context.destination)
  const reverb = room(context, 2.4)
  const wet = context.createGain()
  wet.gain.value = 0.45
  reverb.connect(wet).connect(master)
  const out = context.createGain()
  out.connect(master)
  out.connect(reverb)

  const now = context.currentTime + 0.02
  swell(context, out, now)
  NOTES.forEach((frequency, index) => {
    bell(context, out, frequency, now + SPARKLE_AT + index * 0.075, 0.5 - index * 0.06)
  })
  window.setTimeout(() => void context.close(), 4000)
}
