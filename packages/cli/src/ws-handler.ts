import { WebSocketServer, type WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Server } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveInProject } from './file-jail.js'

interface WsHandlerOptions {
  server: Server
  projectRoot: string
  authToken: string
}

export function createWsHandler({ server, projectRoot, authToken }: WsHandlerOptions) {
  const wss = new WebSocketServer({ noServer: true })
  const clients = new Set<WebSocket>()

  // Handle upgrade manually to validate auth token
  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`)

    // Only handle our editor WebSocket path
    if (url.pathname !== '/__edit__/ws') return

    // Validate auth token
    const token = url.searchParams.get('token')
    if (token !== authToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    // Validate Host header (DNS rebinding protection)
    const host = request.headers.host ?? ''
    if (!host.startsWith('localhost:') && !host.startsWith('127.0.0.1:')) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  })

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws)

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; payload?: unknown }
        await handleMessage(ws, msg, projectRoot)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        ws.send(JSON.stringify({ type: 'error', payload: { message } }))
      }
    })

    ws.on('close', () => {
      clients.delete(ws)
    })
  })

  function broadcast(message: object) {
    const data = JSON.stringify(message)
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(data)
      }
    }
  }

  return { wss, broadcast, clients }
}

async function handleMessage(
  ws: WebSocket,
  msg: { type: string; payload?: unknown },
  projectRoot: string,
) {
  switch (msg.type) {
    case 'file:get-tree': {
      const files = await getHtmlFiles(projectRoot)
      ws.send(JSON.stringify({ type: 'file:tree', payload: { files } }))
      break
    }
    default:
      // Other message types will be handled in Phase 3
      break
  }
}

async function getHtmlFiles(dir: string, base = ''): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const rel = path.join(base, entry.name)

    // Skip hidden dirs, node_modules, dist
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
      continue
    }

    if (entry.isDirectory()) {
      const nested = await getHtmlFiles(path.join(dir, entry.name), rel)
      files.push(...nested)
    } else if (entry.name.endsWith('.html')) {
      files.push(rel)
    }
  }

  return files
}
