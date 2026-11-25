import { Show, onCleanup, onMount } from 'solid-js'
import Game from './views/Game'
import Home from './views/Home'
import Lobby from './views/Lobby'
import { initNet, room, route, toast, type Route } from './store'

export default function App() {
  onMount(() => {
    const stop = initNet()
    onCleanup(stop)
  })

  const soloRoute = () => {
    const current = route()
    return current.kind === 'solo' ? (current as Extract<Route, { kind: 'solo' }>) : null
  }

  return (
    <div class="app">
      <Show
        when={room()}
        fallback={
          <Show when={soloRoute()} fallback={<Home />}>
            {(solo) => <Game mode="solo" seed={solo().seed} startAt={solo().startAt} />}
          </Show>
        }
      >
        {(current) => (
          <Show
            when={current().status === 'lobby'}
            fallback={<Game mode="online" seed={current().seed} startAt={current().startAt} />}
          >
            <Lobby />
          </Show>
        )}
      </Show>

      <Show when={toast()} keyed>
        {(message) => (
          <div class="toast" role="status">
            {message}
          </div>
        )}
      </Show>
    </div>
  )
}
