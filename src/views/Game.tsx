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
  type FatalState,
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
  const [soloDeadline, setSoloDeadline] = createSignal(0)
  const [soloStarted, setSoloStarted] = createSignal(0)
  const [soloTime, setSoloTime] = createSignal(0)
  const [newBest, setNewBest] = createSignal(false)
  const [soloFatal, setSoloFatal] = createSignal<FatalState | null>(null)

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
    setSoloDeadline(0)
    setSoloStarted(0)
    setSoloTime(0)
    setNewBest(false)
    setSoloFatal(null)
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
    finishSolo('timeout', {
      playerId: 'solo',
      linkIndex: soloLinks().length,
      reason: 'timeout',
      path: null,
      at: null,
    })
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

  function finishSolo(reason: string | null, fatal: FatalState | null = null) {
    if (soloStatus() !== 'playing') return
    setSoloStatus('done')
    setSoloFatal(reason ? fatal : null)
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
      const at =
        result.at ??
        (result.reason === 'not-at-target'
          ? points[points.length - 1]
          : result.reason === 'not-at-start'
            ? points[0]
            : null)
      finishSolo(result.reason, {
        playerId: 'solo',
        linkIndex: soloLinks().length,
        reason: result.reason,
        path: points,
        at,
      })
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

  const fatal = (): FatalState | null => (online() ? (room()?.fatal ?? null) : soloFatal())

  const fatalView = createMemo(() => {
    const current = fatal()
    if (!current) return null
    const from = current.linkIndex + 1
    return {
      path: current.path,
      at: current.at,
      label: reasonText(current.reason),
      from: from <= TOTAL ? from : null,
      to: from + 1 <= TOTAL ? from + 1 : null,
    }
  })

  const success = () => (online() ? room()?.winnerId === youId() : soloCompleted())

  type Segment = { text: string; tone?: 'bad' | 'good' }

  const fatalName = () => {
    const current = fatal()
    if (!current) return ''
    if (current.playerId === 'solo' || current.playerId === youId()) return 'You'
    return players().find((player) => player.id === current.playerId)?.name ?? 'A player'
  }

  const fatalSpan = (linkIndex: number) =>
    linkIndex + 1 <= LINK_COUNT ? ` while linking ${linkIndex + 1} → ${linkIndex + 2}` : ''

  /** Plain-English account of how the match ended. */
  const decisiveSegments = (): Segment[] => {
    if (!online()) {
      if (soloCompleted()) {
        return [{ text: `You closed 14 → 15 in ${formatTime(soloTime())}.`, tone: 'good' }]
      }
      const current = soloFatal()
      if (!current) return [{ text: `You linked ${soloLinks().length} of ${LINK_COUNT}.` }]
      return [
        { text: 'You ' },
        { text: reasonText(current.reason), tone: 'bad' },
        { text: `${fatalSpan(current.linkIndex)}.` },
      ]
    }

    if (chainComplete()) {
      const current = winner()
      const who = current?.id === youId() ? 'You' : (current?.name ?? 'Someone')
      return [{ text: `${who} closed the final link 14 → 15.`, tone: current?.id === youId() ? 'good' : undefined }]
    }

    const current = fatal()
    if (!current) {
      const currentWinner = winner()
      if (!currentWinner) return [{ text: 'The board won.' }]
      return [
        currentWinner.id === youId()
          ? { text: 'You were the last one standing.' }
          : { text: `${currentWinner.name} was the last one standing.` },
      ]
    }

    return [
      { text: `${fatalName()} ` },
      { text: reasonText(current.reason), tone: 'bad' },
      { text: `${fatalSpan(current.linkIndex)}.` },
    ]
  }

  function playerStateText(player: PlayerState) {
    if (!online()) return ''
    if (player.status === 'won') return 'winner'
    if (player.status === 'out') return `out — ${reasonText(player.failReason)}`
    if (room()?.turnId === player.id) return 'drawing…'
    return 'waiting'
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
        <div class="board-column" classList={{ done: playStatus() === 'done' }}>
          <div class="board-shell" classList={{ compact: playStatus() === 'done' }}>
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
              fatal={fatalView()}
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
          </div>

          <Show when={playStatus() === 'done'}>
            <div class="over-panel" classList={{ win: success() }}>
              <div class="over-top">
                <span class="over-badge" classList={{ win: success() }}>
                  {online() ? (winner() ? '♛' : '✕') : soloCompleted() ? '✓' : '✕'}
                </span>

                <div class="over-copy">
                  <h2>{resultTitle()}</h2>
                  <p>
                    <For each={decisiveSegments()}>
                      {(segment) => (
                        <span classList={{ bad: segment.tone === 'bad', good: segment.tone === 'good' }}>
                          {segment.text}
                        </span>
                      )}
                    </For>
                  </p>
                </div>

                <div class="over-stats">
                  <span class="over-stat">
                    links <b>{linkIndex()}/{LINK_COUNT}</b>
                  </span>
                  <Show when={!online()}>
                    <span class="over-stat">
                      {soloCompleted() ? 'time' : 'best'}{' '}
                      <b>
                        {soloCompleted()
                          ? formatTime(soloTime())
                          : bestTime() !== null
                            ? formatTime(bestTime())
                            : '—'}
                      </b>
                    </span>
                    <Show when={newBest()}>
                      <span class="over-stat bright">new best</span>
                    </Show>
                  </Show>
                  <Show when={online()}>
                    <span class="over-stat">
                      room <b>{room()?.code}</b>
                    </span>
                  </Show>
                </div>
              </div>

              <div class="over-actions">
                <Show when={!online()}>
                  <button class="btn primary" onClick={() => startPractice()}>
                    Try again
                  </button>
                  <button class="btn ghost" onClick={() => goHome()}>
                    Back home
                  </button>
                </Show>

                <Show when={online()}>
                  <Show
                    when={isHost()}
                    fallback={<p class="fine-print over-wait">Waiting for the host to start a new match…</p>}
                  >
                    <button
                      class="btn primary"
                      disabled={connection() !== 'open'}
                      onClick={() => startRace()}
                    >
                      New match
                    </button>
                  </Show>
                  <button class="btn ghost" onClick={() => leaveRoom()}>
                    Leave room
                  </button>
                </Show>
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
