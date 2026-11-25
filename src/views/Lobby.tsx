import { For, Show } from 'solid-js'
import Logo from '../components/Logo'
import MuteToggle from '../components/MuteToggle'
import { PLAYER_COLORS } from '../game/colors'
import { connection } from '../net/socket'
import { MAX_PLAYERS, leaveRoom, room, showToast, startRace, youId } from '../store'

export default function Lobby() {
  const state = () => room()!
  const isHost = () => state().hostId === youId()
  const emptySlots = () => Math.max(0, MAX_PLAYERS - state().players.length)

  async function copyInvite() {
    const link = `${location.origin}${location.pathname}?room=${state().code}`
    try {
      await navigator.clipboard.writeText(link)
      showToast('Invite link copied to clipboard')
    } catch {
      showToast(`Share this code: ${state().code}`)
    }
  }

  return (
    <main class="page lobby">
      <header class="lobby-top">
        <button class="icon-btn" onClick={() => leaveRoom()} aria-label="Leave room">
          ←
        </button>
        <div class="brandline">
          <Logo small />
          <span>NUMBRLINK</span>
        </div>
        <span class="chip subtle">{state().round > 0 ? `round ${state().round + 1}` : 'lobby'}</span>
        <MuteToggle />
      </header>

      <section class="panel lobby-panel">
        <div class="lobby-heading">
          <div>
            <div class="eyebrow">Match lobby</div>
            <h2>Invite the room</h2>
          </div>
          <span class="player-count">
            {state().players.length}/{MAX_PLAYERS}
          </span>
        </div>

        <div class="code-block">
          <div class="code-label">Room code</div>
          <div class="room-code" aria-label={`Room code ${state().code}`}>
            {state().code.split('').map((character) => (
              <span>{character}</span>
            ))}
          </div>
          <button class="btn small ghost" onClick={() => void copyInvite()}>
            Copy invite link
          </button>
        </div>

        <div class="player-list">
          <For each={state().players}>
            {(player, index) => (
              <div class="player-row" classList={{ me: player.id === youId() }}>
                <span
                  class="player-avatar"
                  style={{ '--player-color': PLAYER_COLORS[index() % PLAYER_COLORS.length] }}
                >
                  {player.name.slice(0, 1).toUpperCase()}
                </span>
                <div class="player-meta">
                  <span class="player-name">
                    {player.name}
                    <Show when={player.id === youId()}>
                      <span class="tag-you">you</span>
                    </Show>
                  </span>
                  <Show when={player.id === state().hostId}>
                    <span class="tag-host">host</span>
                  </Show>
                </div>
                <span class="player-status" classList={{ ready: player.connected }}>
                  {player.connected ? 'ready' : 'reconnecting…'}
                </span>
              </div>
            )}
          </For>
          <For each={Array.from({ length: emptySlots() })}>
            {() => (
              <div class="player-row empty">
                <span class="player-avatar empty">+</span>
                <div class="player-meta">
                  <span class="player-name">Waiting for player…</span>
                </div>
              </div>
            )}
          </For>
        </div>

        <Show
          when={isHost()}
          fallback={
            <div class="lobby-wait">
              <span class="pulse-dot" />
              Waiting for the host to start the match…
            </div>
          }
        >
          <button
            class="btn primary block"
            disabled={connection() !== 'open' || state().players.length < 2}
            onClick={() => startRace()}
          >
            Start match
          </button>
          <p class="fine-print center">
            {state().players.length < 2
              ? 'Invite at least one more player to start.'
              : 'Turn order follows this list. Everyone shares one board.'}
          </p>
        </Show>
      </section>
    </main>
  )
}
