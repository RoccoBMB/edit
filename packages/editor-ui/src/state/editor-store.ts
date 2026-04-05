import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

type EditorState =
  | 'LOADING'
  | 'IDLE'
  | 'SELECTING'
  | 'EDITING_STYLE'
  | 'EDITING_TEXT'
  | 'DRAGGING'
  | 'WRITING'
  | 'RECONCILING'
  | 'NAVIGATING'

interface SerializedRect {
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
}

export const useEditorStore = create<EditorStore>()(
  immer((set) => ({
    editorState: 'LOADING',
    selectedLoc: null,
    selectedRect: null,
    selectedElement: null,
    selectionGeneration: 0,
    hoveredLoc: null,
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
      }),

    setActivePage: (page) =>
      set((draft) => {
        draft.activePage = page
        draft.editorState = 'NAVIGATING'
        draft.selectedLoc = null
        draft.selectedRect = null
        draft.selectedElement = null
      }),

    incrementFileVersion: () =>
      set((draft) => {
        draft.fileVersion++
      }),
  })),
)
