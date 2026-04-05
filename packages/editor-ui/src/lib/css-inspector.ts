/**
 * CSS Inspector — extracts applied CSS rules, classes, and variables
 * from the iframe's document context.
 *
 * Stub created by Frontend Developer agent.
 * The Software Architect agent will replace this with the full implementation.
 */

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------

export interface CSSRuleDeclaration {
  property: string
  value: string
  important: boolean
  isOverridden: boolean
}

export interface CSSRuleInfo {
  selector: string
  source: string            // e.g. "styles.css:18" or "inline"
  sourceFile: string | null
  sourceLine: number | null
  specificity: [number, number, number]
  mediaQuery: string | null
  declarations: CSSRuleDeclaration[]
}

export interface ClassInfo {
  name: string
  enabled: boolean
  propertyCount: number
}

export interface CSSVariableInfo {
  name: string
  value: string
  resolvedValue: string
  source: string           // e.g. ":root"
  isColor: boolean
}

// ---------------------------------------------------------------
// Specificity computation
// ---------------------------------------------------------------

function computeSpecificity(selector: string): [number, number, number] {
  let ids = 0
  let classes = 0
  let elements = 0

  const idMatches = selector.match(/#[a-zA-Z_-][\w-]*/g)
  if (idMatches) ids = idMatches.length

  const classMatches = selector.match(/\.[a-zA-Z_-][\w-]*/g)
  if (classMatches) classes += classMatches.length
  const attrMatches = selector.match(/\[[^\]]+\]/g)
  if (attrMatches) classes += attrMatches.length
  const pseudoClassMatches = selector.match(/:(?!:)[a-zA-Z-]+/g)
  if (pseudoClassMatches) {
    for (const p of pseudoClassMatches) {
      if (p !== ':where' && p !== ':is' && p !== ':not') {
        classes++
      }
    }
  }

  const stripped = selector
    .replace(/#[a-zA-Z_-][\w-]*/g, '')
    .replace(/\.[a-zA-Z_-][\w-]*/g, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/::[a-zA-Z-]+/g, () => { elements++; return '' })
    .replace(/:[a-zA-Z-]+/g, '')
    .replace(/[>+~*\s,]/g, ' ')
    .trim()

  const elementTokens = stripped.split(/\s+/).filter(Boolean)
  elements += elementTokens.length

  return [ids, classes, elements]
}

// ---------------------------------------------------------------
// Stylesheet source resolution
// ---------------------------------------------------------------

function getStylesheetSource(sheet: CSSStyleSheet): string {
  if (sheet.href) {
    try {
      const url = new URL(sheet.href)
      const parts = url.pathname.split('/')
      return parts[parts.length - 1] ?? sheet.href
    } catch {
      return sheet.href
    }
  }
  if (sheet.ownerNode instanceof HTMLStyleElement) {
    return '<style>'
  }
  return 'unknown'
}

function findRuleLineNumber(
  _sheet: CSSStyleSheet,
  _ruleIndex: number,
): number | null {
  return null
}

// ---------------------------------------------------------------
// Main functions
// ---------------------------------------------------------------

export function getAppliedRules(element: Element): CSSRuleInfo[] {
  const rules: CSSRuleInfo[] = []
  const el = element as HTMLElement
  const doc = el.ownerDocument
  if (!doc) return rules

  // 1. Collect inline styles as a synthetic rule
  const inlineStyle = el.getAttribute('style')
  if (inlineStyle) {
    const declarations: CSSRuleDeclaration[] = []
    const parts = inlineStyle.split(';')
    for (const part of parts) {
      const colonIdx = part.indexOf(':')
      if (colonIdx < 0) continue
      const prop = part.slice(0, colonIdx).trim()
      const val = part.slice(colonIdx + 1).trim()
      if (prop && val) {
        declarations.push({
          property: prop,
          value: val,
          important: val.includes('!important'),
          isOverridden: false,
        })
      }
    }
    if (declarations.length > 0) {
      rules.push({
        selector: 'element.style',
        source: 'inline',
        sourceFile: null,
        sourceLine: null,
        specificity: [1, 0, 0] as [number, number, number],
        mediaQuery: null,
        declarations,
      })
    }
  }

  // 2. Iterate stylesheets
  try {
    const sheets = doc.styleSheets
    for (let si = 0; si < sheets.length; si++) {
      const sheet = sheets[si]
      if (!sheet) continue
      let cssRules: CSSRuleList
      try {
        cssRules = sheet.cssRules
      } catch {
        continue
      }

      const sourceName = getStylesheetSource(sheet)

      for (let ri = 0; ri < cssRules.length; ri++) {
        const rule = cssRules[ri]
        if (!rule) continue

        if (rule instanceof CSSStyleRule) {
          collectStyleRule(rule, element, sourceName, sheet, ri, null, rules)
        } else if (rule instanceof CSSMediaRule) {
          const win = doc.defaultView
          if (win && win.matchMedia(rule.conditionText).matches) {
            for (let mi = 0; mi < rule.cssRules.length; mi++) {
              const mediaChild = rule.cssRules[mi]
              if (mediaChild instanceof CSSStyleRule) {
                collectStyleRule(
                  mediaChild,
                  element,
                  sourceName,
                  sheet,
                  ri,
                  `@media ${rule.conditionText}`,
                  rules,
                )
              }
            }
          }
        }
      }
    }
  } catch {
    // Fail gracefully
  }

  // 3. Sort by specificity (highest first)
  rules.sort((a, b) => {
    if (a.selector === 'element.style') return -1
    if (b.selector === 'element.style') return 1
    for (let i = 0; i < 3; i++) {
      if (a.specificity[i]! !== b.specificity[i]!) {
        return b.specificity[i]! - a.specificity[i]!
      }
    }
    return 0
  })

  // 4. Mark overridden declarations
  const claimedProps = new Set<string>()
  for (const rule of rules) {
    for (const decl of rule.declarations) {
      const key = decl.property
      if (claimedProps.has(key)) {
        decl.isOverridden = true
      } else {
        claimedProps.add(key)
      }
    }
  }

  return rules
}

function collectStyleRule(
  rule: CSSStyleRule,
  element: Element,
  sourceName: string,
  sheet: CSSStyleSheet,
  ruleIndex: number,
  mediaQuery: string | null,
  out: CSSRuleInfo[],
): void {
  try {
    if (!element.matches(rule.selectorText)) return
  } catch {
    return
  }

  const declarations: CSSRuleDeclaration[] = []
  const style = rule.style
  for (let di = 0; di < style.length; di++) {
    const prop = style[di]
    if (!prop) continue
    const value = style.getPropertyValue(prop)
    const priority = style.getPropertyPriority(prop)
    declarations.push({
      property: prop,
      value: priority ? `${value} !important` : value,
      important: !!priority,
      isOverridden: false,
    })
  }

  if (declarations.length === 0) return

  const lineNumber = findRuleLineNumber(sheet, ruleIndex)
  const sourceStr = lineNumber !== null ? `${sourceName}:${lineNumber}` : sourceName

  out.push({
    selector: rule.selectorText,
    source: sourceStr,
    sourceFile: sheet.href ? sourceName : null,
    sourceLine: lineNumber,
    specificity: computeSpecificity(rule.selectorText),
    mediaQuery,
    declarations,
  })
}

export function getElementClasses(element: Element): ClassInfo[] {
  const el = element as HTMLElement
  const doc = el.ownerDocument
  const classes: ClassInfo[] = []

  const classList = el.classList
  for (let i = 0; i < classList.length; i++) {
    const cls = classList[i]
    if (!cls) continue

    let propCount = 0
    try {
      const sheets = doc.styleSheets
      for (let si = 0; si < sheets.length; si++) {
        const sheet = sheets[si]
        if (!sheet) continue
        let cssRules: CSSRuleList
        try {
          cssRules = sheet.cssRules
        } catch {
          continue
        }
        for (let ri = 0; ri < cssRules.length; ri++) {
          const rule = cssRules[ri]
          if (rule instanceof CSSStyleRule) {
            if (rule.selectorText.includes(`.${cls}`)) {
              propCount += rule.style.length
            }
          }
        }
      }
    } catch {
      // ignore
    }

    classes.push({
      name: cls,
      enabled: true,
      propertyCount: propCount,
    })
  }

  return classes
}

export function getCSSVariables(element: Element): CSSVariableInfo[] {
  const el = element as HTMLElement
  const doc = el.ownerDocument
  const win = doc.defaultView
  if (!win) return []

  const variables: CSSVariableInfo[] = []
  const seen = new Set<string>()

  try {
    const sheets = doc.styleSheets
    for (let si = 0; si < sheets.length; si++) {
      const sheet = sheets[si]
      if (!sheet) continue
      let cssRules: CSSRuleList
      try {
        cssRules = sheet.cssRules
      } catch {
        continue
      }

      for (let ri = 0; ri < cssRules.length; ri++) {
        const rule = cssRules[ri]
        if (!(rule instanceof CSSStyleRule)) continue

        const style = rule.style
        for (let di = 0; di < style.length; di++) {
          const prop = style[di]
          if (!prop || !prop.startsWith('--')) continue
          if (seen.has(prop)) continue
          seen.add(prop)

          const resolved = win.getComputedStyle(el).getPropertyValue(prop).trim()
          const rawValue = style.getPropertyValue(prop).trim()

          variables.push({
            name: prop,
            value: rawValue,
            resolvedValue: resolved,
            source: rule.selectorText,
            isColor: isColorValue(resolved),
          })
        }
      }
    }
  } catch {
    // ignore
  }

  return variables
}

export function toggleClass(element: Element, className: string, enabled: boolean): void {
  if (enabled) {
    element.classList.add(className)
  } else {
    element.classList.remove(className)
  }
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function isColorValue(value: string): boolean {
  if (!value) return false
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return true
  if (/^(rgb|rgba|hsl|hsla|oklch|oklab|lch|lab|color)\(/.test(value)) return true
  const named = new Set([
    'red', 'blue', 'green', 'white', 'black', 'yellow', 'orange', 'purple',
    'pink', 'cyan', 'magenta', 'gray', 'grey', 'transparent', 'inherit',
    'currentcolor', 'currentColor',
  ])
  if (named.has(value.toLowerCase())) return true
  return false
}
