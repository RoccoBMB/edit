import { parse } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']

/**
 * Apply a single CSS property change to an HTML source string using byte-offset surgery.
 * Never re-serializes through parse5 — preserves the user's exact formatting.
 */
export function applyStyleChange(
  source: string,
  fingerprint: string,
  line: number,
  col: number,
  property: string,
  value: string,
): string {
  const document = parse(source, { sourceCodeLocationInfo: true })
  const element = findElement(document.childNodes, fingerprint, line, col)

  if (!element) {
    throw new Error(`Element not found: fp=${fingerprint} line=${line} col=${col}`)
  }

  const loc = element.sourceCodeLocation
  if (!loc) {
    throw new Error('Element missing sourceCodeLocation')
  }

  // Check if the element already has a style attribute
  const styleAttr = element.attrs.find((a) => a.name === 'style')
  const styleLoc = loc.attrs?.['style']

  if (styleAttr && styleLoc) {
    // Element has an existing style attribute — update it via byte offsets
    const existingStyles = parseInlineStyles(styleAttr.value)
    existingStyles.set(property, value)
    const newStyleValue = serializeInlineStyles(existingStyles)

    // The attr location covers the full `style="..."` — we replace value only.
    // styleLoc gives us the offset of the entire attribute including name, =, quotes.
    // We need to find the value portion. We'll replace the entire attribute.
    const attrStart = styleLoc.startOffset
    const attrEnd = styleLoc.endOffset
    const newAttr = `style="${newStyleValue}"`

    return source.slice(0, attrStart) + newAttr + source.slice(attrEnd)
  } else {
    // No style attribute — insert one after the tag name
    const startTag = loc.startTag
    if (!startTag) {
      throw new Error('Element missing startTag location')
    }

    // Find insertion point: after the tag name in the opening tag.
    // The startTag spans the full `<tagName ...attrs...>`.
    // We insert right after `<tagName`.
    const tagStart = startTag.startOffset
    const tagName = element.tagName
    // In the source, find where the tag name ends
    const insertOffset = tagStart + 1 + tagName.length // 1 for '<'
    const newAttr = ` style="${property}: ${value}"`

    return source.slice(0, insertOffset) + newAttr + source.slice(insertOffset)
  }
}

/**
 * Replace the text content of an element.
 */
export function applyContentChange(
  source: string,
  fingerprint: string,
  line: number,
  col: number,
  newContent: string,
): string {
  const document = parse(source, { sourceCodeLocationInfo: true })
  const element = findElement(document.childNodes, fingerprint, line, col)

  if (!element) {
    throw new Error(`Element not found: fp=${fingerprint} line=${line} col=${col}`)
  }

  const loc = element.sourceCodeLocation
  if (!loc) {
    throw new Error('Element missing sourceCodeLocation')
  }

  // We need the range between end of start tag and start of end tag
  const startTag = loc.startTag
  const endTag = loc.endTag

  if (!startTag || !endTag) {
    throw new Error('Element missing start/end tag locations')
  }

  const contentStart = startTag.endOffset
  const contentEnd = endTag.startOffset

  return source.slice(0, contentStart) + newContent + source.slice(contentEnd)
}

/**
 * Move an element to a new position among its siblings.
 * The source and target must share the same parent (sibling reorder only).
 *
 * @param source - The full HTML source string
 * @param sourceFingerprint - Fingerprint of the element to move
 * @param sourceLine - Line number hint for fallback lookup
 * @param sourceCol - Column number hint for fallback lookup
 * @param targetFingerprint - Fingerprint of the reference sibling
 * @param targetLine - Line number hint for fallback lookup
 * @param targetCol - Column number hint for fallback lookup
 * @param position - Insert 'before' or 'after' the target element
 */
export function applyElementMove(
  source: string,
  sourceFingerprint: string,
  sourceLine: number,
  sourceCol: number,
  targetFingerprint: string,
  targetLine: number,
  targetCol: number,
  position: 'before' | 'after',
): string {
  const document = parse(source, { sourceCodeLocationInfo: true })

  const sourceElement = findElement(document.childNodes, sourceFingerprint, sourceLine, sourceCol)
  if (!sourceElement) {
    throw new Error(`Source element not found: fp=${sourceFingerprint} line=${sourceLine} col=${sourceCol}`)
  }

  const targetElement = findElement(document.childNodes, targetFingerprint, targetLine, targetCol)
  if (!targetElement) {
    throw new Error(`Target element not found: fp=${targetFingerprint} line=${targetLine} col=${targetCol}`)
  }

  const sourceLoc = sourceElement.sourceCodeLocation
  const targetLoc = targetElement.sourceCodeLocation
  if (!sourceLoc || !targetLoc) {
    throw new Error('Elements missing sourceCodeLocation')
  }

  // Get the full byte range of the source element (start tag to end tag)
  const sourceStart = sourceLoc.startOffset
  const sourceEnd = sourceLoc.endOffset

  // Get the position of the target element
  const targetStart = targetLoc.startOffset
  const targetEnd = targetLoc.endOffset

  // Extract the source element's HTML
  const movedHtml = source.slice(sourceStart, sourceEnd)

  // We need to handle leading/trailing whitespace around the source element
  // to keep formatting clean. Look for a preceding newline + indentation.
  let removeStart = sourceStart
  let removeEnd = sourceEnd

  // Try to include the preceding whitespace (back to previous newline)
  const beforeSource = source.slice(0, sourceStart)
  const lastNewline = beforeSource.lastIndexOf('\n')
  if (lastNewline >= 0) {
    const between = source.slice(lastNewline, sourceStart)
    // Only consume the whitespace if it's purely whitespace between newline and element
    if (/^\n\s*$/.test(between)) {
      removeStart = lastNewline
    }
  }

  // Try to include a trailing newline
  if (source[removeEnd] === '\n') {
    removeEnd++
  }

  // Step 1: Remove the source element
  const withoutSource = source.slice(0, removeStart) + source.slice(removeEnd)

  // Step 2: Recalculate target position in the modified string
  // If source was before target, the target offset shifts back by the removed length
  const removedLength = removeEnd - removeStart
  let insertOffset: number

  if (position === 'before') {
    insertOffset = targetStart < sourceStart ? targetStart : targetStart - removedLength
  } else {
    insertOffset = targetEnd < sourceStart ? targetEnd : targetEnd - removedLength
  }

  // Determine indentation from the target element for proper formatting
  const beforeTarget = withoutSource.slice(0, insertOffset)
  const lastNl = beforeTarget.lastIndexOf('\n')
  let indent = ''
  if (lastNl >= 0) {
    const lineStart = beforeTarget.slice(lastNl + 1)
    const match = lineStart.match(/^(\s*)/)
    if (match?.[1]) {
      indent = match[1]
    }
  }

  // Build the insertion text
  let insertHtml: string
  if (position === 'before') {
    insertHtml = movedHtml + '\n' + indent
  } else {
    insertHtml = '\n' + indent + movedHtml
  }

  // Step 3: Insert the moved element at the target position
  return withoutSource.slice(0, insertOffset) + insertHtml + withoutSource.slice(insertOffset)
}

/**
 * Atomically write content to a file: write to .tmp, then rename.
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath)
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${crypto.randomBytes(4).toString('hex')}.tmp`)

  fs.writeFileSync(tmpPath, content, 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

// ---------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------

/**
 * Find an element by fingerprint, falling back to line:col matching.
 */
function findElement(
  nodes: Node[],
  fingerprint: string,
  line: number,
  col: number,
): Element | null {
  // First pass: match by fingerprint
  const byFp = findByFingerprint(nodes, fingerprint)
  if (byFp) return byFp

  // Fallback: match by line:col
  return findByLineCol(nodes, line, col)
}

function findByFingerprint(nodes: Node[], fingerprint: string): Element | null {
  for (const node of nodes) {
    if (!isElement(node)) continue

    // Build a fingerprint for this node to compare
    const fp = buildFingerprint(node)
    if (fp === fingerprint) return node

    // Recurse into children
    if (node.childNodes) {
      const found = findByFingerprint(node.childNodes, fingerprint)
      if (found) return found
    }

    // Handle <template> content
    if ('content' in node && node.content) {
      const content = node.content as { childNodes: Node[] }
      const found = findByFingerprint(content.childNodes, fingerprint)
      if (found) return found
    }
  }
  return null
}

function findByLineCol(nodes: Node[], line: number, col: number): Element | null {
  for (const node of nodes) {
    if (!isElement(node)) continue

    const loc = node.sourceCodeLocation
    if (loc) {
      const startLoc = loc.startTag ?? loc
      if (startLoc.startLine === line && startLoc.startCol === col) {
        return node
      }
    }

    if (node.childNodes) {
      const found = findByLineCol(node.childNodes, line, col)
      if (found) return found
    }

    if ('content' in node && node.content) {
      const content = node.content as { childNodes: Node[] }
      const found = findByLineCol(content.childNodes, line, col)
      if (found) return found
    }
  }
  return null
}

/**
 * Build a structural fingerprint matching the one in vite-plugin.ts.
 */
function buildFingerprint(el: Element): string {
  const parts: string[] = []
  let current: Element | null = el

  while (current) {
    const parent = current.parentNode as Element | null
    let segment = current.tagName

    if (parent && 'childNodes' in parent) {
      const siblings = (parent.childNodes as Node[]).filter(isElement)
      const index = siblings.indexOf(current)
      if (index >= 0) {
        segment += `:nth-child(${index + 1})`
      }
    }

    parts.unshift(segment)

    if (parent && 'tagName' in parent) {
      current = parent
    } else {
      break
    }
  }

  return parts.join('>')
}

/**
 * Parse an inline style string into a Map preserving insertion order.
 * "color: red; font-size: 16px" -> Map { "color" => "red", "font-size" => "16px" }
 */
function parseInlineStyles(style: string): Map<string, string> {
  const map = new Map<string, string>()
  const declarations = style.split(';')

  for (const decl of declarations) {
    const colonIdx = decl.indexOf(':')
    if (colonIdx < 0) continue

    const prop = decl.slice(0, colonIdx).trim()
    const val = decl.slice(colonIdx + 1).trim()

    if (prop) {
      map.set(prop, val)
    }
  }

  return map
}

/**
 * Serialize a Map of CSS properties back into an inline style string.
 */
function serializeInlineStyles(styles: Map<string, string>): string {
  const parts: string[] = []
  for (const [prop, val] of styles) {
    parts.push(`${prop}: ${val}`)
  }
  return parts.join('; ')
}

function isElement(node: Node): node is Element {
  return 'tagName' in node && typeof node.tagName === 'string'
}
