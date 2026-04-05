import { useState, useCallback, useRef, useEffect } from 'react'
import { useEditorStore } from '../state/editor-store'
import { getWsClient } from '../lib/ws-client'
import { toggleClass } from '../lib/css-inspector'
import type { CSSRuleInfo, CSSRuleDeclaration, ClassInfo, CSSVariableInfo } from '../lib/css-inspector'

// ---------------------------------------------------------------
// Property group definitions (expanded)
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

const LAYOUT_PROPS = [
  'display',
  'position',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'overflow',
] as const

const BACKGROUND_PROPS = ['background-color'] as const

const BORDER_PROPS = ['border', 'border-radius'] as const

/** Numeric properties that get a text input */
const NUMERIC_PROPS = new Set<string>([
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'width', 'height', 'font-size', 'line-height', 'letter-spacing',
  'gap', 'border-radius',
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
  // Handles both comma-separated rgb(r, g, b) and modern space-separated rgb(r g b)
  // Also handles rgba() with optional alpha
  const match = value.match(
    /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+[\d.]+%?)?\s*\)$/
  )
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
// SVG chevron for collapsible sections
// ---------------------------------------------------------------

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <span className={`style-group-chevron ${open ? 'style-group-chevron--open' : ''}`}>
      <svg viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <polyline points="2,1 6,4 2,7" />
      </svg>
    </span>
  )
}

// ---------------------------------------------------------------
// Style change dispatcher
// ---------------------------------------------------------------

function useStyleDispatch() {
  const selectedElement = useEditorStore((s) => s.selectedElement)
  const selectedLoc = useEditorStore((s) => s.selectedLoc)
  const applyStyleOverride = useEditorStore((s) => s.applyStyleOverride)
  const setSaveState = useEditorStore((s) => s.setSaveState)

  const debouncedSend = useDebouncedCallback((loc: string, fingerprint: string, property: string, value: string) => {
    setSaveState('saving')
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

      // 3. Mark as unsaved immediately
      setSaveState('unsaved')

      // 4. Debounced send to server
      const fingerprint = el.getAttribute('data-edit-fp') ?? ''
      debouncedSend(selectedLoc, fingerprint, property, value)
    },
    [selectedElement, selectedLoc, applyStyleOverride, debouncedSend, setSaveState],
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

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value
      setLocalValue(raw)
      if (raw.trim()) {
        onChange(prop, raw)
      }
    },
    [prop, onChange],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
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
// Computed style row (read-only, italic)
// ---------------------------------------------------------------

function ComputedStyleRow({ prop, value }: { prop: string; value: string }) {
  const isColor = COLOR_PROPS.has(prop) && value
  const hex = isColor ? toHexForPicker(value) : null

  return (
    <div className="style-row">
      <span className="style-prop-name">{prop}</span>
      <span className="style-prop-value computed">
        {hex && (
          <span
            className="color-swatch"
            style={{ backgroundColor: hex }}
            aria-label={`Color: ${hex}`}
          />
        )}
        {value}
      </span>
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
        <ChevronIcon open={open} />
        <span>{title}</span>
      </button>
      {open && <div className="style-group-body">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------
// Section 1: Element Identity
// ---------------------------------------------------------------

function ElementIdentity({
  element,
  selectedLoc,
}: {
  element: Element
  selectedLoc: string
}) {
  const el = element as HTMLElement
  const tagName = el.tagName.toLowerCase()
  const id = el.getAttribute('id')
  const classes: string[] = []
  const classList = el.classList
  for (let i = 0; i < classList.length; i++) {
    const cls = classList[i]
    if (cls) classes.push(cls)
  }

  return (
    <div className="element-identity">
      <span className="element-tag">&lt;{tagName}&gt;</span>
      {classes.length > 0 && (
        <div className="class-pill-list">
          {classes.map((cls) => (
            <span className="class-pill" key={cls}>.{cls}</span>
          ))}
        </div>
      )}
      {id && <span className="element-id">#{id}</span>}
      <span className="element-loc">{selectedLoc}</span>
    </div>
  )
}

// ---------------------------------------------------------------
// Section 2: Classes
// ---------------------------------------------------------------

function ClassesSection({
  elementClasses,
  element,
}: {
  elementClasses: ClassInfo[]
  element: Element
}) {
  const [classStates, setClassStates] = useState<Map<string, boolean>>(() => {
    const map = new Map<string, boolean>()
    for (const cls of elementClasses) {
      map.set(cls.name, cls.enabled)
    }
    return map
  })

  // Reset states when element changes
  useEffect(() => {
    const map = new Map<string, boolean>()
    for (const cls of elementClasses) {
      map.set(cls.name, cls.enabled)
    }
    setClassStates(map)
  }, [elementClasses])

  const handleToggle = useCallback(
    (className: string) => {
      setClassStates((prev) => {
        const next = new Map(prev)
        const current = next.get(className) ?? true
        const newEnabled = !current
        next.set(className, newEnabled)
        // Live toggle in iframe
        toggleClass(element, className, newEnabled)
        return next
      })
    },
    [element],
  )

  return (
    <div className="classes-list">
      {elementClasses.map((cls) => {
        const enabled = classStates.get(cls.name) ?? true
        return (
          <label className="class-toggle-row" key={cls.name}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={() => handleToggle(cls.name)}
              aria-label={`Toggle class ${cls.name}`}
            />
            <span className={`class-toggle-name ${!enabled ? 'class-toggle-name--disabled' : ''}`}>
              .{cls.name}
            </span>
            <span className="class-toggle-count">{cls.propertyCount} props</span>
          </label>
        )
      })}
      <button type="button" className="class-add-btn" title="Add a class">
        + Add class
      </button>
    </div>
  )
}

// ---------------------------------------------------------------
// Section 3: Applied CSS Rules
// ---------------------------------------------------------------

function AppliedRulesSection({ rules }: { rules: CSSRuleInfo[] }) {
  if (rules.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', fontStyle: 'italic' }}>
        No matched CSS rules.
      </p>
    )
  }

  return (
    <div>
      {rules.map((rule, ri) => (
        <RuleBlock key={`${rule.selector}-${rule.source}-${ri}`} rule={rule} />
      ))}
    </div>
  )
}

function RuleBlock({ rule }: { rule: CSSRuleInfo }) {
  return (
    <div className="css-rule-block">
      {rule.mediaQuery && (
        <div className="css-rule-media">{rule.mediaQuery}</div>
      )}
      <div className="css-rule-header">
        <span className="css-rule-selector">{rule.selector}</span>
        <span className="css-rule-source">{rule.source}</span>
      </div>
      <div className="css-rule-declarations">
        {rule.declarations.map((decl, di) => (
          <DeclarationRow key={`${decl.property}-${di}`} decl={decl} />
        ))}
      </div>
    </div>
  )
}

function DeclarationRow({ decl }: { decl: CSSRuleDeclaration }) {
  const valueClass = getValueSyntaxClass(decl.value)

  return (
    <div className={`css-rule-decl ${decl.isOverridden ? 'css-rule-decl--overridden' : ''}`}>
      <span className="css-rule-decl-prop">{decl.property}</span>
      <span className="css-rule-decl-value--punctuation">:&nbsp;</span>
      <span className={`css-rule-decl-value ${valueClass}`}>{decl.value}</span>
      <span className="css-rule-decl-value--punctuation">;</span>
    </div>
  )
}

/** Determine syntax highlighting class for a CSS value */
function getValueSyntaxClass(value: string): string {
  // Check for number values (e.g. "48px", "1.5rem", "0")
  if (/^-?\d/.test(value)) return 'css-rule-decl-value--number'
  // Check for color values (hex, rgb, etc.)
  if (/^#[0-9a-fA-F]/.test(value) || /^(rgb|hsl|oklch)/.test(value)) return 'css-rule-decl-value--color'
  // Check for quoted strings
  if (/^["']/.test(value)) return 'css-rule-decl-value--string'
  return ''
}

// ---------------------------------------------------------------
// Section 4: CSS Variables
// ---------------------------------------------------------------

function CSSVariablesSection({ variables }: { variables: CSSVariableInfo[] }) {
  if (variables.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', fontStyle: 'italic' }}>
        No CSS custom properties found.
      </p>
    )
  }

  return (
    <div>
      {variables.map((v) => (
        <div className="css-var-row" key={v.name}>
          <span className="css-var-name">{v.name}</span>
          {v.isColor && (
            <span
              className="css-var-swatch"
              style={{ backgroundColor: v.resolvedValue }}
              aria-label={`Color: ${v.resolvedValue}`}
            />
          )}
          <span className="css-var-value">{v.resolvedValue || v.value}</span>
        </div>
      ))}
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
  const appliedRules = useEditorStore((s) => s.appliedRules)
  const elementClasses = useEditorStore((s) => s.elementClasses)
  const cssVariables = useEditorStore((s) => s.cssVariables)
  const dispatch = useStyleDispatch()

  if (!selectedLoc || !computedStyles) {
    return (
      <div className="style-panel">
        <h2>Styles</h2>
        <p className="style-panel-empty">
          Select an element to inspect its styles and CSS rules.
        </p>
      </div>
    )
  }

  const inlineStyle = (selectedElement as HTMLElement | null)?.getAttribute('style') ?? null
  const getVal = (prop: string): string => computedStyles.get(prop) ?? ''

  return (
    <div className="style-panel">
      <h2>Styles</h2>

      {/* Section 1: Element Identity */}
      {selectedElement && (
        <ElementIdentity element={selectedElement} selectedLoc={selectedLoc} />
      )}

      {/* Section 2: Classes */}
      {elementClasses && elementClasses.length > 0 && selectedElement && (
        <StyleGroup title="Classes" defaultOpen={true}>
          <ClassesSection elementClasses={elementClasses} element={selectedElement} />
        </StyleGroup>
      )}

      {/* Section 3: Applied CSS Rules */}
      {appliedRules && (
        <StyleGroup title="Applied Rules" defaultOpen={true}>
          <AppliedRulesSection rules={appliedRules} />
        </StyleGroup>
      )}

      {/* Section 4: CSS Variables */}
      {cssVariables && (
        <StyleGroup title="CSS Variables" defaultOpen={false}>
          <CSSVariablesSection variables={cssVariables} />
        </StyleGroup>
      )}

      {/* Section 5: Computed Styles */}
      <StyleGroup title="Layout" defaultOpen={false}>
        {LAYOUT_PROPS.map((prop) => (
          <ComputedStyleRow key={prop} prop={prop} value={getVal(prop)} />
        ))}
      </StyleGroup>

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

      <StyleGroup title="Background" defaultOpen={false}>
        {BACKGROUND_PROPS.map((prop) => (
          <EditableStyleRow
            key={prop}
            prop={prop}
            value={getVal(prop)}
            onChange={dispatch}
          />
        ))}
      </StyleGroup>

      <StyleGroup title="Border" defaultOpen={false}>
        {BORDER_PROPS.map((prop) => (
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
