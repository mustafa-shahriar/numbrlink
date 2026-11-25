import { render } from 'solid-js/web'
import App from './App'
import { generateBoard } from './game/board'
import { room, youId } from './store'
import './styles.css'

// Opt-in inspection hook for local development (?debug=1).
if (import.meta.env.DEV && new URLSearchParams(location.search).has('debug')) {
  ;(window as unknown as Record<string, unknown>).__numbrlink = { room, youId, generateBoard }
}

render(() => <App />, document.getElementById('root')!)
