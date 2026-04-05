import { useCallback } from 'react'
import { useEditorStore } from '../state/editor-store'
import { useTemporalStore } from '../hooks/use-temporal'

export function Toolbar() {
  const editorState = useEditorStore((s) => s.editorState)
  const activePage = useEditorStore((s) => s.activePage)
  const pages = useEditorStore((s) => s.pages)
  const navigateToPage = useEditorStore((s) => s.navigateToPage)
  const { undo, redo } = useTemporalStore()

  const handlePageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const page = e.target.value
      if (page !== activePage) {
        navigateToPage(page)
      }
    },
    [activePage, navigateToPage],
  )

  const isLoading = editorState === 'LOADING' || editorState === 'NAVIGATING'

  return (
    <div className="toolbar">
      <div className="toolbar-title">Edit</div>

      <div className="toolbar-separator" />

      {/* Undo / Redo buttons */}
      <button
        type="button"
        className="toolbar-btn"
        onClick={undo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      </button>
      <button
        type="button"
        className="toolbar-btn"
        onClick={redo}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
        </svg>
      </button>

      <div className="toolbar-separator" />

      {/* Page switcher */}
      {pages.length > 0 && (
        <div className="toolbar-page-switcher">
          <label htmlFor="page-select" className="toolbar-label">
            Page:
          </label>
          <select
            id="page-select"
            className="toolbar-select"
            value={activePage}
            onChange={handlePageChange}
          >
            {pages.map((page) => (
              <option key={page} value={page}>
                {page}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Spacer */}
      <div className="toolbar-spacer" />

      {/* Status indicator */}
      <div className="toolbar-status">
        <div className={`toolbar-status-dot ${isLoading ? 'loading' : ''}`} />
        <span className="toolbar-status-text">
          {isLoading ? 'Loading...' : editorState === 'EDITING_TEXT' ? 'Editing' : editorState === 'DRAGGING' ? 'Dragging' : 'Ready'}
        </span>
      </div>
    </div>
  )
}
