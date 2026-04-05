import { useRef, useEffect, useCallback } from 'react'
import { useEditorStore } from '../state/editor-store'
import { getWsClient } from '../lib/ws-client'

/** Single-line elements: Enter commits edits instead of inserting newline */
const SINGLE_LINE_TAGS = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BUTTON', 'LABEL', 'A', 'SPAN',
])

export function Canvas() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const setEditorState = useEditorStore((s) => s.setEditorState)
  const selectElement = useEditorStore((s) => s.selectElement)
  const hoverElement = useEditorStore((s) => s.hoverElement)
  const setIframeElement = useEditorStore((s) => s.setIframeElement)
  const startInlineEdit = useEditorStore((s) => s.startInlineEdit)
  const activePage = useEditorStore((s) => s.activePage)

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const doc = iframe.contentDocument
    if (!doc) return

    setEditorState('IDLE')
    setIframeElement(iframe)

    // Click handler: read data-edit-loc, select element
    doc.addEventListener('click', (e: MouseEvent) => {
      const state = useEditorStore.getState()

      // Don't select while editing text — clicks should move cursor
      if (state.editorState === 'EDITING_TEXT') return
      // Don't select while dragging
      if (state.editorState === 'DRAGGING') return

      e.preventDefault()
      e.stopPropagation()

      const target = e.target as HTMLElement
      const loc = findEditLoc(target)
      if (!loc) return

      const rect = target.getBoundingClientRect()
      selectElement(loc, {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      }, target)
    })

    // Double-click handler: enter inline text editing
    doc.addEventListener('dblclick', (e: MouseEvent) => {
      const state = useEditorStore.getState()
      if (state.editorState === 'EDITING_TEXT') return

      e.preventDefault()
      e.stopPropagation()

      const target = e.target as HTMLElement
      const loc = findEditLoc(target)
      if (!loc) return

      // Start inline editing
      startInlineEdit(target)
      target.contentEditable = 'true'
      target.focus()

      // Select all text content for easy replacement
      const sel = doc.getSelection()
      if (sel) {
        sel.selectAllChildren(target)
      }
    })

    // Prevent navigation from links/forms
    doc.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const link = target.closest('a')
      if (link) {
        e.preventDefault()
      }
    }, true)

    doc.addEventListener('submit', (e: Event) => {
      e.preventDefault()
    }, true)

    // Hover handler
    let lastHoveredLoc: string | null = null
    doc.addEventListener('mouseover', (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const loc = findEditLoc(target)
      if (loc !== lastHoveredLoc) {
        lastHoveredLoc = loc
        hoverElement(loc)
      }
    })

    doc.addEventListener('mouseout', () => {
      lastHoveredLoc = null
      hoverElement(null)
    })

    // Keyboard handler for inline editing
    doc.addEventListener('keydown', (e: KeyboardEvent) => {
      const state = useEditorStore.getState()

      if (state.editorState !== 'EDITING_TEXT') {
        // Disable browser's native undo at document level when not editing
        return
      }

      const el = state.editingElement
      if (!el) return

      // Intercept Ctrl+Z / Ctrl+Y while editing text to prevent browser undo
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && (e.key === 'z' || e.key === 'y')) {
        e.preventDefault()
        return
      }

      // Escape cancels editing
      if (e.key === 'Escape') {
        e.preventDefault()
        // Restore original content
        const original = state.originalContent
        if (original !== null) {
          el.innerHTML = original
        }
        el.contentEditable = 'false'
        useEditorStore.getState().stopInlineEdit(false)
        return
      }

      // Enter behavior depends on element type
      if (e.key === 'Enter' && !e.shiftKey) {
        if (SINGLE_LINE_TAGS.has(el.tagName)) {
          e.preventDefault()
          commitInlineEdit(el, state.selectedLoc)
          return
        }
        // Multi-line elements: Enter inserts newline (default browser behavior)
      }
    })

    // Blur handler for inline editing: save on blur
    doc.addEventListener('focusout', (e: FocusEvent) => {
      const state = useEditorStore.getState()
      if (state.editorState !== 'EDITING_TEXT') return

      const el = state.editingElement
      if (!el) return

      // Check if the blur target is our editing element
      if (e.target === el) {
        commitInlineEdit(el, state.selectedLoc)
      }
    })
  }, [setEditorState, selectElement, hoverElement, setIframeElement, startInlineEdit])

  // Build iframe URL based on active page
  const projectUrl = `/__project__/${activePage}`

  useEffect(() => {
    const iframe = iframeRef.current
    if (iframe) {
      iframe.addEventListener('load', handleIframeLoad)
      return () => iframe.removeEventListener('load', handleIframeLoad)
    }
  }, [handleIframeLoad])

  return (
    <iframe
      ref={iframeRef}
      src={projectUrl}
      title="Edit Preview"
    />
  )
}

/** Commit inline edit: send content change to server, exit editing mode */
function commitInlineEdit(el: HTMLElement, loc: string | null) {
  const newHtml = el.innerHTML
  el.contentEditable = 'false'

  if (loc) {
    const fingerprint = el.getAttribute('data-edit-fp') ?? ''
    const ws = getWsClient()
    ws.sendMessage({
      type: 'edit:content',
      payload: { loc, fingerprint, html: newHtml },
    })
  }

  // Transition: EDITING_TEXT -> WRITING -> (server will respond with success)
  useEditorStore.getState().stopInlineEdit(true)
}

/** Walk up from element to find the nearest data-edit-loc attribute */
function findEditLoc(el: HTMLElement | null): string | null {
  let current = el
  while (current) {
    const loc = current.getAttribute('data-edit-loc')
    if (loc) return loc
    current = current.parentElement
  }
  return null
}
