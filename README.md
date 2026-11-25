# Numbrlink

A turn-based multiplayer drawing game built with **SolidJS**. One board, one
shared chain: players take turns drawing a freehand line from the current number
to the next one — **1 → 2, 2 → 3, all the way to 15** — without crossing any line
already on the board.

Touch a line, leave the board, let go before the next number or run out of time
and you are eliminated. Last player standing wins — or whoever closes the final
14 → 15 link.

Inspired by the "can you connect 1 to 15 in order?" puzzle reels.

## How it plays

- **Shared chain.** Every player extends the same path on the same board.
- **Turns.** Turn order follows the lobby. One stroke per turn, 20 seconds each.
- **One attempt.** A stroke that crosses/touches an existing line, wanders off
  the board, or is released before the target number eliminates you on the spot.
- **Numbers are not obstacles.** You only cannot cross lines; number discs are
  drawn above the lines.
- **Win condition.** The last active player wins, or the player who completes
  link 14 → 15.

## Features

- **Solo practice** — same rules, no friends required.
- **Online rooms** for 2–4 players, joined by a 4-letter code or invite link.
- **Server-authoritative rules** — the room server re-validates every stroke with
  the same geometry module the client uses for live feedback.
- **Live cross-checking** — your stroke turns red the moment it clips a line.
- **Turn timer**, countdown, elimination reasons, results overlay and rematch.
- **Reconnect support** — reload mid-match and you rejoin your seat.
- **Deterministic boards** — the server sends a seed, everybody renders the same
  scatter. Sound effects and a mute toggle included.

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The same Node process serves the app and the
WebSocket endpoint at `/ws` (and `/api/ws`, matching production), so online play
works locally out of the box.

To try multiplayer on one machine, open the site in two separate tabs or
windows: create a room in one, copy the invite link, and join from the other.
`sessionStorage` is per-tab, so both players stay independent.

## Production (single server)

```bash
npm run build
npm start
```

`PORT` can be set to override the default port `3000`.

## Deploy to Vercel

The Vercel setup is: static Vite client + one WebSocket Function at `/api/ws`.

```bash
npx vercel@latest login
npx vercel@latest --prod
```

`vercel.json` pins the Vite framework, build command and `dist` output. Vercel
Functions serve WebSockets on all plans, but:

> **Caveat — in-memory rooms.** Rooms live in the memory of the function
> instance handling the connection, and Vercel does not guarantee that two
> players' connections land on the same instance. For a casual match both
> players usually connect to the same warm instance, but a room can split across
> instances or disappear when the instance is recycled. Two players joining
> from different regions may end up in different rooms entirely.
>
> Reliable public multiplayer needs either a single always-on Node server
> (`npm start` on Fly/Render/Railway/a VPS) or shared state + pub/sub
> (e.g. Redis) so every instance sees the same rooms. The standalone server is
> the recommended deployment for real play.

## Controls

- **Drag** freehand from the glowing number to the pulsing next number.
- Curving around existing strokes is allowed and expected.
- The arc around the target number shows how much time is left.
- Release early, leave the board, or clip a line and you are out.

## Tech

- [SolidJS](https://www.solidjs.com/) + Vite for the client
- HTML `<canvas>` rendering with pointer events (one shared stroke path)
- Express + [`ws`](https://github.com/websockets/ws) for the room server
- Shared plain-ESM geometry/rules modules used by both client and server
- Seeded `mulberry32` PRNG for deterministic boards
- Web Audio API for generated sound effects

## Project layout

```
shared/board.js        deterministic board generation (client + server)
shared/rules.js        stroke geometry, crossing + timing rules
server/rooms.mjs       room protocol, turn rotation, elimination, timers
server/index.mjs       standalone HTTP + WebSocket server (dev/prod)
api/ws.js              Vercel Function entrypoint wrapping the room server
vercel.json            Vercel framework/build config
src/App.tsx            screen routing (home / lobby / game)
src/store.ts           client session, room and action state
src/game/rules.ts      typed wrapper + human-readable failure reasons
src/net/socket.ts      reconnecting WebSocket client (/api/ws)
src/components/CanvasBoard.tsx  canvas board, drawing, live crossing feedback
src/views/Game.tsx     turn timer, player strip, results overlay
src/styles.css         all styling
```
