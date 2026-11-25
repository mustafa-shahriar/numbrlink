import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { attachRooms } from '../server/rooms.mjs'

// Vercel Function entrypoint. WebSocket upgrades are handled by the exported
// HTTP server; every connection is pinned to this function instance.
const server = createServer((req, res) => {
  res.statusCode = 426
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end('WebSocket upgrade required')
})

const wss = new WebSocketServer({ server })
attachRooms(wss)

export default server
