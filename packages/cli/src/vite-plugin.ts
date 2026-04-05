import { parse, serialize } from 'parse5'
import type { Plugin, ViteDevServer } from 'vite'
import type { DefaultTreeAdapterMap } from 'parse5'
import { toRelativePath } from './file-jail.js'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']

interface EditPluginOptions {
  projectRoot: string
}

/**
 * Vite plugin that:
 * 1. Injects data-edit-loc attributes on every element (transformIndexHtml)
 * 2. Intercepts HTML hot updates to prevent full page reload (hotUpdate)
 */
export function editVitePlugin({ projectRoot }: EditPluginOptions): Plugin {
  let server: ViteDevServer | undefined

  return {
    name: 'edit-source-locations',

    configureServer(srv) {
      server = srv
    },

    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const filePath = toRelativePath(ctx.filename, projectRoot)
        return injectSourceLocations(html, filePath)
      },
    },

    hotUpdate({ file, server: srv }) {
      // Intercept HTML file changes to prevent full page reload
      if (file.endsWith('.html')) {
        // Send custom event instead of full reload
        srv.ws.send({
          type: 'custom',
          event: 'edit:html-changed',
          data: { file: toRelativePath(file, projectRoot) },
        })
        // Return empty array to suppress default HMR behavior
        return []
      }
    },
  }
}

/**
 * Parse HTML with source locations and inject data-edit-loc on every element.
 * Used for serve-time only (output is ephemeral, never written to user's files).
 */
function injectSourceLocations(html: string, filePath: string): string {
  const document = parse(html, { sourceCodeLocationInfo: true })
  walkAndAnnotate(document.childNodes, filePath)
  return serialize(document)
}

function walkAndAnnotate(nodes: Node[], filePath: string): void {
  for (const node of nodes) {
    if (isElement(node)) {
      const loc = node.sourceCodeLocation
      if (loc) {
        // Use start tag location if available (more precise)
        const startLoc = loc.startTag ?? loc
        const editLoc = `${filePath}:${startLoc.startLine}:${startLoc.startCol}`

        // Build fingerprint: nth-child path from root
        const fingerprint = buildFingerprint(node)

        // Inject attributes
        node.attrs.push(
          { name: 'data-edit-loc', value: editLoc },
          { name: 'data-edit-fp', value: fingerprint },
        )
      }

      // Recurse into children
      if (node.childNodes) {
        walkAndAnnotate(node.childNodes, filePath)
      }

      // Handle <template> content
      if ('content' in node && node.content) {
        const content = node.content as { childNodes: Node[] }
        walkAndAnnotate(content.childNodes, filePath)
      }
    }
  }
}

/**
 * Build a structural fingerprint for an element: tagName + nth-child path.
 * E.g. "html>body>div:nth-child(2)>p:nth-child(1)"
 * This is stable across line number changes.
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

    // Walk up — parentNode might be document (no tagName)
    if (parent && 'tagName' in parent) {
      current = parent
    } else {
      break
    }
  }

  return parts.join('>')
}

function isElement(node: Node): node is Element {
  return 'tagName' in node && typeof node.tagName === 'string'
}
