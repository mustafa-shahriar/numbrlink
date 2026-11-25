import { createSignal } from 'solid-js'

const MUTE_KEY = 'numbrlink:muted'

export const [muted, setMutedSignal] = createSignal(readMuted())

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function toggleMuted() {
  const next = !muted()
  setMutedSignal(next)
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  } catch {
    /* ignore */
  }
}

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }
  return ctx
}

function tone(
  freq: number,
  duration = 0.08,
  type: OscillatorType = 'triangle',
  volume = 0.05,
  delay = 0,
) {
  const audio = getCtx()
  if (!audio) return
  const start = audio.currentTime + delay
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.linearRampToValueAtTime(volume, start + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain).connect(audio.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

export function soundTick(step: number) {
  if (muted()) return
  tone(300 + step * 34, 0.065, 'sine', 0.045)
}

export function soundMistake() {
  if (muted()) return
  tone(150, 0.12, 'sawtooth', 0.03)
  tone(108, 0.16, 'sawtooth', 0.024, 0.035)
}

export function soundCountdown(n: number) {
  if (muted()) return
  tone(n === 0 ? 760 : 420, n === 0 ? 0.16 : 0.06, 'sine', n === 0 ? 0.05 : 0.028)
}

export function soundGo() {
  if (muted()) return
  tone(660, 0.1, 'triangle', 0.045)
  tone(990, 0.16, 'triangle', 0.035, 0.05)
}

export function soundWin() {
  if (muted()) return
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((frequency, index) => tone(frequency, 0.24, 'triangle', 0.048, index * 0.085))
}

export function soundJoin() {
  if (muted()) return
  tone(520, 0.07, 'sine', 0.035)
  tone(780, 0.09, 'sine', 0.03, 0.07)
}

export function soundTurn() {
  if (muted()) return
  tone(587.33, 0.08, 'sine', 0.032)
  tone(880, 0.13, 'sine', 0.027, 0.085)
}
