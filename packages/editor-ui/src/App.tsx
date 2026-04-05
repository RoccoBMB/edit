import { useEffect } from 'react'
import { Canvas } from './components/Canvas'
import { SelectionOverlay } from './components/SelectionOverlay'
import { StylePanel } from './components/StylePanel'
import { LayersPanel } from './components/LayersPanel'
import { useEditorStore } from './state/editor-store'
import { getWsClient } from './lib/ws-client'
import { useTemporalStore } from './hooks/use-temporal'

export function App() {
  const state = useEditorStore((s) => s.editorState)
  const selectedLoc = useEditorStore((s) => s.selectedLoc)
  const incrementFileVersion = useEditorStore((s) => s.incrementFileVersion)

  // Initialize WS connection and listen for server messages
  useEffect(() => {
    const ws = getWsClient()
    const unsub = ws.onMessage((msg) => {
      switch (msg.type) {
        case 'write:success': {
          incrementFileVersion()
          break
        }
        case 'write:error': {
          const payload = msg.payload as { loc: string; message: string }
          console.error('[Edit] Write error:', payload.message)
          break
        }
        case 'file:changed': {
          // External file change — could trigger iframe reload
          incrementFileVersion()
          break
        }
      }
    })
    return unsub
  }, [incrementFileVersion])

  // Undo/Redo keyboard shortcuts
  const { undo, redo } = useTemporalStore()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey

      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if (isMod && e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        redo()
      }
      // Also support Ctrl+Y for redo on Windows
      if (isMod && e.key === 'y') {
        e.preventDefault()
        redo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  return (
    <div className="editor-layout">
      {/* Top toolbar */}
      <div className="toolbar">
        <div className="toolbar-title">Edit</div>
      </div>

      {/* Left panel: layers */}
      <LayersPanel />

      {/* Center: canvas with overlay */}
      <div className="canvas-area">
        <Canvas />
        <SelectionOverlay />
      </div>

      {/* Right panel: styles */}
      <StylePanel />

      {/* Bottom status bar */}
      <div className="status-bar">
        <div className="status">
          <div className={`status-dot ${state === 'LOADING' ? 'loading' : ''}`} />
          <span>{state === 'LOADING' ? 'Loading...' : 'Ready'}</span>
        </div>
        {selectedLoc && (
          <span className="selection-info">{selectedLoc}</span>
        )}
      </div>
    </div>
  )
}
