/**
 * WebSocket client for the editor.
 * - Connects to the CLI server's WebSocket endpoint
 * - Reads auth token from window.__EDIT_TOKEN__
 * - Auto-reconnects with exponential backoff (1s, 2s, 4s, ... max 30s)
 * - Exposes: sendMessage, onMessage, isConnected
 */

declare global {
  interface Window {
    __EDIT_TOKEN__?: string
  }
}

export type MessageHandler = (msg: { type: string; payload?: unknown }) => void

interface WsClient {
  sendMessage(msg: object): void
  onMessage(handler: MessageHandler): () => void
  isConnected(): boolean
  disconnect(): void
}

let instance: WsClient | null = null

export function getWsClient(): WsClient {
  if (instance) return instance
  instance = createWsClient()
  return instance
}

function createWsClient(): WsClient {
  const handlers = new Set<MessageHandler>()
  let ws: WebSocket | null = null
  let connected = false
  let reconnectDelay = 1000
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  function connect() {
    if (disposed) return

    const token = window.__EDIT_TOKEN__ ?? ''
    const port = window.location.port
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//localhost:${port}/__edit__/ws?token=${token}`

    try {
      ws = new WebSocket(url)
    } catch {
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      connected = true
      reconnectDelay = 1000 // Reset backoff on successful connection
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; payload?: unknown }
        for (const handler of handlers) {
          handler(msg)
        }
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onclose = () => {
      connected = false
      ws = null
      scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose will fire after onerror, triggering reconnect
    }
  }

  function scheduleReconnect() {
    if (disposed) return
    if (reconnectTimer) return

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      reconnectDelay = Math.min(reconnectDelay * 2, 30000)
      connect()
    }, reconnectDelay)
  }

  function sendMessage(msg: object) {
    if (ws && connected) {
      ws.send(JSON.stringify(msg))
    }
  }

  function onMessage(handler: MessageHandler): () => void {
    handlers.add(handler)
    return () => {
      handlers.delete(handler)
    }
  }

  function isConnected(): boolean {
    return connected
  }

  function disconnect() {
    disposed = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    connected = false
    handlers.clear()
  }

  // Start connection
  connect()

  return { sendMessage, onMessage, isConnected, disconnect }
}
