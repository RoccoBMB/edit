import fs from 'node:fs'

/**
 * Serialized write queue.
 * - One write at a time per file.
 * - Latest-wins: if another mutation arrives while one is running,
 *   only the most recent mutation executes.
 * - Tracks own writes so the Vite watcher can suppress HMR for them.
 */
export interface WriteQueue {
  enqueue(filePath: string, mutation: (source: string) => string): Promise<void>
  readonly ownWrites: Set<string>
}

interface PendingWrite {
  mutation: (source: string) => string
  resolve: () => void
  reject: (err: unknown) => void
}

export function createWriteQueue(): WriteQueue {
  /** Files currently being written (locked) */
  const active = new Set<string>()

  /** Latest pending write per file (only the most recent is kept) */
  const pending = new Map<string, PendingWrite>()

  /** Set of file paths written by us. Vite's watcher checks this set. */
  const ownWrites = new Set<string>()

  async function enqueue(
    filePath: string,
    mutation: (source: string) => string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // If there's an existing pending write for this file, replace it
      // (latest-wins). The replaced write's promise resolves when the
      // new one does (it was superseded).
      const existing = pending.get(filePath)
      if (existing) {
        // The old mutation was superseded — resolve it immediately
        existing.resolve()
      }

      pending.set(filePath, { mutation, resolve, reject })

      // If no write is active for this file, start processing
      if (!active.has(filePath)) {
        void processNext(filePath)
      }
    })
  }

  async function processNext(filePath: string): Promise<void> {
    const next = pending.get(filePath)
    if (!next) return

    pending.delete(filePath)
    active.add(filePath)

    try {
      // Read current source
      const source = fs.readFileSync(filePath, 'utf-8')

      // Apply the mutation
      const result = next.mutation(source)

      // Mark as own write BEFORE writing so the watcher sees it
      ownWrites.add(filePath)

      // Write atomically
      fs.writeFileSync(filePath, result, 'utf-8')

      next.resolve()
    } catch (err) {
      next.reject(err)
    } finally {
      active.delete(filePath)

      // Process any pending writes that queued while we were writing
      if (pending.has(filePath)) {
        void processNext(filePath)
      }
    }
  }

  return { enqueue, ownWrites }
}
