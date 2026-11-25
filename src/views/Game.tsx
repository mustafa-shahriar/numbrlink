import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import CanvasBoard from '../components/CanvasBoard'
import MuteToggle from '../components/MuteToggle'
import { generateBoard } from '../game/board'
import { PLAYER_COLORS } from '../game/colors'
import { formatTime } from '../game/format'
import { reasonText, TURN_MS, validateLink, type Point } from '../game/rules'
import { soundCountdown, soundGo, soundMistake, soundTick, soundTurn, soundWin } from '../game/audio'
import { connection } from '../net/socket'
import {
  TOTAL,
  bestTime,
  goHome,
  leaveRoom,
  recordBestTime,
  room,
  sendDraw,
  startPractice,
  startRace,
  showToast,
  youId,
  type PlayerState,
} from '../store'

type Props = {
  mode: 'solo' | 'online'
  seed: number
  startAt: number
}

type LinkShape = { by: string; points: Point[] }
type PlayStatus = 'lobby' | 'countdown' | 'playing' | 'done'
type SoloStatus = 'ready' | 'playing' | 'done'

const LINK_COUNT = TOTAL - 1
const MINT = PLAYER_COLORS[0]

export default function Game(props: Props) {
  const [now, setNow] = createSignal(Date.now())
  const [soloLinks, setSoloLinks] = createSignal<LinkShape[]>([])
  const [soloStatus, setSoloStatus] = createSignal<SoloStatus>('ready')
  const [soloReason, setSoloReason] = createSignal<string | null>(null)
  const [soloDeadline, setSoloDeadline] = createSignal(0)
  const [soloStarted, setSoloStarted] = createSignal(0)
  const [soloTime, setSoloTime] = createSignal(0)
  const [newBest, setNewBest] = createSignal(false)

  let lastSeed: number | null = null
  let lastCount = ''
  let lastTurn: string | null = null
  let lastDone = false

  const online = () => props.mode === 'online'
  const players = () => (online() ? (room()?.players ?? []) : [])
  const me = () => players().find((player) => player.id === youId()) ?? null
  const isHost = () => room()?.hostId === youId()
  const nodes = createMemo(() => generateBoard(props.seed))

  const links = () => (online() ? (room()?.links ?? []) : soloLinks())
  const linkIndex = () => links().length

  const started = () => props.startAt <= now()
  const soloCompleted = () => soloLinks().length >= LINK_COUNT

  const playStatus = (): PlayStatus => {
    if (online()) return room()?.status ?? 'countdown'
    if (soloStatus() === 'done') return 'done'
    return started() ? 'playing' : 'countdown'
  }

  const turnId = () => {
    if (online()) return room()?.turnId ?? null
    return soloStatus() === 'playing' ? 'solo' : null
  }
  const turnDeadline = () => (online() ? (room()?.turnDeadline ?? 0) : soloDeadline())

  const turnPlayer = () => players().find((player) => player.id === room()?.turnId) ?? null

  const myTurn = () => {
    if (online()) {
      return room()?.status === 'playing' && room()?.turnId === youId() && me()?.status === 'active'
    }
    return soloStatus() === 'playing'
  }

  const canDraw = () => myTurn() && turnDeadline() > 0 && now() < turnDeadline()

  function seatColor(seat: number) {
    return PLAYER_COLORS[((seat % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length]
  }

  function colorOf(playerId: string) {
    if (playerId === 'solo') return MINT
    const player = players().find((entry) => entry.id === playerId)
    return seatColor(player?.seat ?? 0)
  }

  const myColor = () => {
    const player = me()
    return player ? seatColor(player.seat) : MINT
  }

  const turnColor = () => {
    const player = turnPlayer()
    return player ? seatColor(player.seat) : MINT
  }

  const turnLeft = () => Math.max(0, turnDeadline() - now())
  const turnDanger = () => myTurn() && turnLeft() > 0 && turnLeft() <= 5000

  createEffect(() => {
    const seed = props.seed
    if (seed === lastSeed) return
    lastSeed = seed
    setSoloLinks([])
    setSoloStatus('ready')
    setSoloReason(null)
    setSoloDeadline(0)
    setSoloStarted(0)
    setSoloTime(0)
    setNewBest(false)
    lastCount = ''
    lastTurn = null
  })

  onMount(() => {
    const clock = setInterval(() => setNow(Date.now()), 100)
    onCleanup(() => clearInterval(clock))
  })

  const countdownLabel = createMemo(() => {
    const status = playStatus()
    if (status === 'lobby' || status === 'done') return null
    const left = props.startAt - now()
    if (left > 0) return String(Math.min(3, Math.ceil(left / 1000)))
    if (now() - props.startAt < 650) return 'GO!'
    return null
  })

  createEffect(() => {
    const label = countdownLabel()
    if (!label || label === lastCount) return
    lastCount = label
    if (label === 'GO!') soundGo()
    else soundCountdown(Number(label))
  })

  createEffect(() => {
    if (online() || soloStatus() !== 'ready' || !started()) return
    setSoloStarted(props.startAt)
    setSoloStatus('playing')
    setSoloDeadline(Date.now() + TURN_MS)
  })

  createEffect(() => {
    if (online() || soloStatus() !== 'playing') return
    if (now() <= soloDeadline()) return
    finishSolo('timeout')
  })

  createEffect(() => {
    const id = turnId()
    if (id === lastTurn) return
    lastTurn = id
    if (!id) return
    if (!online() || id === youId()) soundTurn()
  })

  createEffect(() => {
    const done = playStatus() === 'done'
    if (done === lastDone) return
    lastDone = done
    if (!done) return
    const won = online() ? room()?.winnerId === youId() : soloCompleted()
    if (won) soundWin()
    else soundMistake()
  })

  function finishSolo(reason: string | null) {
    if (soloStatus() !== 'playing') return
    setSoloStatus('done')
    setSoloReason(reason)
    if (reason === null) {
      const time = Math.round(Date.now() - soloStarted())
      setSoloTime(time)
      setNewBest(recordBestTime(time))
    } else {
      setSoloTime(0)
    }
  }

  function handleCommit(points: Point[]) {
    if (online()) {
      if (!myTurn()) return
      sendDraw(points)
      return
    }
    if (soloStatus() !== 'playing') return
    const result = validateLink({
      nodes: nodes(),
      links: soloLinks().map((link) => link.points),
      linkIndex: soloLinks().length,
      path: points,
    })
    if (!result.ok) {
      finishSolo(result.reason)
      return
    }
    const next = [...soloLinks(), { by: 'solo', points }]
    setSoloLinks(next)
    soundTick(next.length)
    if (next.length >= LINK_COUNT) finishSolo(null)
    else setSoloDeadline(Date.now() + TURN_MS)
  }

  function exit() {
    if (online()) leaveRoom()
    else goHome()
  }

  const winner = () => players().find((player) => player.id === room()?.winnerId) ?? null
  const chainComplete = () => (room()?.links.length ?? 0) >= LINK_COUNT

  const resultTitle = () => {
    if (!online()) return soloCompleted() ? 'Chain complete' : 'Run over'
    if (!winner()) return 'Nobody survives'
    if (winner()!.id === youId()) return 'You win!'
    return `${winner()!.name} wins`
  }

  const resultSubtitle = () => {
    if (!online()) {
      if (soloCompleted()) {
        return newBest() ? 'A brand new personal best. Flawless wiring.' : 'All fourteen links, no crossings. Beautiful.'
      }
      return `You linked ${soloLinks().length} of ${LINK_COUNT} — ${reasonText(soloReason())}.`
    }
    if (!winner()) return 'Everyone crossed a line. The board won.'
    const mine = winner()!.id === youId()
    const name = mine ? 'You' : winner()!.name
    if (chainComplete()) return `${name} closed the final link ${TOTAL - 1} → ${TOTAL}.`
    return mine ? 'You were the last player standing.' : `${name} was the last player standing.`
  }

  function playerStateText(player: PlayerState) {
    if (!online()) return ''
    if (player.status === 'won') return 'winner'
    if (player.status === 'out') return `out — ${reasonText(player.failReason)}`
    if (room()?.turnId === player.id) return 'drawing…'
    return 'waiting'
  }

  const sortedPlayers = () => {
    const list = [...players()]
    list.sort((a, b) => {
      if (a.status === 'won') return -1
      if (b.status === 'won') return 1
      if (a.status === 'out' && b.status !== 'out') return 1
      if (b.status === 'out' && a.status !== 'out') return -1
      return b.links - a.links
    })
    return list
  }

  return (
    <main class="page game">
      <header class="topbar">
        <div class="topbar-side">
          <button class="icon-btn" onClick={exit} aria-label={online() ? 'Leave room' : 'Back home'}>
            ←
          </button>
          <span class="chip mono">{online() ? (room()?.code ?? '····') : 'SOLO'}</span>
        </div>

        <div class="timer-box">
          <span class="timer" classList={{ waiting: playStatus() !== 'playing', danger: turnDanger() }}>
            {playStatus() === 'playing' ? `${Math.ceil(turnLeft() / 1000)}s` : '—'}
          </span>
          <span class="timer-label">
            {playStatus() === 'playing'
              ? myTurn()
                ? 'your turn'
                : turnPlayer()
                  ? `${turnPlayer()!.name}'s turn`
                  : 'next turn'
              : playStatus() === 'done'
                ? 'match over'
                : 'get ready'}
          </span>
        </div>

        <div class="topbar-side end">
          <span class="chip">
            links <b class="mono">{linkIndex()}/{LINK_COUNT}</b>
          </span>
        </div>
      </header>

      <Show when={online()}>
        <div class="turn-strip">
          <For each={players()}>
            {(player) => (
              <div
                class="turn-player"
                classList={{
                  me: player.id === youId(),
                  turn: room()?.turnId === player.id,
                  out: player.status === 'out',
                  won: player.status === 'won',
                  offline: !player.connected,
                }}
                style={{ '--player-color': seatColor(player.seat) }}
              >
                <span class="turn-dot" />
                <div class="turn-meta">
                  <span class="turn-name">
                    {player.name}
                    <Show when={player.id === youId()}>
                      <span class="tag-you">you</span>
                    </Show>
                  </span>
                  <span class="turn-state">{playerStateText(player)}</span>
                </div>
                <span class="turn-links">{player.links}</span>
              </div>
            )}
          </For>
        </div>

        <Show when={me()?.status === 'out' && room()?.status === 'playing'}>
          <div class="spectate-banner">
            <span class="pulse-dot" />
            You are out — {reasonText(me()?.failReason)}. Watching the rest.
          </div>
        </Show>
      </Show>

      <div class="board-stage">
        <div class="board-shell">
          <CanvasBoard
            seed={props.seed}
            nodes={nodes()}
            links={links()}
            linkIndex={linkIndex()}
            status={playStatus()}
            enabled={canDraw()}
            deadline={turnDeadline()}
            turnId={turnId()}
            turnColor={turnColor()}
            myColor={myColor()}
            colorOf={colorOf}
            onCommit={handleCommit}
            onBadStart={() => showToast(`Start on the glowing number ${linkIndex() + 1}`)}
          />

          <Show when={countdownLabel()} keyed>
            {(label) => (
              <div class="countdown-overlay">
                <span class="countdown-eyebrow">Get ready</span>
                <span class="countdown-num" classList={{ go: label === 'GO!' }}>
                  {label}
                </span>
                <span class="countdown-hint">
                  {online() && players().length > 1
                    ? `Turn order: ${players().map((player) => player.name).join(' → ')}`
                    : 'Draw 1 → 2 without crossing a line'}
                </span>
              </div>
            )}
          </Show>

          <Show when={playStatus() === 'done'}>
            <div class="board-overlay">
              <div class="results-card">
                <div
                  class="results-badge"
                  classList={{
                    gold: online() ? room()?.winnerId === youId() : soloCompleted(),
                  }}
                >
                  {online() ? (winner() ? '♛' : '✕') : soloCompleted() ? '✓' : '✕'}
                </div>
                <h2>{resultTitle()}</h2>
                <p class="results-sub">{resultSubtitle()}</p>

                <Show when={!online()}>
                  <div class="solo-result">
                    <div class="big-time" classList={{ failed: !soloCompleted() }}>
                      {soloCompleted() ? formatTime(soloTime()) : `${soloLinks().length}/${LINK_COUNT}`}
                    </div>
                    <div class="solo-meta">
                      <span>{soloCompleted() ? (newBest() ? 'new best' : 'links') : 'links before failing'}</span>
                      <Show when={bestTime() !== null && !newBest()}>
                        <span>best {formatTime(bestTime())}</span>
                      </Show>
                    </div>
                  </div>
                </Show>

                <Show when={online()}>
                  <div class="result-list">
                    <For each={sortedPlayers()}>
                      {(player) => (
                        <div class="result-row" classList={{ me: player.id === youId() }}>
                          <span class="result-rank" style={{ '--player-color': seatColor(player.seat) }}>
                            {player.status === 'won' ? '♛' : player.status === 'out' ? '✕' : '•'}
                          </span>
                          <div class="result-main">
                            <div class="result-name">
                              {player.name}
                              <Show when={player.id === youId()}>
                                <span class="tag-you">you</span>
                              </Show>
                              <Show when={!player.connected}>
                                <span class="tag-host">offline</span>
                              </Show>
                            </div>
                            <div class="result-sub">
                              {player.status === 'won'
                                ? 'winner'
                                : player.status === 'out'
                                  ? reasonText(player.failReason)
                                  : 'still standing'}{' '}
                              · {player.links} link{player.links === 1 ? '' : 's'}
                            </div>
                          </div>
                          <span class="result-time">
                            {player.status === 'won' ? 'WIN' : player.status === 'out' ? 'OUT' : 'ALIVE'}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <div class="results-actions">
                  <Show when={!online()}>
                    <button class="btn primary block" onClick={() => startPractice()}>
                      Try again
                    </button>
                    <button class="btn ghost block" onClick={() => goHome()}>
                      Back home
                    </button>
                  </Show>

                  <Show when={online()}>
                    <Show
                      when={isHost()}
                      fallback={<p class="fine-print center">Waiting for the host to start a new match…</p>}
                    >
                      <button
                        class="btn primary block"
                        disabled={connection() !== 'open'}
                        onClick={() => startRace()}
                      >
                        New match
                      </button>
                    </Show>
                    <button class="btn ghost block" onClick={() => leaveRoom()}>
                      Leave room
                    </button>
                  </Show>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </div>

      <footer class="game-foot">
        <span>
          <b>Drag</b> freehand from the glowing number to the next. Don't cross a line.
        </span>
        <Show when={online()}>
          <span class="foot-code">room {room()?.code}</span>
        </Show>
        <MuteToggle />
      </footer>
    </main>
  )
}
