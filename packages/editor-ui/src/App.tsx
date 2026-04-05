import { Canvas } from './components/Canvas'
import { useEditorStore } from './state/editor-store'

export function App() {
  const state = useEditorStore((s) => s.editorState)
  const selectedLoc = useEditorStore((s) => s.selectedLoc)

  return (
    <div className="editor-layout">
      <div className="layers-panel">
        <h2>Layers</h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px' }}>
          Click an element in the preview to select it.
        </p>
      </div>

      <div className="canvas-area">
        <Canvas />
      </div>

      <div className="toolbar">
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
