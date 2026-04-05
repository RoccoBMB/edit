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
 * Replace the text content of an element (prep for Phase 4).
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
