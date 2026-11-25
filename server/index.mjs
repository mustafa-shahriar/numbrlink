import express from 'express'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { attachRooms } from './rooms.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dev = process.argv.includes('--dev')
const PORT = Number(process.env.PORT) || 3000

const app = express()
const server = createServer(app)

// ---------------------------------------------------------------------------
// Client (Vite in middleware mode for dev, static build in production)
// ---------------------------------------------------------------------------

if (dev) {
  const { createServer: createViteServer } = await import('vite')
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  })

  app.use(vite.middlewares)
  app.use(async (req, res, next) => {
    if (req.method !== 'GET') return next()
    try {
      const template = await readFile(join(root, 'index.html'), 'utf-8')
      const html = await vite.transformIndexHtml(req.originalUrl, template)
      res.status(200).set('Content-Type', 'text/html').end(html)
    } catch (err) {
      next(err)
    }
  })
} else {
  app.use(express.static(join(root, 'dist')))
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next()
    res.sendFile(join(root, 'dist', 'index.html'))
  })
}

// ---------------------------------------------------------------------------
// Multiplayer rooms
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true })

// Only claim the room socket so Vite's HMR socket keeps working in dev.
// Vercel serves the same endpoint at /api/ws; locally /ws also works.
server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  if (pathname !== '/ws' && pathname !== '/api/ws') return
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req)
  })
})

attachRooms(wss)

server.listen(PORT, () => {
  console.log(`\n  Numbrlink ${dev ? 'dev' : 'server'} running at http://localhost:${PORT}\n`)
})
