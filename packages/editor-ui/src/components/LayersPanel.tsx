import { useMemo, useEffect, useRef, useCallback, useState } from 'react'
import { Tree, type NodeRendererProps } from 'react-arborist'
import { useEditorStore } from '../state/editor-store'
import type { TreeApi } from 'react-arborist'

/** Shape of each node in the layer tree */
interface LayerNode {
  id: string
  name: string
  tag: string
  classNames: string
  idAttr: string
  loc: string | null
  children: LayerNode[]
}

/** Tags to filter out of the tree entirely */
const EXCLUDED_TAGS = new Set([
  'script',
  'style',
  'link',
  'meta',
  'head',
  'noscript',
  'br',
])

/** Build structured data for an element */
function buildNodeData(el: Element): { tag: string; classNames: string; idAttr: string; displayName: string } {
  const tag = el.tagName.toLowerCase()
  const id = el.getAttribute('id') ?? ''
  let classNames = ''
  const cls = el.className
  if (typeof cls === 'string' && cls.trim()) {
    classNames = cls
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('')
  }
  let displayName = `<${tag}>`
  if (id) displayName += `#${id}`
  displayName += classNames
  if (displayName.length > 40) {
    displayName = displayName.slice(0, 37) + '...'
  }
  return { tag, classNames, idAttr: id, displayName }
}

/** Recursively build tree data from a DOM element */
function buildTree(el: Element, idPrefix: string): LayerNode | null {
  const tag = el.tagName.toLowerCase()
  if (EXCLUDED_TAGS.has(tag)) return null

  const loc = el.getAttribute('data-edit-loc')
  const id = `${idPrefix}/${tag}[${Array.from(el.parentElement?.children ?? []).indexOf(el)}]`

  const data = buildNodeData(el)

  const children: LayerNode[] = []
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i]
    if (child) {
      const node = buildTree(child, id)
      if (node) children.push(node)
    }
  }

  return {
    id,
    name: data.displayName,
    tag: data.tag,
    classNames: data.classNames,
    idAttr: data.idAttr,
    loc,
    children,
  }
}

/** SVG chevron that rotates on expand/collapse */
function TreeChevron({ isOpen }: { isOpen: boolean }) {
  return (
    <span className={`layer-node-toggle ${isOpen ? 'layer-node-toggle--open' : ''}`}>
      <svg viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <polyline points="2,1 6,4 2,7" />
      </svg>
    </span>
  )
}

/** Custom tree node renderer with syntax-colored names */
function LayerNodeRenderer({
  node,
  style,
  dragHandle,
}: NodeRendererProps<LayerNode>) {
  const selectedLoc = useEditorStore((s) => s.selectedLoc)
  const isActive = node.data.loc !== null && node.data.loc === selectedLoc

  return (
    <div
      className={`layer-node ${isActive ? 'layer-node--active' : ''} ${node.isSelected ? 'layer-node--selected' : ''}`}
      style={style}
      ref={dragHandle}
      onClick={(e) => {
        e.stopPropagation()
        node.handleClick(e)
      }}
    >
      {node.isInternal && (
        <span
          onClick={(e) => {
            e.stopPropagation()
            node.toggle()
          }}
        >
          <TreeChevron isOpen={node.isOpen} />
        </span>
      )}
      {node.isLeaf && <span className="layer-node-leaf-spacer" />}
      <span className="layer-node-name">
        <span className="layer-node-tag">&lt;{node.data.tag}&gt;</span>
        {node.data.idAttr && (
          <span className="layer-node-id">#{node.data.idAttr}</span>
        )}
        {node.data.classNames && (
          <span className="layer-node-class">{node.data.classNames}</span>
        )}
      </span>
    </div>
  )
}

export function LayersPanel() {
  const iframeElement = useEditorStore((s) => s.iframeElement)
  const selectedLoc = useEditorStore((s) => s.selectedLoc)
  const selectElement = useEditorStore((s) => s.selectElement)
  const selectionGeneration = useEditorStore((s) => s.selectionGeneration)
  const treeRef = useRef<TreeApi<LayerNode> | undefined>(undefined)

  // ResizeObserver for dynamic height
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(600)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /** Build tree data from the iframe DOM */
  const treeData = useMemo<LayerNode[]>(() => {
    if (!iframeElement) return []
    const doc = iframeElement.contentDocument
    if (!doc?.body) return []

    const children: LayerNode[] = []
    for (let i = 0; i < doc.body.children.length; i++) {
      const child = doc.body.children[i]
      if (child) {
        const node = buildTree(child, 'root')
        if (node) children.push(node)
      }
    }
    return children
    // Re-build when iframe changes or file version changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeElement, useEditorStore.getState().fileVersion])

  /** Map of loc -> node id for reverse lookup */
  const locToNodeId = useMemo(() => {
    const map = new Map<string, string>()
    function walk(nodes: LayerNode[]) {
      for (const node of nodes) {
        if (node.loc) {
          map.set(node.loc, node.id)
        }
        walk(node.children)
      }
    }
    walk(treeData)
    return map
  }, [treeData])

  /** When a tree node is activated (clicked), select that element in the iframe */
  const handleActivate = useCallback(
    (node: { data: LayerNode }) => {
      const loc = node.data.loc
      if (!loc || !iframeElement) return

      const doc = iframeElement.contentDocument
      if (!doc) return

      const el = doc.querySelector(`[data-edit-loc="${CSS.escape(loc)}"]`)
      if (!el) return

      const rect = el.getBoundingClientRect()
      selectElement(loc, {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      }, el)
    },
    [iframeElement, selectElement],
  )

  /** Sync: when iframe selection changes, scroll to + select that node in tree */
  useEffect(() => {
    if (!selectedLoc || !treeRef.current) return

    const nodeId = locToNodeId.get(selectedLoc)
    if (!nodeId) return

    const tree = treeRef.current
    const node = tree.get(nodeId)
    if (node) {
      // Open parents so the node is visible
      node.openParents()
      // Select and scroll to
      node.select()
      // Scroll into view
      tree.scrollTo(node.id)
    }
  }, [selectedLoc, selectionGeneration, locToNodeId])

  if (treeData.length === 0) {
    return (
      <div className="layers-panel">
        <h2>Layers</h2>
        <p className="layers-panel-empty">
          No elements found. Load a page to see the DOM tree.
        </p>
      </div>
    )
  }

  return (
    <div className="layers-panel">
      <h2>Layers</h2>
      <div className="layers-tree-container" ref={containerRef}>
        <Tree<LayerNode>
          ref={treeRef}
          data={treeData}
          openByDefault={true}
          disableDrag={true}
          disableDrop={true}
          disableEdit={true}
          disableMultiSelection={true}
          onActivate={handleActivate}
          rowHeight={26}
          indent={14}
          width={240}
          height={containerHeight}
          overscanCount={20}
        >
          {LayerNodeRenderer}
        </Tree>
      </div>
    </div>
  )
}
