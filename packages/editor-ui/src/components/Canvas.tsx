import { useRef, useEffect, useCallback } from 'react'
import { useEditorStore } from '../state/editor-store'

export function Canvas() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const setEditorState = useEditorStore((s) => s.setEditorState)
  const selectElement = useEditorStore((s) => s.selectElement)
  const hoverElement = useEditorStore((s) => s.hoverElement)

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const doc = iframe.contentDocument
    if (!doc) return

    setEditorState('IDLE')

    // Click handler: read data-edit-loc, select element
    doc.addEventListener('click', (e: MouseEvent) => {
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
  }, [setEditorState, selectElement, hoverElement])

  // Get the project URL from the editor's URL params
  const projectUrl = getProjectUrl()

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

/** Extract the project preview URL from the editor's URL params */
function getProjectUrl(): string {
  const params = new URLSearchParams(window.location.search)
  const page = params.get('page') ?? 'index.html'
  // The project files are served under /__project__/ by the CLI server
  return `/__project__/${page}`
}
