import { WebSocketServer, type WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Server } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveInProject } from './file-jail.js'
import { applyStyleChange, applyContentChange, applyElementMove } from './source-writer.js'
import type { WriteQueue } from './write-queue.js'
import { parseEditLoc } from './types.js'

interface WsHandlerOptions {
  server: Server
  projectRoot: string
  authToken: string
  writeQueue: WriteQueue
}

/** Per-file version counter for optimistic concurrency */
const fileVersions = new Map<string, number>()

function getFileVersion(filePath: string): number {
  return fileVersions.get(filePath) ?? 0
}

function bumpFileVersion(filePath: string): number {
  const next = getFileVersion(filePath) + 1
  fileVersions.set(filePath, next)
  return next
}

export function createWsHandler({ server, projectRoot, authToken, writeQueue }: WsHandlerOptions) {
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
        await handleMessage(ws, msg, projectRoot, writeQueue, broadcast)
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
  writeQueue: WriteQueue,
  _broadcast: (msg: object) => void,
) {
  switch (msg.type) {
    case 'file:get-tree': {
      const files = await getHtmlFiles(projectRoot)
      ws.send(JSON.stringify({ type: 'file:tree', payload: { files } }))
      break
    }

    case 'edit:style': {
      const payload = msg.payload as {
        loc: string
        fingerprint: string
        property: string
        value: string
      }

      const parsed = parseEditLoc(payload.loc)
      if (!parsed) {
        ws.send(JSON.stringify({
          type: 'write:error',
          payload: { loc: payload.loc, message: 'Invalid loc format' },
        }))
        break
      }

      const filePath = resolveInProject(parsed.file, projectRoot)

      try {
        await writeQueue.enqueue(filePath, (source) =>
          applyStyleChange(
            source,
            payload.fingerprint,
            parsed.line,
            parsed.col,
            payload.property,
            payload.value,
          ),
        )

        const version = bumpFileVersion(parsed.file)
        ws.send(JSON.stringify({
          type: 'write:success',
          payload: { loc: payload.loc, version },
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Write failed'
        ws.send(JSON.stringify({
          type: 'write:error',
          payload: { loc: payload.loc, message },
        }))
      }
      break
    }

    case 'edit:content': {
      const payload = msg.payload as {
        loc: string
        fingerprint: string
        html: string
      }

      const parsed = parseEditLoc(payload.loc)
      if (!parsed) {
        ws.send(JSON.stringify({
          type: 'write:error',
          payload: { loc: payload.loc, message: 'Invalid loc format' },
        }))
        break
      }

      const filePath = resolveInProject(parsed.file, projectRoot)

      try {
        await writeQueue.enqueue(filePath, (source) =>
          applyContentChange(
            source,
            payload.fingerprint,
            parsed.line,
            parsed.col,
            payload.html,
          ),
        )

        const version = bumpFileVersion(parsed.file)
        ws.send(JSON.stringify({
          type: 'write:success',
          payload: { loc: payload.loc, version },
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Write failed'
        ws.send(JSON.stringify({
          type: 'write:error',
          payload: { loc: payload.loc, message },
        }))
      }
      break
    }

    case 'edit:move': {
      const payload = msg.payload as {
        sourceLoc: string
        sourceFingerprint: string
        targetLoc: string
        targetFingerprint: string
        position: 'before' | 'after'
      }

      const sourceParsed = parseEditLoc(payload.sourceLoc)
      const targetParsed = parseEditLoc(payload.targetLoc)

      if (!sourceParsed) {
        ws.send(JSON.stringify({
          type: 'write:error',
          payload: { loc: payload.sourceLoc, message: 'Invalid source loc format' },
        }))
        break
      }
      if (!targetParsed) {
        ws.send(JSON.stringify({
          type: 'write:error',
          payload: { loc: payload.targetLoc, message: 'Invalid target loc format' },
        }))
        break
      }

      // Both elements must be in the same file for sibling reorder
      if (sourceParsed.file !== targetParsed.file) {
        ws.send(JSON.stringify({
          type: 'write:error',
          payload: { loc: payload.sourceLoc, message: 'Cross-file moves not supported' },
        }))
        break
      }

      const filePath = resolveInProject(sourceParsed.file, projectRoot)

      try {
        await writeQueue.enqueue(filePath, (source) =>
          applyElementMove(
            source,
            payload.sourceFingerprint,
            sourceParsed.line,
            sourceParsed.col,
            payload.targetFingerprint,
            targetParsed.line,
            targetParsed.col,
            payload.position,
          ),
        )

        const version = bumpFileVersion(sourceParsed.file)
        ws.send(JSON.stringify({
          type: 'write:success',
          payload: { loc: payload.sourceLoc, version },
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Move failed'
        ws.send(JSON.stringify({
          type: 'write:error',
          payload: { loc: payload.sourceLoc, message },
        }))
      }
      break
    }

    default:
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
