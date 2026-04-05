import { useCallback } from 'react'
import { useEditorStore, type ToastItem } from '../state/editor-store'

function ToastEntry({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const typeClass =
    toast.type === 'error'
      ? 'toast--error'
      : toast.type === 'warning'
        ? 'toast--warning'
        : 'toast--success'

  const handleDismiss = useCallback(() => {
    onDismiss(toast.id)
  }, [toast.id, onDismiss])

  return (
    <div className={`toast ${typeClass}`} role="alert">
      <span className="toast-message">{toast.message}</span>
      <button
        type="button"
        className="toast-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="2" y1="2" x2="8" y2="8" />
          <line x1="8" y1="2" x2="2" y2="8" />
        </svg>
      </button>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useEditorStore((s) => s.toasts)
  const dismissToast = useEditorStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <ToastEntry key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  )
}
