export default function Logo(props: { small?: boolean }) {
  return (
    <span class="logo-mark" classList={{ small: props.small }} aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <defs>
          <linearGradient id="logo-trail" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#5ef2c0" />
            <stop offset="100%" stop-color="#a78bfa" />
          </linearGradient>
        </defs>
        <path
          d="M15 45 30 21l19 24"
          fill="none"
          stroke="url(#logo-trail)"
          stroke-width="4.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="15" cy="45" r="5.2" fill="#5ef2c0" />
        <circle cx="30" cy="21" r="5.2" fill="#7ef0e4" />
        <circle cx="49" cy="45" r="5.2" fill="#a78bfa" />
      </svg>
    </span>
  )
}
