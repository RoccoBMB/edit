import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useEditorStore, type SerializedRect } from '../state/editor-store'
import { getWsClient } from '../lib/ws-client'

/**
 * SelectionOverlay renders blue selection and hover highlights
 * over the iframe canvas. It runs a RAF loop to keep rects
 * in sync as the iframe scrolls or resizes.
 *
 * Phase 4 additions:
 * - Dashed green border when in EDITING_TEXT mode
 * - Drag handle on selected element
 * - Drop indicator lines between siblings during drag
 *
 * Phase 5 additions:
 * - Element label badge (tag + first class or id)
 * - Hover label badge
 */

/** Find the data-edit-loc for an element */
function getElementLoc(el: Element): string | null {
  return el.getAttribute('data-edit-loc')
}

/** Find the data-edit-fp for an element */
function getElementFp(el: Element): string {
  return el.getAttribute('data-edit-fp') ?? ''
}

/** Build a label like "div.hero-title" or "h1#main" */
function getElementLabel(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.getAttribute('id')
  if (id) return `${tag}#${id}`
  const cls = el.className
  if (typeof cls === 'string' && cls.trim()) {
    const firstClass = cls.trim().split(/\s+/)[0]
    if (firstClass) return `${tag}.${firstClass}`
  }
  return tag
}

export function SelectionOverlay() {
  const selectedElement = useEditorStore((s) => s.selectedElement)
  const hoveredLoc = useEditorStore((s) => s.hoveredLoc)
  const selectedLoc = useEditorStore((s) => s.selectedLoc)
  const iframeElement = useEditorStore((s) => s.iframeElement)
  const clearSelection = useEditorStore((s) => s.clearSelection)
  const editorState = useEditorStore((s) => s.editorState)
  const startDrag = useEditorStore((s) => s.startDrag)
  const stopDrag = useEditorStore((s) => s.stopDrag)

  const selectionRef = useRef<HTMLDivElement>(null)
  const selectionLabelRef = useRef<HTMLDivElement>(null)
  const hoverRef = useRef<HTMLDivElement>(null)
  const hoverLabelRef = useRef<HTMLDivElement>(null)
  const dragHandleRef = useRef<HTMLDivElement>(null)
  const rafId = useRef<number>(0)

  // Drag state
  const [isDragging, setIsDragging] = useState(false)
  const [dropIndicator, setDropIndicator] = useState<{ x: number; y: number; width: number } | null>(null)
  const dragDataRef = useRef<{
    sourceElement: HTMLElement
    sourceLoc: string
    sourceFp: string
    siblings: Array<{ element: HTMLElement; loc: string; fp: string; rect: DOMRect }>
    dropTarget: { loc: string; fp: string; position: 'before' | 'after' } | null
  } | null>(null)

  /** Translate an element's bounding rect from iframe coords to overlay coords */
  const translateRect = useCallback(
    (elementRect: DOMRect): SerializedRect | null => {
      if (!iframeElement) return null
      const iframeRect = iframeElement.getBoundingClientRect()
      const containerEl = iframeElement.parentElement
      if (!containerEl) return null
      const containerRect = containerEl.getBoundingClientRect()

      return {
        x: iframeRect.left - containerRect.left + elementRect.x,
        y: iframeRect.top - containerRect.top + elementRect.y,
        width: elementRect.width,
        height: elementRect.height,
      }
    },
    [iframeElement],
  )

  /** Apply a rect to a div's style */
  const applyRect = useCallback(
    (div: HTMLDivElement, rect: SerializedRect) => {
      div.style.transform = `translate(${rect.x}px, ${rect.y}px)`
      div.style.width = `${rect.width}px`
      div.style.height = `${rect.height}px`
      div.style.display = 'block'
    },
    [],
  )

  /** Find an element inside the iframe by its data-edit-loc attribute */
  const findElementByLoc = useCallback(
    (loc: string): Element | null => {
      if (!iframeElement) return null
      const doc = iframeElement.contentDocument
      if (!doc) return null
      return doc.querySelector(`[data-edit-loc="${CSS.escape(loc)}"]`)
    },
    [iframeElement],
  )

  // --- Drag handle mouse handlers ---
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (!selectedElement || !iframeElement || !selectedLoc) return
      const el = selectedElement as HTMLElement

      // Read siblings
      const parent = el.parentElement
      if (!parent) return

      const siblings: Array<{ element: HTMLElement; loc: string; fp: string; rect: DOMRect }> = []
      for (let i = 0; i < parent.children.length; i++) {
        const child = parent.children[i] as HTMLElement
        const loc = getElementLoc(child)
        if (loc) {
          siblings.push({
            element: child,
            loc,
            fp: getElementFp(child),
            rect: child.getBoundingClientRect(),
          })
        }
      }

      dragDataRef.current = {
        sourceElement: el,
        sourceLoc: selectedLoc,
        sourceFp: getElementFp(el),
        siblings,
        dropTarget: null,
      }

      setIsDragging(true)
      startDrag(el)

      // Set pointer-events:none on iframe during drag
      iframeElement.style.pointerEvents = 'none'

      // Listen for mousemove/mouseup on the overlay container
      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragDataRef.current || !iframeElement) return

        const containerEl = iframeElement.parentElement
        if (!containerEl) return
        const containerRect = containerEl.getBoundingClientRect()
        const iframeRect = iframeElement.getBoundingClientRect()

        // Mouse position relative to the iframe's viewport
        const mouseY = moveEvent.clientY - iframeRect.top

        // Find closest drop position among siblings
        let closestDist = Infinity
        let bestTarget: { loc: string; fp: string; position: 'before' | 'after' } | null = null
        let bestIndicatorY = 0
        let indicatorX = 0
        let indicatorWidth = 0

        for (const sibling of dragDataRef.current.siblings) {
          if (sibling.element === dragDataRef.current.sourceElement) continue

          const sibRect = sibling.element.getBoundingClientRect()

          // Check distance to top edge (insert before)
          const distTop = Math.abs(mouseY - sibRect.top)
          if (distTop < closestDist) {
            closestDist = distTop
            bestTarget = { loc: sibling.loc, fp: sibling.fp, position: 'before' }
            bestIndicatorY = sibRect.top
            indicatorX = sibRect.left
            indicatorWidth = sibRect.width
          }

          // Check distance to bottom edge (insert after)
          const distBottom = Math.abs(mouseY - sibRect.bottom)
          if (distBottom < closestDist) {
            closestDist = distBottom
            bestTarget = { loc: sibling.loc, fp: sibling.fp, position: 'after' }
            bestIndicatorY = sibRect.bottom
            indicatorX = sibRect.left
            indicatorWidth = sibRect.width
          }
        }

        dragDataRef.current.dropTarget = bestTarget

        if (bestTarget && indicatorWidth > 0) {
          const translatedY = iframeRect.top - containerRect.top + bestIndicatorY
          const translatedX = iframeRect.left - containerRect.left + indicatorX
          setDropIndicator({ x: translatedX, y: translatedY, width: indicatorWidth })
        } else {
          setDropIndicator(null)
        }
      }

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)

        if (iframeElement) {
          iframeElement.style.pointerEvents = ''
        }

        const data = dragDataRef.current
        if (data?.dropTarget) {
          // Send move message to server
          const ws = getWsClient()
          ws.sendMessage({
            type: 'edit:move',
            payload: {
              sourceLoc: data.sourceLoc,
              sourceFingerprint: data.sourceFp,
              targetLoc: data.dropTarget.loc,
              targetFingerprint: data.dropTarget.fp,
              position: data.dropTarget.position,
            },
          })
        }

        dragDataRef.current = null
        setIsDragging(false)
        setDropIndicator(null)
        stopDrag()
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [selectedElement, iframeElement, selectedLoc, startDrag, stopDrag],
  )

  /** Compute the label for the selected element */
  const selectionLabel = useMemo(() => {
    if (!selectedElement || !selectedElement.isConnected) return ''
    return getElementLabel(selectedElement)
  }, [selectedElement])

  useEffect(() => {
    const tick = () => {
      const isEditing = useEditorStore.getState().editorState === 'EDITING_TEXT'

      // --- Selection highlight ---
      const selDiv = selectionRef.current
      const selLabel = selectionLabelRef.current
      if (selDiv) {
        if (selectedElement && selectedElement.isConnected) {
          const rect = (selectedElement as HTMLElement).getBoundingClientRect()
          const translated = translateRect(rect)
          if (translated) {
            applyRect(selDiv, translated)
            // Switch border style for editing mode
            if (isEditing) {
              selDiv.classList.add('editing')
            } else {
              selDiv.classList.remove('editing')
            }
            // Position selection label
            if (selLabel) {
              selLabel.style.transform = `translate(${translated.x - 1}px, ${translated.y - 22}px)`
              selLabel.style.display = 'block'
            }
          } else {
            selDiv.style.display = 'none'
            if (selLabel) selLabel.style.display = 'none'
          }
        } else {
          selDiv.style.display = 'none'
          if (selLabel) selLabel.style.display = 'none'
          // Element disconnected from DOM — clear selection
          if (selectedElement && !selectedElement.isConnected) {
            clearSelection()
          }
        }
      }

      // --- Drag handle ---
      const handleDiv = dragHandleRef.current
      if (handleDiv) {
        if (selectedElement && selectedElement.isConnected && !isEditing && !isDragging) {
          const rect = (selectedElement as HTMLElement).getBoundingClientRect()
          const translated = translateRect(rect)
          if (translated) {
            // Position at top-left corner of selected element
            handleDiv.style.transform = `translate(${translated.x - 12}px, ${translated.y - 12}px)`
            handleDiv.style.display = 'flex'
          } else {
            handleDiv.style.display = 'none'
          }
        } else {
          handleDiv.style.display = 'none'
        }
      }

      // --- Hover highlight ---
      const hovDiv = hoverRef.current
      const hovLabel = hoverLabelRef.current
      if (hovDiv) {
        if (hoveredLoc && hoveredLoc !== selectedLoc) {
          const hoveredEl = findElementByLoc(hoveredLoc)
          if (hoveredEl && hoveredEl.isConnected) {
            const rect = (hoveredEl as HTMLElement).getBoundingClientRect()
            const translated = translateRect(rect)
            if (translated) {
              applyRect(hovDiv, translated)
              // Position and populate hover label
              if (hovLabel) {
                hovLabel.textContent = getElementLabel(hoveredEl)
                hovLabel.style.transform = `translate(${translated.x - 1}px, ${translated.y - 20}px)`
                hovLabel.style.display = 'block'
              }
            } else {
              hovDiv.style.display = 'none'
              if (hovLabel) hovLabel.style.display = 'none'
            }
          } else {
            hovDiv.style.display = 'none'
            if (hovLabel) hovLabel.style.display = 'none'
          }
        } else {
          hovDiv.style.display = 'none'
          if (hovLabel) hovLabel.style.display = 'none'
        }
      }

      rafId.current = requestAnimationFrame(tick)
    }

    rafId.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId.current)
  }, [
    selectedElement,
    hoveredLoc,
    selectedLoc,
    translateRect,
    applyRect,
    findElementByLoc,
    clearSelection,
    isDragging,
  ])

  return (
    <>
      {/* Selection overlay — solid blue border (dashed green when editing) */}
      <div
        ref={selectionRef}
        className={`selection-overlay ${editorState === 'EDITING_TEXT' ? 'editing' : ''}`}
        style={{ display: 'none' }}
      />

      {/* Selection label badge */}
      {selectedElement && selectionLabel && (
        <div
          ref={selectionLabelRef}
          className="selection-label"
          style={{ display: 'none', position: 'absolute', top: 0, left: 0, willChange: 'transform' }}
        >
          {selectionLabel}
        </div>
      )}

      {/* Drag handle — grip icon top-left of selected element */}
      <div
        ref={dragHandleRef}
        className="drag-handle"
        style={{ display: 'none' }}
        onMouseDown={handleDragStart}
        title="Drag to reorder"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <circle cx="3" cy="2" r="1" />
          <circle cx="7" cy="2" r="1" />
          <circle cx="3" cy="5" r="1" />
          <circle cx="7" cy="5" r="1" />
          <circle cx="3" cy="8" r="1" />
          <circle cx="7" cy="8" r="1" />
        </svg>
      </div>

      {/* Hover overlay — semi-transparent blue */}
      <div
        ref={hoverRef}
        className="hover-overlay"
        style={{ display: 'none' }}
      />

      {/* Hover label badge */}
      <div
        ref={hoverLabelRef}
        className="hover-label"
        style={{ display: 'none', position: 'absolute', top: 0, left: 0, willChange: 'transform' }}
      />

      {/* Drop indicator line */}
      {dropIndicator && (
        <div
          className="drop-indicator"
          style={{
            transform: `translate(${dropIndicator.x}px, ${dropIndicator.y}px)`,
            width: `${dropIndicator.width}px`,
          }}
        />
      )}
    </>
  )
}
