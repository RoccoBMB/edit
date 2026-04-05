import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export type EditorState =
  | 'LOADING'
  | 'IDLE'
  | 'SELECTING'
  | 'EDITING_STYLE'
  | 'EDITING_TEXT'
  | 'DRAGGING'
  | 'WRITING'
  | 'RECONCILING'
  | 'NAVIGATING'

export interface SerializedRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface EditorStore {
  // State machine
  editorState: EditorState

  // Selection
  selectedLoc: string | null
  selectedRect: SerializedRect | null
  selectedElement: Element | null
  selectionGeneration: number
  hoveredLoc: string | null
  hoveredRect: SerializedRect | null

  // Computed styles for selected element
  computedStyles: Map<string, string> | null

  // Iframe reference (shared across overlay, layers, style panel)
  iframeElement: HTMLIFrameElement | null

  // Pages
  activePage: string
  fileVersion: number

  // Actions
  setEditorState: (state: EditorState) => void
  selectElement: (loc: string, rect: SerializedRect, element: Element) => void
  hoverElement: (loc: string | null) => void
  clearSelection: () => void
  setActivePage: (page: string) => void
  incrementFileVersion: () => void
  updateComputedStyles: (styles: Map<string, string>) => void
  setIframeElement: (iframe: HTMLIFrameElement | null) => void
}

/** Read key computed style properties from an element */
function readComputedStyles(element: Element): Map<string, string> {
  const styles = new Map<string, string>()
  const el = element as HTMLElement
  const win = el.ownerDocument.defaultView
  if (!win) return styles

  const cs = win.getComputedStyle(el)

  const props = [
    // Spacing
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    // Typography
    'font-size', 'font-weight', 'font-family', 'color',
    'text-align', 'line-height', 'letter-spacing',
    // Size
    'width', 'height',
    // Display / Position
    'display', 'position',
    // Background
    'background-color',
    // Border
    'border', 'border-radius',
  ]

  for (const prop of props) {
    styles.set(prop, cs.getPropertyValue(prop))
  }

  return styles
}

export const useEditorStore = create<EditorStore>()(
  immer((set) => ({
    editorState: 'LOADING',
    selectedLoc: null,
    selectedRect: null,
    selectedElement: null,
    selectionGeneration: 0,
    hoveredLoc: null,
    hoveredRect: null,
    computedStyles: null,
    iframeElement: null,
    activePage: 'index.html',
    fileVersion: 0,

    setEditorState: (state) =>
      set((draft) => {
        draft.editorState = state
      }),

    selectElement: (loc, rect, element) =>
      set((draft) => {
        draft.selectedLoc = loc
        draft.selectedRect = rect
        draft.selectedElement = element as never
        draft.selectionGeneration++
        draft.editorState = 'IDLE'
        draft.computedStyles = readComputedStyles(element) as never
      }),

    hoverElement: (loc) =>
      set((draft) => {
        draft.hoveredLoc = loc
      }),

    clearSelection: () =>
      set((draft) => {
        draft.selectedLoc = null
        draft.selectedRect = null
        draft.selectedElement = null
        draft.computedStyles = null
      }),

    setActivePage: (page) =>
      set((draft) => {
        draft.activePage = page
        draft.editorState = 'NAVIGATING'
        draft.selectedLoc = null
        draft.selectedRect = null
        draft.selectedElement = null
        draft.computedStyles = null
      }),

    incrementFileVersion: () =>
      set((draft) => {
        draft.fileVersion++
      }),

    updateComputedStyles: (styles) =>
      set((draft) => {
        draft.computedStyles = styles as never
      }),

    setIframeElement: (iframe) =>
      set((draft) => {
        draft.iframeElement = iframe as never
      }),
  })),
)
