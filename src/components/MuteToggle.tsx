import { Show } from 'solid-js'
import { muted, toggleMuted } from '../game/audio'

export function SpeakerIcon(props: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9.5h3l4-3.2v11.4l-4-3.2H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z"
        fill="currentColor"
      />
      <Show
        when={!props.muted}
        fallback={<path d="m16 9 5 6m0-6-5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />}
      >
        <path
          d="M15.5 8.5a5 5 0 0 1 0 7M18.2 6a8.5 8.5 0 0 1 0 12"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
      </Show>
    </svg>
  )
}

export default function MuteToggle() {
  return (
    <button
      class="icon-btn mute-inline"
      onClick={() => toggleMuted()}
      aria-label={muted() ? 'Unmute sounds' : 'Mute sounds'}
      title={muted() ? 'Unmute sounds' : 'Mute sounds'}
    >
      <SpeakerIcon muted={muted()} />
    </button>
  )
}
