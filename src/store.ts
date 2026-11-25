import { batch, createSignal } from 'solid-js'
import { connect, halt, onMessage, onOpen, send } from './net/socket'
import type { Point } from './game/rules'

export type PlayerStatus = 'idle' | 'active' | 'out' | 'won'

export type PlayerState = {
  id: string
  name: string
  seat: number
  status: PlayerStatus
  failReason: string | null
  links: number
  connected: boolean
}

export type LinkState = {
  by: string
  points: Point[]
}

export type RoomStatus = 'lobby' | 'countdown' | 'playing' | 'done'

export type RoomState = {
  code: string
  hostId: string | null
  status: RoomStatus
  round: number
  seed: number
  startAt: number
  turnId: string | null
  turnDeadline: number
  nextFrom: number | null
  nextTo: number | null
  links: LinkState[]
  winnerId: string | null
  players: PlayerState[]
}

export type Route = { kind: 'home' } | { kind: 'solo'; seed: number; startAt: number }

export const TOTAL = 15
export const MAX_PLAYERS = 4

export const [room, setRoom] = createSignal<RoomState | null>(null)
export const [youId, setYouId] = createSignal<string | null>(null)
export const [route, setRoute] = createSignal<Route>({ kind: 'home' })
export const [toast, setToast] = createSignal<string | null>(null)

const NAME_KEY = 'numbrlink:name'
const SESSION_KEY = 'numbrlink:session'
const BEST_KEY = 'numbrlink:best'

function readStoredName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

export const [name, setName] = createSignal(readStoredName())

export function updateName(value: string) {
  const next = value.slice(0, 16)
  setName(next)
  try {
    localStorage.setItem(NAME_KEY, next)
  } catch {
    /* ignore */
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

export function showToast(message: string) {
  setToast(message)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => setToast(null), 3400)
}

function readBest(): number | null {
  try {
    const raw = localStorage.getItem(BEST_KEY)
    const value = raw ? Number(raw) : NaN
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

export const [bestTime, setBestTime] = createSignal<number | null>(readBest())

export function recordBestTime(ms: number): boolean {
  if (bestTime() !== null && ms >= bestTime()!) return false
  const rounded = Math.round(ms)
  setBestTime(rounded)
  try {
    localStorage.setItem(BEST_KEY, String(rounded))
  } catch {
    /* ignore */
  }
  return true
}

// ---------------------------------------------------------------------------
// Session helpers (per tab, so two tabs can play against each other)
// ---------------------------------------------------------------------------

type Session = { code: string; id: string }

function saveSession(session: Session) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    /* ignore */
  }
}

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.code === 'string' && typeof parsed?.id === 'string') return parsed
    return null
  } catch {
    return null
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Network actions
// ---------------------------------------------------------------------------

export function initNet() {
  connect()
  const offMessage = onMessage(handleMessage)
  const offOpen = onOpen(() => {
    const session = loadSession()
    if (session) send({ type: 'rejoin', code: session.code, id: session.id })
  })
  return () => {
    offMessage()
    offOpen()
  }
}

function handleMessage(raw: Record<string, unknown>) {
  const type = raw.type
  if (type === 'joined') {
    const nextRoom = raw.room as RoomState
    const id = raw.you as string
    batch(() => {
      setRoom(nextRoom)
      setYouId(id)
      setRoute({ kind: 'home' })
    })
    saveSession({ code: nextRoom.code, id })
    return
  }

  if (type === 'room') {
    setRoom(raw.room as RoomState)
    return
  }

  if (type === 'error') {
    const message = typeof raw.message === 'string' ? raw.message : 'Something went wrong.'
    showToast(message)
    if (raw.code === 'rejoin-failed') {
      clearSession()
      batch(() => {
        setRoom(null)
        setYouId(null)
      })
    }
    return
  }

  if (type === 'superseded') {
    halt()
    clearSession()
    batch(() => {
      setRoom(null)
      setYouId(null)
      setRoute({ kind: 'home' })
    })
    showToast('This session was opened in another tab.')
  }
}

export function createRoom() {
  connect()
  send({ type: 'create', name: name().trim() || 'Player' })
}

export function joinRoom(code: string) {
  connect()
  send({ type: 'join', code: code.trim().toUpperCase(), name: name().trim() || 'Player' })
}

export function leaveRoom() {
  send({ type: 'leave' })
  clearSession()
  batch(() => {
    setRoom(null)
    setYouId(null)
    setRoute({ kind: 'home' })
  })
}

export function startRace() {
  send({ type: 'start' })
}

export function sendDraw(path: Point[]) {
  send({ type: 'draw', path })
}

// ---------------------------------------------------------------------------
// Solo / navigation
// ---------------------------------------------------------------------------

export function startPractice() {
  setRoute({ kind: 'solo', seed: (Math.random() * 2_147_483_647) >>> 0, startAt: Date.now() + 3000 })
}

export function goHome() {
  setRoute({ kind: 'home' })
}
