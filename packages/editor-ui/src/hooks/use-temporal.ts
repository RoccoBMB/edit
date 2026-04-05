import { useEditorStore } from '../state/editor-store'

/**
 * Hook to access Zundo's temporal undo/redo for the editor store.
 */
export function useTemporalStore() {
  const store = useEditorStore.temporal

  return {
    undo: () => store.getState().undo(),
    redo: () => store.getState().redo(),
    clear: () => store.getState().clear(),
  }
}
