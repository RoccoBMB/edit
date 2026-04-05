import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { temporal } from 'zundo'

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

  // Style overrides: loc -> (property -> value) — tracks all style edits
  styleOverrides: Map<string, Map<string, string>>

  // Iframe reference (shared across overlay, layers, style panel)
  iframeElement: HTMLIFrameElement | null

  // Pages
  activePage: string
  pages: string[]
  pageSessionId: number
  fileVersion: number

  // Inline editing
  editingElement: HTMLElement | null
  originalContent: string | null

  // Drag-and-drop
  dragElement: HTMLElement | null
  dragGhost: SerializedRect | null

  // Actions
  setEditorState: (state: EditorState) => void
  selectElement: (loc: string, rect: SerializedRect, element: Element) => void
  hoverElement: (loc: string | null) => void
  clearSelection: () => void
  setActivePage: (page: string) => void
  setPages: (pages: string[]) => void
  navigateToPage: (page: string) => void
  incrementFileVersion: () => void
  updateComputedStyles: (styles: Map<string, string>) => void
  setIframeElement: (iframe: HTMLIFrameElement | null) => void
  applyStyleOverride: (loc: string, property: string, value: string) => void
  startInlineEdit: (element: HTMLElement) => void
  stopInlineEdit: (save: boolean) => void
  startDrag: (element: HTMLElement) => void
  stopDrag: () => void
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
  temporal(
    immer((set) => ({
      editorState: 'LOADING' as EditorState,
      selectedLoc: null,
      selectedRect: null,
      selectedElement: null,
      selectionGeneration: 0,
      hoveredLoc: null,
      hoveredRect: null,
      computedStyles: null,
      styleOverrides: new Map<string, Map<string, string>>(),
      iframeElement: null,
      activePage: 'index.html',
      pages: [] as string[],
      pageSessionId: 0,
      fileVersion: 0,
      editingElement: null,
      originalContent: null,
      dragElement: null,
      dragGhost: null,

      setEditorState: (state: EditorState) =>
        set((draft) => {
          draft.editorState = state
        }),

      selectElement: (loc: string, rect: SerializedRect, element: Element) =>
        set((draft) => {
          draft.selectedLoc = loc
          draft.selectedRect = rect
          draft.selectedElement = element as never
          draft.selectionGeneration++
          draft.editorState = 'IDLE' as EditorState
          draft.computedStyles = readComputedStyles(element) as never
        }),

      hoverElement: (loc: string | null) =>
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

      setActivePage: (page: string) =>
        set((draft) => {
          draft.activePage = page
          draft.editorState = 'NAVIGATING' as EditorState
          draft.selectedLoc = null
          draft.selectedRect = null
          draft.selectedElement = null
          draft.computedStyles = null
          draft.editingElement = null
          draft.originalContent = null
        }),

      setPages: (pages: string[]) =>
        set((draft) => {
          draft.pages = pages as never
        }),

      navigateToPage: (page: string) =>
        set((draft) => {
          draft.activePage = page
          draft.editorState = 'NAVIGATING' as EditorState
          draft.selectedLoc = null
          draft.selectedRect = null
          draft.selectedElement = null
          draft.computedStyles = null
          draft.editingElement = null
          draft.originalContent = null
          draft.hoveredLoc = null
          draft.hoveredRect = null
          draft.pageSessionId++
        }),

      incrementFileVersion: () =>
        set((draft) => {
          draft.fileVersion++
        }),

      updateComputedStyles: (styles: Map<string, string>) =>
        set((draft) => {
          draft.computedStyles = styles as never
        }),

      setIframeElement: (iframe: HTMLIFrameElement | null) =>
        set((draft) => {
          draft.iframeElement = iframe as never
        }),

      applyStyleOverride: (loc: string, property: string, value: string) =>
        set((draft) => {
          const overrides = draft.styleOverrides as Map<string, Map<string, string>>
          let locOverrides = overrides.get(loc)
          if (!locOverrides) {
            locOverrides = new Map<string, string>()
            overrides.set(loc, locOverrides)
          }
          locOverrides.set(property, value)

          // Also update computedStyles for immediate reflection
          const cs = draft.computedStyles as Map<string, string> | null
          if (cs) {
            cs.set(property, value)
          }
        }),

      startInlineEdit: (element: HTMLElement) =>
        set((draft) => {
          draft.editorState = 'EDITING_TEXT' as EditorState
          draft.editingElement = element as never
          draft.originalContent = element.innerHTML
        }),

      stopInlineEdit: (_save: boolean) =>
        set((draft) => {
          const el = draft.editingElement as HTMLElement | null
          if (el) {
            el.contentEditable = 'false'
          }
          draft.editingElement = null
          draft.originalContent = null
          draft.editorState = 'IDLE' as EditorState
        }),

      startDrag: (element: HTMLElement) =>
        set((draft) => {
          draft.editorState = 'DRAGGING' as EditorState
          draft.dragElement = element as never
        }),

      stopDrag: () =>
        set((draft) => {
          draft.editorState = 'IDLE' as EditorState
          draft.dragElement = null
          draft.dragGhost = null
        }),
    })),
    {
      // Zundo options
      limit: 100,
      // Only track undo-able state; exclude transient UI state
      partialize: (state) => ({
        selectedLoc: state.selectedLoc,
        computedStyles: state.computedStyles,
        styleOverrides: state.styleOverrides,
      }),
      // 300ms undo grouping — rapid changes batch into one undo entry
      handleSet: (handleSet) => {
        let debounceTimer: ReturnType<typeof setTimeout> | undefined
        return (state) => {
          clearTimeout(debounceTimer)
          debounceTimer = setTimeout(() => {
            handleSet(state)
          }, 300)
        }
      },
    },
  ),
)
