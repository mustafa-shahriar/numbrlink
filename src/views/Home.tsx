import { Show, createSignal } from 'solid-js'
import Logo from '../components/Logo'
import MuteToggle from '../components/MuteToggle'
import { formatTime } from '../game/format'
import { connection } from '../net/socket'
import { bestTime, createRoom, joinRoom, name, showToast, startPractice, updateName } from '../store'

export default function Home() {
  const invited = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? ''
  const [code, setCode] = createSignal(invited.slice(0, 4))

  const onlineReady = () => connection() === 'open'
  const canJoin = () => code().trim().length === 4

  const statusText = () => {
    if (connection() === 'open') return 'Online and ready'
    if (connection() === 'connecting') return 'Connecting to server…'
    return 'Offline — click to connect'
  }

  function handleCreate() {
    if (!onlineReady()) showToast('Connecting to the server…')
    createRoom()
  }

  function handleJoin() {
    if (!onlineReady()) showToast('Connecting to the server…')
    joinRoom(code())
  }

  return (
    <main class="page home">
      <section class="home-hero">
        <div class="eyebrow">
          <span class="live-dot" />
          Turn-based line duel
        </div>
        <h1>
          Connect <span class="grad">1 → 15</span>
          <br />
          without crossing a line.
        </h1>
        <p class="lede">
          One board, one shared chain. Players take turns drawing the next link freehand — 1 to 2, 2
          to 3, all the way to 15. Clip an existing stroke and you're out. Survive the board and you
          win.
        </p>

        <ol class="steps">
          <li>
            <span class="step-num">01</span>
            <div>
              <strong>Take turns</strong>
              <span>Turn order follows the lobby. One stroke per turn, twenty seconds each.</span>
            </div>
          </li>
          <li>
            <span class="step-num">02</span>
            <div>
              <strong>Draw freehand</strong>
              <span>Curve around the lines already on the board to reach the next number.</span>
            </div>
          </li>
          <li>
            <span class="step-num">03</span>
            <div>
              <strong>Last one standing</strong>
              <span>Cross a line, miss the target or time out — and you're eliminated.</span>
            </div>
          </li>
        </ol>

        <Show when={bestTime() !== null}>
          <div class="solo-best">
            <span>Solo best</span>
            <strong>{formatTime(bestTime())}</strong>
          </div>
        </Show>
      </section>

      <section class="panel home-panel">
        <div class="panel-brand">
          <Logo />
          <div>
            <div class="panel-title">NUMBRLINK</div>
            <div class="panel-sub">{statusText()}</div>
          </div>
          <div class="panel-brand-actions">
            <MuteToggle />
            <span class="status-dot" classList={{ on: onlineReady() }} title={onlineReady() ? 'Online' : 'Offline'} />
          </div>
        </div>

        <label class="field">
          <span>Your name</span>
          <input
            type="text"
            value={name()}
            maxLength={16}
            placeholder="Player"
            autocomplete="nickname"
            onInput={(event) => updateName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleCreate()
            }}
          />
        </label>

        <button class="btn primary block" onClick={handleCreate}>
          Create online room
        </button>

        <div class="divider">
          <span>or join with a code</span>
        </div>

        <div class="join-row">
          <input
            class="code-input"
            type="text"
            inputmode="text"
            autocomplete="off"
            spellcheck={false}
            maxLength={4}
            placeholder="CODE"
            aria-label="Room code"
            value={code()}
            onInput={(event) => setCode(event.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canJoin()) handleJoin()
            }}
          />
          <button class="btn" disabled={!canJoin()} onClick={handleJoin}>
            Join
          </button>
        </div>

        <Show when={invited}>
          <p class="invite-note">Invite loaded — hit join to hop into the match.</p>
        </Show>

        <div class="or-line" />

        <button class="btn ghost block" onClick={startPractice}>
          Practice solo
          <span class="key-hint">same rules, no friends</span>
        </button>

        <p class="fine-print">
          2–4 players per room. Everyone shares one board and takes turns drawing the next link.
        </p>
      </section>
    </main>
  )
}
