import { createSignal } from 'solid-js'

export type ConnectionState = 'connecting' | 'open' | 'offline'

export const [connection, setConnection] = createSignal<ConnectionState>('connecting')

type Message = Record<string, unknown>

let socket: WebSocket | null = null
let started = false
let stopped = false
let retryTimer: ReturnType<typeof setTimeout> | undefined

const messageHandlers = new Set<(msg: Message) => void>()
const openHandlers = new Set<() => void>()
const outbox: Message[] = []

export function onMessage(handler: (msg: Message) => void) {
  messageHandlers.add(handler)
  return () => messageHandlers.delete(handler)
}

export function onOpen(handler: () => void) {
  openHandlers.add(handler)
  return () => openHandlers.delete(handler)
}

export function connect() {
  if (started && !stopped) return
  started = true
  stopped = false
  openSocket()
}

/** Stop reconnecting (used when another tab takes over this session). */
export function halt() {
  stopped = true
  started = false
  clearTimeout(retryTimer)
  outbox.length = 0
  const current = socket
  socket = null
  try {
    current?.close()
  } catch {
    /* ignore */
  }
  setConnection('offline')
}

function openSocket() {
  if (stopped) return
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${protocol}://${location.host}/api/ws`)
  socket = ws
  setConnection('connecting')

  ws.onopen = () => {
    setConnection('open')
    // Restore an existing session first, then replay anything queued while offline.
    for (const handler of openHandlers) handler()
    while (outbox.length) {
      const msg = outbox.shift()
      if (msg) ws.send(JSON.stringify(msg))
    }
  }

  ws.onmessage = (event) => {
    let msg: Message
    try {
      msg = JSON.parse(String(event.data))
    } catch {
      return
    }
    for (const handler of messageHandlers) handler(msg)
  }

  ws.onerror = () => {
    try {
      ws.close()
    } catch {
      /* ignore */
    }
  }

  ws.onclose = () => {
    if (socket === ws) socket = null
    setConnection('offline')
    if (stopped) return
    clearTimeout(retryTimer)
    retryTimer = setTimeout(openSocket, 1500)
  }
}

export function send(msg: Message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg))
  } else {
    outbox.push(msg)
  }
}
