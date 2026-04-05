import { Canvas } from './components/Canvas'
import { SelectionOverlay } from './components/SelectionOverlay'
import { StylePanel } from './components/StylePanel'
import { LayersPanel } from './components/LayersPanel'
import { useEditorStore } from './state/editor-store'

export function App() {
  const state = useEditorStore((s) => s.editorState)
  const selectedLoc = useEditorStore((s) => s.selectedLoc)

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
