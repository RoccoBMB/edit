import { useEffect, useRef, useCallback } from 'react'
import { useEditorStore, type SerializedRect } from '../state/editor-store'

/**
 * SelectionOverlay renders blue selection and hover highlights
 * over the iframe canvas. It runs a RAF loop to keep rects
 * in sync as the iframe scrolls or resizes.
 */
export function SelectionOverlay() {
  const selectedElement = useEditorStore((s) => s.selectedElement)
  const hoveredLoc = useEditorStore((s) => s.hoveredLoc)
  const selectedLoc = useEditorStore((s) => s.selectedLoc)
  const iframeElement = useEditorStore((s) => s.iframeElement)
  const clearSelection = useEditorStore((s) => s.clearSelection)

  const selectionRef = useRef<HTMLDivElement>(null)
  const hoverRef = useRef<HTMLDivElement>(null)
  const rafId = useRef<number>(0)

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

  useEffect(() => {
    const tick = () => {
      // --- Selection highlight ---
      const selDiv = selectionRef.current
      if (selDiv) {
        if (selectedElement && selectedElement.isConnected) {
          const rect = (selectedElement as HTMLElement).getBoundingClientRect()
          const translated = translateRect(rect)
          if (translated) {
            applyRect(selDiv, translated)
          } else {
            selDiv.style.display = 'none'
          }
        } else {
          selDiv.style.display = 'none'
          // Element disconnected from DOM — clear selection
          if (selectedElement && !selectedElement.isConnected) {
            clearSelection()
          }
        }
      }

      // --- Hover highlight ---
      const hovDiv = hoverRef.current
      if (hovDiv) {
        if (hoveredLoc && hoveredLoc !== selectedLoc) {
          const hoveredEl = findElementByLoc(hoveredLoc)
          if (hoveredEl && hoveredEl.isConnected) {
            const rect = (hoveredEl as HTMLElement).getBoundingClientRect()
            const translated = translateRect(rect)
            if (translated) {
              applyRect(hovDiv, translated)
            } else {
              hovDiv.style.display = 'none'
            }
          } else {
            hovDiv.style.display = 'none'
          }
        } else {
          hovDiv.style.display = 'none'
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
  ])

  return (
    <>
      {/* Selection overlay — solid blue border */}
      <div
        ref={selectionRef}
        className="selection-overlay"
        style={{ display: 'none' }}
      />
      {/* Hover overlay — semi-transparent blue */}
      <div
        ref={hoverRef}
        className="hover-overlay"
        style={{ display: 'none' }}
      />
    </>
  )
}
