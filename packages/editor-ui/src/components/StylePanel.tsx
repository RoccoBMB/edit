import { useState, useCallback } from 'react'
import { useEditorStore } from '../state/editor-store'

/** Properties displayed in each group */
const SPACING_PROPS = [
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
] as const

const TYPOGRAPHY_PROPS = [
  'font-size',
  'font-weight',
  'font-family',
  'color',
  'text-align',
  'line-height',
  'letter-spacing',
] as const

const SIZE_PROPS = ['width', 'height'] as const

/** Check if a CSS color string looks like a hex value */
function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(value.trim())
}

/** Try to convert rgb(r, g, b) to hex */
function rgbToHex(value: string): string | null {
  const match = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/)
  if (!match) return null
  const [, rStr, gStr, bStr] = match
  if (rStr === undefined || gStr === undefined || bStr === undefined)
    return null
  const r = parseInt(rStr, 10)
  const g = parseInt(gStr, 10)
  const b = parseInt(bStr, 10)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/** Render a color swatch next to the value if it's a color property */
function ColorSwatch({ value }: { value: string }) {
  const hex = isHexColor(value) ? value : rgbToHex(value)
  if (!hex) return null
  return (
    <span
      className="color-swatch"
      style={{ backgroundColor: hex }}
      title={hex}
    />
  )
}

/** Collapsible group */
function StyleGroup({
  title,
  defaultOpen,
  children,
}: {
  title: string
  defaultOpen: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  const toggle = useCallback(() => {
    setOpen((prev) => !prev)
  }, [])

  return (
    <div className="style-group">
      <button
        className="style-group-header"
        onClick={toggle}
        type="button"
        aria-expanded={open}
      >
        <span className="style-group-chevron">{open ? '\u25BE' : '\u25B8'}</span>
        <span>{title}</span>
      </button>
      {open && <div className="style-group-body">{children}</div>}
    </div>
  )
}

/** A single property row */
function StyleRow({
  prop,
  value,
  isInline,
}: {
  prop: string
  value: string
  isInline: boolean
}) {
  const isColorProp = prop === 'color' || prop === 'background-color'
  return (
    <div className="style-row">
      <span className="style-prop-name">{prop}</span>
      <span className={`style-prop-value ${isInline ? '' : 'computed'}`}>
        {isColorProp && <ColorSwatch value={value} />}
        {value}
      </span>
    </div>
  )
}

export function StylePanel() {
  const selectedLoc = useEditorStore((s) => s.selectedLoc)
  const computedStyles = useEditorStore((s) => s.computedStyles)
  const selectedElement = useEditorStore((s) => s.selectedElement)

  if (!selectedLoc || !computedStyles) {
    return (
      <div className="style-panel">
        <h2>Styles</h2>
        <p className="style-panel-empty">Select an element to view styles.</p>
      </div>
    )
  }

  // Get inline styles from the element to distinguish authored vs computed
  const inlineStyle = (selectedElement as HTMLElement | null)?.getAttribute(
    'style',
  )
  const inlineProps = new Set<string>()
  if (inlineStyle) {
    // Parse "prop: value; prop2: value2;" into property names
    const pairs = inlineStyle.split(';')
    for (const pair of pairs) {
      const colonIdx = pair.indexOf(':')
      if (colonIdx > 0) {
        inlineProps.add(pair.slice(0, colonIdx).trim().toLowerCase())
      }
    }
  }

  const getVal = (prop: string): string => computedStyles.get(prop) ?? ''
  const isInline = (prop: string): boolean => inlineProps.has(prop)

  return (
    <div className="style-panel">
      <h2>Styles</h2>

      <StyleGroup title="Spacing" defaultOpen={true}>
        {SPACING_PROPS.map((prop) => (
          <StyleRow
            key={prop}
            prop={prop}
            value={getVal(prop)}
            isInline={isInline(prop)}
          />
        ))}
      </StyleGroup>

      <StyleGroup title="Typography" defaultOpen={true}>
        {TYPOGRAPHY_PROPS.map((prop) => (
          <StyleRow
            key={prop}
            prop={prop}
            value={getVal(prop)}
            isInline={isInline(prop)}
          />
        ))}
      </StyleGroup>

      <StyleGroup title="Size" defaultOpen={true}>
        {SIZE_PROPS.map((prop) => (
          <StyleRow
            key={prop}
            prop={prop}
            value={getVal(prop)}
            isInline={isInline(prop)}
          />
        ))}
      </StyleGroup>

      <StyleGroup title="Raw CSS" defaultOpen={false}>
        <pre className="raw-css">{inlineStyle ?? '(no inline styles)'}</pre>
      </StyleGroup>
    </div>
  )
}
