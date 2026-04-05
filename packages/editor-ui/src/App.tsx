import { useEffect, useRef, useCallback } from 'react'
import { Canvas } from './components/Canvas'
import { SelectionOverlay } from './components/SelectionOverlay'
import { StylePanel } from './components/StylePanel'
import { LayersPanel } from './components/LayersPanel'
import { Toolbar } from './components/Toolbar'
import { ToastContainer } from './components/Toast'
import { useEditorStore } from './state/editor-store'
import { getWsClient } from './lib/ws-client'
import { useTemporalStore } from './hooks/use-temporal'

/** Auto-dismiss timeout in ms */
const TOAST_AUTO_DISMISS = 5000
const SAVE_RESET_DELAY = 2000

export function App() {
  const selectedLoc = useEditorStore((s) => s.selectedLoc)
  const editorState = useEditorStore((s) => s.editorState)
  const saveState = useEditorStore((s) => s.saveState)
  const incrementFileVersion = useEditorStore((s) => s.incrementFileVersion)
  const setPages = useEditorStore((s) => s.setPages)
  const addToast = useEditorStore((s) => s.addToast)
  const dismissToast = useEditorStore((s) => s.dismissToast)
  const setSaveState = useEditorStore((s) => s.setSaveState)

  const saveResetTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  /** Schedule a save-state reset from 'saved' back to 'ready' */
  const scheduleSaveReset = useCallback(() => {
    clearTimeout(saveResetTimerRef.current)
    saveResetTimerRef.current = setTimeout(() => {
      const current = useEditorStore.getState().saveState
      if (current === 'saved') {
        setSaveState('ready')
      }
    }, SAVE_RESET_DELAY)
  }, [setSaveState])

  /** Auto-dismiss a toast after delay (errors stay until manually dismissed) */
  const scheduleToastDismiss = useCallback(
    (id: string, type: 'error' | 'warning' | 'success') => {
      if (type === 'error') return // Errors stay until dismissed
      setTimeout(() => {
        dismissToast(id)
      }, TOAST_AUTO_DISMISS)
    },
    [dismissToast],
  )

  /** Wrapper to add toast + schedule auto-dismiss */
  const showToast = useCallback(
    (message: string, type: 'error' | 'warning' | 'success') => {
      addToast(message, type)
      // Get the just-added toast ID from store
      const toasts = useEditorStore.getState().toasts
      const latest = toasts[toasts.length - 1]
      if (latest) {
        scheduleToastDismiss(latest.id, type)
      }
    },
    [addToast, scheduleToastDismiss],
  )

  // Initialize WS connection and listen for server messages
  useEffect(() => {
    const ws = getWsClient()

    // Request file tree on connect
    ws.sendMessage({ type: 'file:get-tree' })

    const unsubMessage = ws.onMessage((msg) => {
      switch (msg.type) {
        case 'write:success': {
          incrementFileVersion()
          setSaveState('saved')
          scheduleSaveReset()
          break
        }
        case 'write:error': {
          const payload = msg.payload as { loc: string; message: string }
          console.error('[Edit] Write error:', payload.message)
          setSaveState('error')
          showToast(`Failed to save: ${payload.message}`, 'error')
          break
        }
        case 'file:changed': {
          // External file change — could trigger iframe reload
          incrementFileVersion()
          break
        }
        case 'file:tree': {
          const payload = msg.payload as { files: string[] }
          setPages(payload.files)
          break
        }
      }
    })

    const unsubConnect = ws.onConnect(() => {
      showToast('Reconnected', 'success')
    })

    const unsubDisconnect = ws.onDisconnect(() => {
      showToast('Connection lost. Reconnecting...', 'warning')
    })

    return () => {
      unsubMessage()
      unsubConnect()
      unsubDisconnect()
    }
  }, [incrementFileVersion, setPages, setSaveState, scheduleSaveReset, showToast])

  // Undo/Redo and Ctrl+S keyboard shortcuts
  const { undo, redo } = useTemporalStore()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept shortcuts when inline editing text in the iframe
      const state = useEditorStore.getState()
      if (state.editorState === 'EDITING_TEXT') return

      const isMod = e.metaKey || e.ctrlKey

      // Ctrl+S: flush debounced writes immediately
      if (isMod && e.key === 's') {
        e.preventDefault()
        // The save is handled by the debounce flushing in the style dispatch;
        // this just prevents the browser save dialog.
        return
      }

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

  // Determine status bar display based on save state and editor state
  const isLoading = editorState === 'LOADING' || editorState === 'NAVIGATING'

  let statusDotClass = ''
  let statusText = 'Ready'

  if (isLoading) {
    statusDotClass = 'loading'
    statusText = 'Loading...'
  } else if (saveState === 'error') {
    statusDotClass = 'error'
    statusText = 'Error'
  } else if (saveState === 'saving') {
    statusDotClass = 'saving'
    statusText = 'Saving...'
  } else if (saveState === 'unsaved') {
    statusDotClass = 'unsaved'
    statusText = 'Unsaved'
  } else if (saveState === 'saved') {
    statusDotClass = 'saved'
    statusText = 'Saved'
  }

  return (
    <div className="editor-layout">
      {/* Top toolbar */}
      <Toolbar />

      {/* Left panel: layers */}
      <LayersPanel />

      {/* Center: canvas with overlay */}
      <div className="canvas-area">
        <Canvas />
        <SelectionOverlay />
        <ToastContainer />
      </div>

      {/* Right panel: styles */}
      <StylePanel />

      {/* Bottom status bar */}
      <div className="status-bar">
        <div className="status">
          <div className={`status-dot ${statusDotClass}`} />
          <span>{statusText}</span>
        </div>
        {selectedLoc && (
          <span className="selection-info">{selectedLoc}</span>
        )}
      </div>
    </div>
  )
}
