import { useState, useCallback, useRef, useEffect } from 'react'
import { useEditorStore } from '../state/editor-store'
import { getWsClient } from '../lib/ws-client'

// ---------------------------------------------------------------
// Property group definitions
// ---------------------------------------------------------------

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

/** Numeric properties that get a text input */
const NUMERIC_PROPS = new Set<string>([
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'width', 'height', 'font-size', 'line-height', 'letter-spacing',
])

/** Color properties that get a color picker */
const COLOR_PROPS = new Set<string>(['color', 'background-color'])

const FONT_WEIGHT_OPTIONS = [
  { value: '100', label: '100' },
  { value: '200', label: '200' },
  { value: '300', label: '300' },
  { value: '400', label: '400 (normal)' },
  { value: '500', label: '500' },
  { value: '600', label: '600' },
  { value: '700', label: '700 (bold)' },
  { value: '800', label: '800' },
  { value: '900', label: '900' },
]

const TEXT_ALIGN_OPTIONS = ['left', 'center', 'right', 'justify'] as const
const TEXT_ALIGN_ICONS: Record<string, string> = {
  left: '\u2190',
  center: '\u2194',
  right: '\u2192',
  justify: '\u2500',
}

// ---------------------------------------------------------------
// Debounce utility
// ---------------------------------------------------------------

function useDebouncedCallback(
  fn: (...args: string[]) => void,
  delay: number,
): (...args: string[]) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const debouncedFn = useCallback(
    (...args: string[]) => {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        fnRef.current(...args)
      }, delay)
    },
    [delay],
  )

  return debouncedFn
}

// ---------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(value.trim())
}

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

function toHexForPicker(value: string): string {
  if (isHexColor(value)) return value
  const hex = rgbToHex(value)
  return hex ?? '#000000'
}

// ---------------------------------------------------------------
// Style change dispatcher
// ---------------------------------------------------------------

function useStyleDispatch() {
  const selectedElement = useEditorStore((s) => s.selectedElement)
  const selectedLoc = useEditorStore((s) => s.selectedLoc)
  const applyStyleOverride = useEditorStore((s) => s.applyStyleOverride)

  const debouncedSend = useDebouncedCallback((loc: string, fingerprint: string, property: string, value: string) => {
    const ws = getWsClient()
    ws.sendMessage({
      type: 'edit:style',
      payload: { loc, fingerprint, property, value },
    })
  }, 150)

  const dispatch = useCallback(
    (property: string, value: string) => {
      if (!selectedElement || !selectedLoc) return

      const el = selectedElement as HTMLElement

      // 1. Instant preview in iframe
      const camelProp = property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
      ;(el.style as unknown as Record<string, string>)[camelProp] = value

      // 2. Update store (tracked by undo/redo)
      applyStyleOverride(selectedLoc, property, value)

      // 3. Debounced send to server
      const fingerprint = el.getAttribute('data-edit-fp') ?? ''
      debouncedSend(selectedLoc, fingerprint, property, value)
    },
    [selectedElement, selectedLoc, applyStyleOverride, debouncedSend],
  )

  return dispatch
}

// ---------------------------------------------------------------
// Editable style row components
// ---------------------------------------------------------------

function NumericInput({
  prop,
  value,
  onChange,
}: {
  prop: string
  value: string
  onChange: (prop: string, value: string) => void
}) {
  const [localValue, setLocalValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync local state when computed value changes externally
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value
      setLocalValue(raw)
      // Only dispatch if it looks like a valid CSS value
      if (raw.trim()) {
        onChange(prop, raw)
      }
    },
    [prop, onChange],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Arrow up/down to increment/decrement numeric values
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const match = localValue.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/)
        if (!match) return
        const [, numStr, unit] = match
        if (numStr === undefined) return
        const num = parseFloat(numStr)
        const delta = e.shiftKey ? 10 : 1
        const newNum = e.key === 'ArrowUp' ? num + delta : num - delta
        const newValue = `${newNum}${unit ?? ''}`
        setLocalValue(newValue)
        onChange(prop, newValue)
      }
    },
    [prop, localValue, onChange],
  )

  return (
    <input
      ref={inputRef}
      className="style-input style-input--numeric"
      type="text"
      value={localValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      spellCheck={false}
    />
  )
}

function ColorInput({
  prop,
  value,
  onChange,
}: {
  prop: string
  value: string
  onChange: (prop: string, value: string) => void
}) {
  const hex = toHexForPicker(value)

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(prop, e.target.value)
    },
    [prop, onChange],
  )

  return (
    <span className="style-color-input">
      <input
        type="color"
        className="style-input--color"
        value={hex}
        onChange={handleChange}
      />
      <span className="style-color-hex">{hex}</span>
    </span>
  )
}

function FontWeightSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (prop: string, value: string) => void
}) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange('font-weight', e.target.value)
    },
    [onChange],
  )

  return (
    <select
      className="style-input style-input--select"
      value={value}
      onChange={handleChange}
    >
      {FONT_WEIGHT_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}

function TextAlignButtons({
  value,
  onChange,
}: {
  value: string
  onChange: (prop: string, value: string) => void
}) {
  return (
    <span className="style-text-align-group">
      {TEXT_ALIGN_OPTIONS.map((align) => (
        <button
          key={align}
          type="button"
          className={`style-text-align-btn ${value === align ? 'active' : ''}`}
          onClick={() => onChange('text-align', align)}
          title={align}
        >
          {TEXT_ALIGN_ICONS[align]}
        </button>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------
// Generic editable row that picks the right control
// ---------------------------------------------------------------

function EditableStyleRow({
  prop,
  value,
  onChange,
}: {
  prop: string
  value: string
  onChange: (prop: string, value: string) => void
}) {
  let control: React.ReactNode

  if (prop === 'font-weight') {
    control = <FontWeightSelect value={value} onChange={onChange} />
  } else if (prop === 'text-align') {
    control = <TextAlignButtons value={value} onChange={onChange} />
  } else if (COLOR_PROPS.has(prop)) {
    control = <ColorInput prop={prop} value={value} onChange={onChange} />
  } else if (NUMERIC_PROPS.has(prop)) {
    control = <NumericInput prop={prop} value={value} onChange={onChange} />
  } else {
    // Font-family or other — show as read-only text
    control = <span className="style-prop-value">{value}</span>
  }

  return (
    <div className="style-row">
      <span className="style-prop-name">{prop}</span>
      {control}
    </div>
  )
}

// ---------------------------------------------------------------
// Collapsible group
// ---------------------------------------------------------------

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

// ---------------------------------------------------------------
// Raw CSS editable textarea
// ---------------------------------------------------------------

function RawCssEditor({
  inlineStyle,
  onChange,
}: {
  inlineStyle: string | null
  onChange: (prop: string, value: string) => void
}) {
  const [localValue, setLocalValue] = useState(inlineStyle ?? '')

  useEffect(() => {
    setLocalValue(inlineStyle ?? '')
  }, [inlineStyle])

  const handleBlur = useCallback(() => {
    // Parse all property:value pairs and dispatch each
    const declarations = localValue.split(';')
    for (const decl of declarations) {
      const colonIdx = decl.indexOf(':')
      if (colonIdx < 0) continue
      const prop = decl.slice(0, colonIdx).trim()
      const val = decl.slice(colonIdx + 1).trim()
      if (prop && val) {
        onChange(prop, val)
      }
    }
  }, [localValue, onChange])

  return (
    <textarea
      className="raw-css raw-css--editable"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={handleBlur}
      spellCheck={false}
      rows={4}
    />
  )
}

// ---------------------------------------------------------------
// Main StylePanel
// ---------------------------------------------------------------

export function StylePanel() {
  const selectedLoc = useEditorStore((s) => s.selectedLoc)
  const computedStyles = useEditorStore((s) => s.computedStyles)
  const selectedElement = useEditorStore((s) => s.selectedElement)
  const dispatch = useStyleDispatch()

  if (!selectedLoc || !computedStyles) {
    return (
      <div className="style-panel">
        <h2>Styles</h2>
        <p className="style-panel-empty">Select an element to view styles.</p>
      </div>
    )
  }

  // Get inline styles from the element
  const inlineStyle = (selectedElement as HTMLElement | null)?.getAttribute('style') ?? null

  const getVal = (prop: string): string => computedStyles.get(prop) ?? ''

  return (
    <div className="style-panel">
      <h2>Styles</h2>

      <StyleGroup title="Spacing" defaultOpen={true}>
        {SPACING_PROPS.map((prop) => (
          <EditableStyleRow
            key={prop}
            prop={prop}
            value={getVal(prop)}
            onChange={dispatch}
          />
        ))}
      </StyleGroup>

      <StyleGroup title="Typography" defaultOpen={true}>
        {TYPOGRAPHY_PROPS.map((prop) => (
          <EditableStyleRow
            key={prop}
            prop={prop}
            value={getVal(prop)}
            onChange={dispatch}
          />
        ))}
      </StyleGroup>

      <StyleGroup title="Size" defaultOpen={true}>
        {SIZE_PROPS.map((prop) => (
          <EditableStyleRow
            key={prop}
            prop={prop}
            value={getVal(prop)}
            onChange={dispatch}
          />
        ))}
      </StyleGroup>

      <StyleGroup title="Raw CSS" defaultOpen={false}>
        <RawCssEditor inlineStyle={inlineStyle} onChange={dispatch} />
      </StyleGroup>
    </div>
  )
}
