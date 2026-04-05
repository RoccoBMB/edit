import type { DefaultTreeAdapterMap } from 'parse5'

type Element = DefaultTreeAdapterMap['element']
type ElementLocation = NonNullable<Element['sourceCodeLocation']>

// --- Element identification ---

/** An Element node guaranteed to have source code location info */
export interface LocatedElement extends Element {
  readonly sourceCodeLocation: ElementLocation
}

export function assertLocated(node: Element): asserts node is LocatedElement {
  if (!node.sourceCodeLocation) {
    throw new Error(
      `Element <${node.tagName}> is missing sourceCodeLocation. ` +
      `Ensure parse5 is called with { sourceCodeLocationInfo: true }.`,
    )
  }
}

// --- Edit operations ---

export type EditOperation =
  | { type: 'style-change'; loc: string; property: string; value: string }
  | { type: 'content-change'; loc: string; content: string }
  | { type: 'move-element'; sourceLoc: string; targetLoc: string; position: 'before' | 'after' | 'inside' }
  | { type: 'delete-element'; loc: string }
  | { type: 'duplicate-element'; loc: string }

// --- WebSocket messages ---

export type EditorToServer =
  | { type: 'edit:style'; payload: { loc: string; fingerprint: string; property: string; value: string } }
  | { type: 'edit:content'; payload: { loc: string; fingerprint: string; html: string } }
  | { type: 'edit:move'; payload: { sourceLoc: string; sourceFingerprint: string; targetLoc: string; targetFingerprint: string; position: 'before' | 'after' } }
  | { type: 'file:get-tree' }

export type ServerToEditor =
  | { type: 'file:changed'; payload: { filePath: string; version: number } }
  | { type: 'write:success'; payload: { loc: string; version: number } }
  | { type: 'write:error'; payload: { loc: string; message: string } }
  | { type: 'file:tree'; payload: { files: string[] } }
  | { type: 'edit:morph-html'; payload: { filePath: string; html: string } }

// --- Source location ---

export interface SourceLocation {
  readonly file: string
  readonly line: number
  readonly col: number
}

export function parseEditLoc(loc: string): SourceLocation | null {
  const match = loc.match(/^(.+):(\d+):(\d+)$/)
  if (!match) return null
  const [, file, line, col] = match
  if (!file || !line || !col) return null
  return { file, line: parseInt(line, 10), col: parseInt(col, 10) }
}
