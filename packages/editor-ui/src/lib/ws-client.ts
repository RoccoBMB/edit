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
export type ConnectionHandler = () => void

interface WsClient {
  sendMessage(msg: object): void
  onMessage(handler: MessageHandler): () => void
  onConnect(handler: ConnectionHandler): () => void
  onDisconnect(handler: ConnectionHandler): () => void
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
  const connectHandlers = new Set<ConnectionHandler>()
  const disconnectHandlers = new Set<ConnectionHandler>()
  let ws: WebSocket | null = null
  let connected = false
  let wasConnected = false
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
      for (const handler of connectHandlers) {
        handler()
      }
      wasConnected = true
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
      const wasUp = connected
      connected = false
      ws = null
      // Only fire disconnect handlers if we had been connected before
      if (wasUp || wasConnected) {
        for (const handler of disconnectHandlers) {
          handler()
        }
      }
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

  function onConnect(handler: ConnectionHandler): () => void {
    connectHandlers.add(handler)
    return () => {
      connectHandlers.delete(handler)
    }
  }

  function onDisconnect(handler: ConnectionHandler): () => void {
    disconnectHandlers.add(handler)
    return () => {
      disconnectHandlers.delete(handler)
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
    connectHandlers.clear()
    disconnectHandlers.clear()
  }

  // Start connection
  connect()

  return { sendMessage, onMessage, onConnect, onDisconnect, isConnected, disconnect }
}
