import { generateBoard, TOTAL_NUMBERS } from '../shared/board.js'
import { COUNTDOWN_MS, MAX_POINTS, TURN_MS, validateLink } from '../shared/rules.js'

const MAX_PLAYERS = 4
const REJOIN_GRACE_MS = 15_000
const MAX_MESSAGE_BYTES = 24_000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const LINK_COUNT = TOTAL_NUMBERS - 1

/** @type {Map<string, Room>} */
const rooms = new Map()
let playerSeq = 0

/**
 * @typedef {{ id: string, name: string, seat: number, status: 'idle'|'active'|'out'|'won',
 *   failReason: string | null, links: number, connected: boolean,
 *   ws: import('ws').WebSocket | null, graceTimer: NodeJS.Timeout | null }} Player
 * @typedef {{ by: string, points: { x: number, y: number }[] }} Link
 * @typedef {{ code: string, hostId: string | null, status: 'lobby'|'countdown'|'playing'|'done',
 *   round: number, seed: number, startAt: number, order: string[], turnId: string | null,
 *   turnDeadline: number, links: Link[], winnerId: string | null,
 *   players: Map<string, Player>, timer: NodeJS.Timeout | null,
 *   deadlineTimer: NodeJS.Timeout | null }} Room
 */

function cleanName(input) {
  const name = String(input ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 16)
  return name || 'Player'
}

function nextSeat(room) {
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (![...room.players.values()].some((p) => p.seat === seat)) return seat
  }
  return room.players.size % MAX_PLAYERS
}

function makePlayer(name, seat) {
  return {
    id: `p${++playerSeq}`,
    name: cleanName(name),
    seat,
    status: 'idle',
    failReason: null,
    links: 0,
    connected: true,
    ws: null,
    graceTimer: null,
  }
}

function newRoomCode() {
  let code = ''
  do {
    code = ''
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    }
  } while (rooms.has(code))
  return code
}

function publicRoom(room) {
  const linkIndex = room.links.length
  const open = room.status === 'playing' && linkIndex < LINK_COUNT
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    round: room.round,
    seed: room.seed,
    startAt: room.startAt,
    turnId: room.turnId,
    turnDeadline: room.turnDeadline,
    nextFrom: open ? linkIndex + 1 : null,
    nextTo: open ? linkIndex + 2 : null,
    links: room.links,
    winnerId: room.winnerId,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      status: p.status,
      failReason: p.failReason,
      links: p.links,
      connected: p.connected,
    })),
  }
}

function send(ws, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload))
}

function fail(ws, code, message) {
  send(ws, { type: 'error', code, message })
}

function broadcast(room) {
  const message = JSON.stringify({ type: 'room', room: publicRoom(room) })
  for (const player of room.players.values()) {
    if (player.ws && player.ws.readyState === 1) player.ws.send(message)
  }
}

function contextFor(ws) {
  const room = ws.roomCode ? rooms.get(ws.roomCode) : undefined
  const player = room && ws.playerId ? room.players.get(ws.playerId) : undefined
  return { room, player }
}

function attach(ws, room, player) {
  const previous = player.ws
  ws.roomCode = room.code
  ws.playerId = player.id
  player.ws = ws
  player.connected = true
  if (player.graceTimer) {
    clearTimeout(player.graceTimer)
    player.graceTimer = null
  }
  if (previous && previous !== ws) {
    // The same session was opened elsewhere (e.g. a duplicated tab). Tell the
    // old client to stop reconnecting instead of letting the two sockets fight.
    send(previous, { type: 'superseded' })
    previous.roomCode = null
    previous.playerId = null
    try {
      previous.close()
    } catch {
      /* ignore */
    }
  }
}

function detach(ws) {
  const { room, player } = contextFor(ws)
  if (room && player && player.ws === ws) {
    player.ws = null
    player.connected = false
  }
  ws.roomCode = null
  ws.playerId = null
}

function deleteRoom(room) {
  clearTimeout(room.timer)
  clearTimeout(room.deadlineTimer)
  for (const player of room.players.values()) {
    clearTimeout(player.graceTimer)
    if (player.ws) {
      player.ws.roomCode = null
      player.ws.playerId = null
    }
  }
  rooms.delete(room.code)
}

function clearGameTimers(room) {
  clearTimeout(room.timer)
  clearTimeout(room.deadlineTimer)
  room.timer = null
  room.deadlineTimer = null
}

function activePlayers(room) {
  return [...room.players.values()].filter((p) => p.status === 'active')
}

function orderList(room) {
  return room.order.filter((id) => room.players.has(id))
}

function nextActive(room, afterId) {
  const list = orderList(room)
  if (!list.length) return null
  const start = list.indexOf(afterId)
  for (let step = 1; step <= list.length; step++) {
    const id = list[(((start + step) % list.length) + list.length) % list.length]
    if (room.players.get(id)?.status === 'active') return id
  }
  return null
}

/** Ends the round once at most one player is left. Returns true when it ended. */
function maybeEnd(room) {
  if (room.status !== 'playing') return room.status === 'done'
  const remaining = activePlayers(room)
  if (remaining.length > 1) return false

  room.status = 'done'
  room.winnerId = remaining[0]?.id ?? null
  if (remaining[0]) remaining[0].status = 'won'
  room.turnId = null
  room.turnDeadline = 0
  clearGameTimers(room)
  return true
}

function endRound(room, winnerId) {
  room.status = 'done'
  room.winnerId = winnerId
  const winner = room.players.get(winnerId)
  if (winner) winner.status = 'won'
  room.turnId = null
  room.turnDeadline = 0
  clearGameTimers(room)
}

function beginTurn(room, playerId) {
  if (room.status !== 'playing') return
  let id = playerId
  if (room.players.get(id)?.status !== 'active') id = nextActive(room, id)
  if (!id) {
    maybeEnd(room)
    return
  }

  const linkIndex = room.links.length
  room.turnId = id
  room.turnDeadline = Date.now() + TURN_MS
  clearTimeout(room.deadlineTimer)

  room.deadlineTimer = setTimeout(() => {
    if (room.status !== 'playing' || room.turnId !== id || room.links.length !== linkIndex) return
    const player = room.players.get(id)
    if (!player || player.status !== 'active') return
    failTurn(room, player, 'timeout')
  }, TURN_MS + 20)
}

function failTurn(room, player, reason) {
  clearTimeout(room.deadlineTimer)
  room.deadlineTimer = null
  player.status = 'out'
  player.failReason = reason
  room.turnId = null
  room.turnDeadline = 0
  if (!maybeEnd(room)) beginTurn(room, nextActive(room, player.id))
  broadcast(room)
}

function startRound(room) {
  clearGameTimers(room)
  room.round += 1
  room.seed = Math.floor(Math.random() * 2_147_483_647)
  room.startAt = Date.now() + COUNTDOWN_MS
  room.status = 'countdown'
  room.order = [...room.players.values()].map((p) => p.id)
  room.links = []
  room.winnerId = null
  room.turnId = null
  room.turnDeadline = 0

  for (const player of room.players.values()) {
    player.status = 'active'
    player.failReason = null
    player.links = 0
  }

  const roundId = room.round
  broadcast(room)

  room.timer = setTimeout(() => {
    if (room.status !== 'countdown' || room.round !== roundId) return
    room.status = 'playing'
    beginTurn(room, room.order[0])
    broadcast(room)
  }, COUNTDOWN_MS)
}

function removePlayer(room, playerId) {
  const player = room.players.get(playerId)
  if (!player) return

  clearTimeout(player.graceTimer)
  const wasTurn = room.turnId === playerId
  if (room.status === 'playing' && player.status === 'active') {
    player.status = 'out'
    player.failReason = 'left'
  }

  room.players.delete(playerId)
  if (player.ws) {
    player.ws.roomCode = null
    player.ws.playerId = null
  }
  if (room.hostId === playerId) {
    room.hostId = room.players.values().next().value?.id ?? null
  }

  if (room.players.size === 0) {
    deleteRoom(room)
    return
  }

  if (room.status === 'countdown' && room.players.size < 2) {
    // Everyone else left during the countdown — drop back to the lobby.
    clearGameTimers(room)
    room.status = 'lobby'
    room.startAt = 0
    room.turnId = null
    for (const remaining of room.players.values()) {
      remaining.status = 'idle'
      remaining.failReason = null
      remaining.links = 0
    }
  } else if (room.status === 'playing') {
    if (wasTurn) {
      room.turnId = null
      room.turnDeadline = 0
      clearTimeout(room.deadlineTimer)
    }
    if (!maybeEnd(room) && wasTurn) {
      beginTurn(room, nextActive(room, playerId))
    }
  }

  broadcast(room)
}

function handleCreate(ws, msg) {
  const current = contextFor(ws)
  if (current.room && current.player) removePlayer(current.room, current.player.id)
  detach(ws)

  const player = makePlayer(msg.name, 0)
  /** @type {Room} */
  const room = {
    code: newRoomCode(),
    hostId: player.id,
    status: 'lobby',
    round: 0,
    seed: 0,
    startAt: 0,
    order: [player.id],
    turnId: null,
    turnDeadline: 0,
    links: [],
    winnerId: null,
    players: new Map([[player.id, player]]),
    timer: null,
    deadlineTimer: null,
  }
  rooms.set(room.code, room)
  attach(ws, room, player)
  send(ws, { type: 'joined', room: publicRoom(room), you: player.id })
}

function handleJoin(ws, msg) {
  const code = String(msg.code ?? '').trim().toUpperCase()
  const room = rooms.get(code)
  if (!room) {
    return fail(ws, 'no-room', 'Room not found. Double-check the code.')
  }
  if (room.status !== 'lobby') {
    return fail(ws, 'in-progress', 'That match is already running. Ask the host for a rematch.')
  }
  if (room.players.size >= MAX_PLAYERS) {
    return fail(ws, 'full', 'That room is full (4 players max).')
  }

  const current = contextFor(ws)
  if (current.room && current.player) removePlayer(current.room, current.player.id)
  detach(ws)
  const player = makePlayer(msg.name, nextSeat(room))
  room.players.set(player.id, player)
  attach(ws, room, player)
  send(ws, { type: 'joined', room: publicRoom(room), you: player.id })
  broadcast(room)
}

function handleRejoin(ws, msg) {
  const room = rooms.get(String(msg.code ?? '').trim().toUpperCase())
  const player = room?.players.get(String(msg.id ?? ''))
  if (!room || !player) {
    return fail(ws, 'rejoin-failed', 'Your room is no longer available.')
  }
  attach(ws, room, player)
  send(ws, { type: 'joined', room: publicRoom(room), you: player.id })
  broadcast(room)
}

function handleStart(ws) {
  const { room, player } = contextFor(ws)
  if (!room || !player) return
  if (room.hostId !== player.id) {
    return fail(ws, 'not-host', 'Only the host can start the match.')
  }
  if (room.status === 'playing' || room.status === 'countdown') return
  if (room.players.size < 2) {
    return fail(ws, 'need-players', 'Invite at least one more player to start.')
  }
  startRound(room)
}

function cleanPath(input) {
  if (!Array.isArray(input)) return null
  if (input.length < 2 || input.length > MAX_POINTS) return null
  const points = []
  for (const raw of input) {
    const x = Number(raw?.x)
    const y = Number(raw?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    points.push({ x: Math.round(x * 10_000) / 10_000, y: Math.round(y * 10_000) / 10_000 })
  }
  return points
}

function handleDraw(ws, msg) {
  const { room, player } = contextFor(ws)
  if (!room || !player) return
  if (room.status !== 'playing' || room.turnId !== player.id) return
  if (player.status !== 'active') return

  const path = cleanPath(msg.path)
  if (!path) return

  const nodes = generateBoard(room.seed)
  const result = validateLink({
    nodes,
    links: room.links.map((link) => link.points),
    linkIndex: room.links.length,
    path,
  })

  if (!result.ok) {
    failTurn(room, player, result.reason)
    return
  }

  clearTimeout(room.deadlineTimer)
  room.deadlineTimer = null
  room.links.push({ by: player.id, points: path })
  player.links += 1

  if (room.links.length >= LINK_COUNT) {
    endRound(room, player.id)
  } else {
    beginTurn(room, nextActive(room, player.id))
  }
  broadcast(room)
}

function handleLeave(ws) {
  const { room, player } = contextFor(ws)
  if (!room || !player) return
  removePlayer(room, player.id)
  ws.roomCode = null
  ws.playerId = null
}

/**
 * Wire the room protocol onto a WebSocketServer. Used by the standalone Node
 * server and by the Vercel function entrypoint.
 */
export function attachRooms(wss) {
  wss.on('connection', (ws) => {
    ws.isAlive = true
    ws.roomCode = null
    ws.playerId = null

    ws.on('pong', () => {
      ws.isAlive = true
    })

    ws.on('message', (raw) => {
      const text = raw.toString()
      if (text.length > MAX_MESSAGE_BYTES) return
      let msg
      try {
        msg = JSON.parse(text)
      } catch {
        return
      }
      if (!msg || typeof msg.type !== 'string') return

      switch (msg.type) {
        case 'create':
          handleCreate(ws, msg)
          break
        case 'join':
          handleJoin(ws, msg)
          break
        case 'rejoin':
          handleRejoin(ws, msg)
          break
        case 'start':
          handleStart(ws)
          break
        case 'draw':
          handleDraw(ws, msg)
          break
        case 'leave':
          handleLeave(ws)
          break
        case 'ping':
          send(ws, { type: 'pong' })
          break
        default:
          break
      }
    })

    ws.on('close', () => {
      const { room, player } = contextFor(ws)
      if (!room || !player || player.ws !== ws) {
        detach(ws)
        return
      }
      player.ws = null
      player.connected = false
      broadcast(room)

      player.graceTimer = setTimeout(() => {
        if (player.connected) return
        removePlayer(room, player.id)
      }, REJOIN_GRACE_MS)
    })
  })

  const keepAlive = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate()
        continue
      }
      ws.isAlive = false
      try {
        ws.ping()
      } catch {
        /* ignore */
      }
    }
  }, 30_000)

  wss.on('close', () => clearInterval(keepAlive))
}
