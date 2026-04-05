# Style Panel Redesign -- UX Specification

## Executive Summary

The current Style Panel shows computed CSS values in 3 collapsible groups (Spacing, Typography, Size) plus a raw CSS textarea. It writes all edits as inline styles via `style=""` attribute manipulation. The user has no visibility into CSS classes, matched stylesheet rules, CSS variables, or where edits land. This spec defines the information architecture, interaction patterns, and state model for a redesigned panel that surfaces all of that.

---

## 1. Panel Layout Architecture

### Decision: Stacked Scrollable Sections (not tabs)

**Why not tabs?** Tabs hide information. When inspecting a `<h1 class="hero-title text-xl">`, the user needs to see its classes AND the matched rules AND the computed result simultaneously. Tab-switching between "Classes" and "Rules" would require holding information in working memory. Chrome DevTools uses a single scrollable view for exactly this reason.

**Why not a Webflow-style property panel?** Webflow groups styles by visual category (Typography, Spacing, Size) and hides the cascade entirely. That works when Webflow IS the source of truth. In this editor, the user's actual CSS files are the source of truth, so the cascade must be visible.

**The model**: Chrome DevTools' Elements > Styles pane, adapted for a 320px sidebar. Top-to-bottom: identity, classes, matched rules (specificity order), variables, computed values.

### ASCII Wireframe

```
+------------------------------------------+
|  STYLE PANEL (320px)                     |
+------------------------------------------+
|                                          |
|  ELEMENT IDENTITY                        |
|  <h1>  .hero-title .text-xl  #main-head  |
|  index.html:42:5                         |
|                                          |
+- - - - - - - - - - - - - - - - - - - - -+
|                                          |
|  CLASSES                          [+ Add]|
|  +----------------------------------+    |
|  | [x] hero-title  (4 props)       |    |
|  | [x] text-xl     (2 props)       |    |
|  | [ ] sr-only     (toggled off)   |    |
|  +----------------------------------+    |
|                                          |
+- - - - - - - - - - - - - - - - - - - - -+
|                                          |
|  APPLIED RULES              [Specificity]|
|                                          |
|  .hero-title               styles.css:18 |
|  v  color .......... var(--color-primary)|
|     font-size .............. clamp(...)  |
|     ~~margin-top ................ 0~~    |
|     letter-spacing ........... -0.02em  |
|                                          |
|  .text-xl                  styles.css:94 |
|  v  font-size ................... 2.5rem |
|     line-height .................... 1.2 |
|                                          |
|  h1                        styles.css:7  |
|  v  ~~font-size .............. 2em~~     |
|     font-weight ................... 700  |
|     margin-block-start ..... 0.67em     |
|                                          |
|  @media (max-width: 768px)               |
|    .hero-title             styles.css:112|
|  v    font-size ................. 1.5rem |
|                                          |
|  element.style                    inline |
|     padding ................... 20px     |
|                                          |
|  [+ Add Property]                        |
|                                          |
+- - - - - - - - - - - - - - - - - - - - -+
|                                          |
|  CSS VARIABLES                           |
|                                          |
|  --color-primary       #4a90d9     :root |
|  --color-surface       #2a2a3e     :root |
|  --font-display  "Inter", sans-s.. :root |
|  --space-lg                1.5rem  :root |
|                                          |
|  [Show all 24 variables]                 |
|                                          |
+- - - - - - - - - - - - - - - - - - - - -+
|                                          |
|  COMPUTED                                |
|                                          |
|  > Layout & Display                      |
|  > Spacing                               |
|  v Typography                            |
|     font-size ........... 40px           |
|     font-weight ......... 700            |
|     font-family . "Inter", sans-serif    |
|     color ............... rgb(74,144,217)|
|     text-align .......... left           |
|     line-height ......... 48px           |
|     letter-spacing ...... -0.8px         |
|  > Size                                  |
|  > Background & Border                   |
|  > Effects                               |
|                                          |
+------------------------------------------+
```

---

## 2. Section-by-Section Content Spec

### 2.1 Element Identity

**Purpose**: Answer "what did I click?" at a glance.

| Field | Source | Display |
|-------|--------|---------|
| Tag name | `element.tagName` | Monospace, lowercase, `<h1>` format |
| Classes | `element.classList` | Dot-prefixed pills: `.hero-title` `.text-xl` |
| ID | `element.id` | Hash-prefixed: `#main-head` |
| Source location | `data-edit-loc` attribute | `index.html:42:5` -- clickable, opens file in VS Code via `vscode://` protocol |

**Visual treatment**: Compact, 2 rows max. Tag + classes + id on first line. Source location on second line in secondary text color (`--text-secondary`).

**Interaction**: Clicking the source location string emits a `file:open` WebSocket message that the CLI process can handle (open in $EDITOR or emit a `vscode://` URL).

---

### 2.2 Classes Section

**Purpose**: Show which CSS classes are applied. Toggle them on/off for live experimentation. Add/remove classes.

**Display format**: Vertical list of checkbox rows. Each row contains:

```
[checkbox] class-name  (N props)  [x remove]
```

- **Checkbox**: Checked = class is applied. Unchecked = class is temporarily removed from the element's `classList` in the iframe (live preview). The class remains in the HTML source until explicitly removed.
- **Property count**: `(4 props)` badge -- the number of CSS declarations in the most specific rule that matches this class. Helps the user understand the "weight" of each class. Computed by iterating `document.styleSheets` in the iframe.
- **Remove button**: Small `x` icon on hover. Removing a class both removes it from the iframe DOM AND sends an `edit:class-remove` message to persist the change to source.

**Add class**: An inline text input that appears when the user clicks `[+ Add]`. Features:
- Autocomplete dropdown populated from all class names found across all stylesheets in the iframe (`document.styleSheets`). Fuzzy-match as the user types.
- On Enter or selection, adds the class to the element in iframe DOM and sends `edit:class-add` to persist to source.
- The dropdown shows a preview of what properties each class sets: `.btn-primary -> background: blue; color: white; padding: 8px 16px`.

**Toggle behavior**:
- Toggling a class OFF: calls `element.classList.remove(className)` on the iframe element. This is a preview-only change. The source file is NOT modified. A small "unsaved" dot appears on the checkbox.
- Re-toggling ON: calls `element.classList.add(className)` to restore.
- The distinction between "preview toggle" and "persistent remove" is critical. Toggle = experiment. Remove = commit.

**Data requirements** (new store fields):
```typescript
// New fields in EditorStore
elementClasses: string[]              // classList of selected element
classPropertyCounts: Map<string, number>  // className -> declaration count
allProjectClasses: string[]           // for autocomplete, from all stylesheets
```

---

### 2.3 Applied CSS Rules Section

**Purpose**: Show every CSS rule that matches this element, ordered by specificity (highest first), with overridden properties struck through.

This is the core of the redesign. It answers: "where did this value come from?" and "where will my edit go?"

**Data source**: The iframe's `window.getComputedStyle()` only gives final values. To get matched rules, the editor must use `element.ownerDocument.defaultView.getMatchedCSSRules(element)` (deprecated) or, more reliably, iterate `document.styleSheets` and test each rule's selector against the element with `element.matches(rule.selectorText)`.

**Implementation approach**: A new utility function runs inside the iframe context:

```typescript
interface MatchedRule {
  selector: string          // e.g. ".hero-title"
  source: string            // e.g. "styles.css:18" or "inline"
  specificity: [number, number, number]  // [id, class, element]
  mediaQuery: string | null // e.g. "@media (max-width: 768px)" or null
  declarations: Array<{
    property: string
    value: string
    isOverridden: boolean   // true if a higher-specificity rule sets the same property
  }>
}
```

**Display format**:

Each rule block shows:
1. **Selector** (bold, monospace) -- e.g. `.hero-title`
2. **Source badge** (right-aligned, secondary text) -- e.g. `styles.css:18` or `inline`
3. **Declarations** indented underneath:
   - Normal property: `property ............ value`
   - Overridden property: ~~`property ............ value`~~ (strikethrough + dimmed)
   - The dotted leader between property and value uses a CSS `flex` layout with a dotted border-bottom on a spacer div.

**Rule ordering** (top to bottom):
1. `element.style` (inline styles) -- highest priority
2. Rules ordered by specificity, highest first
3. Within equal specificity, later-in-source-order wins (standard cascade)
4. `@media` rules shown with their query as a parent label, indented

**Overridden detection**: For each property across all matched rules, only the first (highest-specificity) occurrence is "active." All subsequent occurrences of the same property are marked `isOverridden: true`.

**`!important` handling**: Properties with `!important` override normal specificity rules. They display with an `!important` badge and sort above non-important rules for the same property.

**Inline editing of rule properties**:
- Clicking a VALUE (not property name) turns it into an editable input.
- The input shows a small colored badge indicating WHERE the edit will be saved:
  - Blue "inline" badge = writes to element's `style` attribute (current behavior)
  - Green "styles.css:18" badge = writes to the CSS file at that line (NEW capability)
- Editing a rule-level value sends a new `edit:css-rule` WebSocket message:
  ```typescript
  { type: 'edit:css-rule', payload: {
    file: 'styles.css',
    line: 18,
    property: 'color',
    value: '#ff0000'
  }}
  ```
- The server-side handler uses the same byte-offset surgery approach as `applyStyleChange`, but targets `.css` files instead of `.html` files. This requires a new `applyCssRuleChange()` function in `source-writer.ts`.

**"Add Property" button**: At the bottom of the rules section. Clicking it shows a property name autocomplete input. After selecting a property, a value input appears. The new declaration is added to the FIRST matched rule (highest specificity). If no rules match, it falls back to inline style.

---

### 2.4 CSS Variables Section

**Purpose**: Show all CSS custom properties (`--*`) that are accessible to the selected element, with their resolved values.

**Data source**: `getComputedStyle(element).getPropertyValue('--variable-name')` for each known variable. To discover variable names, iterate all stylesheets and collect property names starting with `--`.

**Display format**:

```
--variable-name    resolved-value    :root
```

Three columns:
1. Variable name (monospace, `--text-secondary` color for the `--` prefix, `--text-primary` for the rest)
2. Resolved value (color swatch for color values, plain text for others)
3. Source selector (`:root`, `.dark-theme`, etc.) in secondary text

**Grouping strategy**: Group by prefix convention:
- `--color-*` -- Color variables
- `--space-*` / `--spacing-*` -- Spacing
- `--font-*` -- Typography
- `--size-*` / `--radius-*` -- Sizing
- Other -- Ungrouped

If fewer than 8 variables total, show flat list (no groups). If more than 8, show groups collapsed with counts.

**Initial display**: Show only variables that are USED by the currently matched rules. A "Show all N variables" toggle expands to show every custom property in the cascade.

**Editing**: Clicking a resolved value opens an inline editor. Editing sends an `edit:css-rule` message targeting the rule that defines the variable (usually `:root`). A warning tooltip appears: "This will change --color-primary everywhere it's used."

**Color value treatment**: For variables whose resolved value is a color, show a small color swatch (12x12px) next to the value. Clicking the swatch opens the native color picker (same pattern as the existing `ColorInput` component).

---

### 2.5 Computed Styles Section

**Purpose**: Show the final rendered values after the cascade resolves. Read-only reference. This is the "ground truth" view.

**Groups** (expanded from current 3 to 7):

| Group | Properties |
|-------|-----------|
| Layout & Display | `display`, `position`, `top`, `right`, `bottom`, `left`, `z-index`, `float`, `clear`, `overflow`, `flex-direction`, `flex-wrap`, `justify-content`, `align-items`, `gap`, `grid-template-columns`, `grid-template-rows` |
| Spacing | `margin-top`, `margin-right`, `margin-bottom`, `margin-left`, `padding-top`, `padding-right`, `padding-bottom`, `padding-left` |
| Typography | `font-size`, `font-weight`, `font-family`, `color`, `text-align`, `line-height`, `letter-spacing`, `text-decoration`, `text-transform`, `white-space`, `word-break` |
| Size | `width`, `height`, `min-width`, `min-height`, `max-width`, `max-height` |
| Background & Border | `background-color`, `background-image`, `border`, `border-radius`, `box-shadow`, `outline` |
| Effects | `opacity`, `transform`, `transition`, `animation`, `filter`, `backdrop-filter`, `mix-blend-mode` |
| Other | Any property not in the above groups that has a non-default value |

**Visual treatment**:
- All values are displayed in `--text-secondary` (gray/italic) to visually communicate "read-only, this is what the browser computed."
- Values that differ from the browser default are shown in `--text-primary` (white) to draw attention.
- Color values show a swatch. Clicking a computed color value copies it to clipboard.
- Clicking any computed value focuses the corresponding value in the Applied Rules section above and scrolls to it. This answers: "I see the computed value is 40px, but where is it set?"

**Collapsed by default**: Only Typography and Spacing groups open by default (matching current behavior). Others collapsed.

---

## 3. Interaction Pattern Table

| User Action | Visual Behavior | Data Effect | Write Target |
|---|---|---|---|
| Click element in iframe | Identity section updates. Classes, rules, variables, computed all refresh. | `selectElement()` fires. New `readMatchedRules()` and `readCssVariables()` functions execute in iframe context. | No write. |
| Toggle class checkbox OFF | Class name gets strikethrough. Iframe preview updates instantly. | `element.classList.remove(cls)` in iframe. Store marks class as "toggled off." | No write (preview only). |
| Toggle class checkbox ON | Strikethrough removed. Iframe preview restores. | `element.classList.add(cls)` in iframe. | No write (preview only). |
| Click [x] remove on a class | Class pill disappears. Confirmation toast: "Removed .hero-title" with undo link. | `element.classList.remove(cls)` + `edit:class-remove` WS message. | HTML source file: removes class name from `class=""` attribute. |
| Click [+ Add], type, select | New class pill appears with checkbox checked. Iframe updates. | `element.classList.add(cls)` + `edit:class-add` WS message. | HTML source file: adds class name to `class=""` attribute. |
| Click a rule property VALUE | Value becomes an editable input. Source badge appears below input. | Local state: `editingRuleProperty`. | No write yet. |
| Change rule property value + blur/Enter | Iframe updates instantly (inline style preview). Debounced write. | `applyStyleOverride()` for instant preview. After debounce: WS message. | CSS file at the rule's source line. If inline rule: HTML source `style=""`. |
| Click "Add Property" in rules | Property name autocomplete input appears. | Local state. | No write yet. |
| Type property name, Tab, type value, Enter | New declaration appears in the rule. Iframe updates. | Same as editing a value. | CSS file at the top matched rule's source. |
| Click a CSS variable value | Value becomes editable. Warning tooltip shows. | Local state: `editingVariable`. | No write yet. |
| Change CSS variable value + blur/Enter | Iframe updates (all usages update). Debounced write. | Sets `--var-name` on the defining rule's element in iframe. After debounce: WS message. | CSS file at the variable's definition line (:root rule). |
| Click a computed value | Scrolls Applied Rules section to the rule that sets this property. Highlights it. | UI scroll + highlight state. | No write. |
| Click source location link | Opens file in external editor. | `file:open` WS message to CLI. | No write. |
| Arrow Up/Down on numeric input | Value increments/decrements. Shift = 10x step. | Same as editing a value. | Same as editing a value. |
| Alt + click a color swatch | Copies color value to clipboard. | Clipboard write. Toast: "Copied #4a90d9". | No write. |

---

## 4. State Definitions

### 4.1 Empty State (no element selected)

```
+------------------------------------------+
|  STYLE PANEL                             |
|                                          |
|      [element icon]                      |
|                                          |
|   Select an element to inspect           |
|   its styles and CSS rules.              |
|                                          |
|   Click any element on the canvas,       |
|   or select one from the Layers panel.   |
|                                          |
+------------------------------------------+
```

No sections rendered. Single centered message with muted icon.

### 4.2 Loading State (element selected, data resolving)

```
+------------------------------------------+
|  ELEMENT IDENTITY                        |
|  <div>  .hero-section                    |
|  index.html:15:3                         |
+- - - - - - - - - - - - - - - - - - - - -+
|  CLASSES                                 |
|  [skeleton bar ~~~~~~~~~~~~]             |
|  [skeleton bar ~~~~~~~~]                 |
+- - - - - - - - - - - - - - - - - - - - -+
|  APPLIED RULES                           |
|  [skeleton bar ~~~~~~~~~~~~]             |
|  [skeleton bar ~~~~~~~~]                 |
|  [skeleton bar ~~~~~~~~~~~~~~]           |
+------------------------------------------+
```

Identity populates immediately (data is on the DOM element). Classes, rules, and variables show skeleton placeholders while the iframe-side `readMatchedRules()` async function resolves. Typically resolves in <50ms so the skeleton may flash imperceptibly; it exists to prevent layout shift.

### 4.3 Standard State (element selected, all data loaded)

Full panel as shown in the wireframe above.

### 4.4 Multi-Rule Conflict State

When multiple rules set the same property (e.g., three rules all set `font-size`), the Applied Rules section shows all three with strikethrough on the two lower-specificity values. A small "3 rules" badge appears next to the property name in the Computed section, clickable to jump to the rules.

### 4.5 No Stylesheets State

When the loaded page has no linked stylesheets (only inline styles or no styles at all):

- Classes section: Shows classes if any, but property counts will be 0.
- Applied Rules section: Shows only `element.style` block. Message: "No external stylesheets found."
- Variables section: Empty with message: "No CSS custom properties defined."
- Computed section: Shows browser defaults.

### 4.6 Inline-Only Element State

When the element has inline styles but no class-based rules:

- Applied Rules shows only the `element.style` block at the top.
- A subtle prompt below: "Add a class to organize these styles into a reusable rule."

### 4.7 Error State

If `readMatchedRules()` fails (e.g., cross-origin stylesheet, CORS error):

- Applied Rules section: Shows warning banner: "Some stylesheets could not be read (CORS restriction)." Lists which stylesheets were inaccessible.
- Falls back to showing only computed values and inline styles.

---

## 5. Keyboard Shortcuts (Style Panel Focused)

| Shortcut | Action | Context |
|---|---|---|
| `Tab` | Move focus to next property value in the current section | When a value input is focused |
| `Shift + Tab` | Move focus to previous property value | When a value input is focused |
| `Enter` | Commit edit and move to next property | When editing a value |
| `Escape` | Cancel edit, restore original value | When editing a value |
| `Arrow Up` | Increment numeric value by 1 | When a numeric input is focused |
| `Arrow Down` | Decrement numeric value by 1 | When a numeric input is focused |
| `Shift + Arrow Up` | Increment numeric value by 10 | When a numeric input is focused |
| `Shift + Arrow Down` | Decrement numeric value by 10 | When a numeric input is focused |
| `Alt + Arrow Up` | Increment numeric value by 0.1 | When a numeric input is focused |
| `Alt + Arrow Down` | Decrement numeric value by 0.1 | When a numeric input is focused |
| `Cmd/Ctrl + D` | Toggle the first class on/off (quick disable) | When style panel has focus |
| `Cmd/Ctrl + Shift + C` | Copy all computed styles as CSS text to clipboard | When style panel has focus |
| `/` | Focus the "Add Property" input | When style panel has focus, no input focused |
| `.` | Focus the "Add Class" input | When style panel has focus, no input focused |

---

## 6. New WebSocket Message Types

The following new message types are required on both client and server:

```typescript
// Client -> Server (add to EditorToServer union)
| { type: 'edit:css-rule'; payload: {
    file: string       // CSS file path relative to project root
    line: number       // line number of the rule
    property: string   // CSS property name
    value: string      // new value
  }}
| { type: 'edit:class-add'; payload: {
    loc: string        // element's data-edit-loc
    fingerprint: string
    className: string
  }}
| { type: 'edit:class-remove'; payload: {
    loc: string
    fingerprint: string
    className: string
  }}
| { type: 'file:open'; payload: {
    file: string
    line: number
    col: number
  }}

// Server -> Client (add to ServerToEditor union)
| { type: 'file:opened'; payload: { file: string } }
```

---

## 7. New Store Fields

```typescript
// Add to EditorStore interface
interface EditorStore {
  // ... existing fields ...

  // CSS inspection data for selected element
  matchedRules: MatchedRule[] | null
  elementClasses: ElementClass[] | null
  cssVariables: CssVariable[] | null
  allProjectClasses: string[]

  // Editing state
  editingRuleTarget: {
    file: string
    line: number
    property: string
  } | null

  // Actions
  setMatchedRules: (rules: MatchedRule[]) => void
  setElementClasses: (classes: ElementClass[]) => void
  setCssVariables: (vars: CssVariable[]) => void
  setAllProjectClasses: (classes: string[]) => void
  toggleClass: (className: string, enabled: boolean) => void
  addClass: (className: string) => void
  removeClass: (className: string) => void
  setEditingRuleTarget: (target: EditorStore['editingRuleTarget']) => void
}

interface MatchedRule {
  selector: string
  source: string           // "styles.css:18" or "inline"
  sourceFile: string | null // "styles.css" or null for inline
  sourceLine: number | null // 18 or null for inline
  specificity: [number, number, number]
  mediaQuery: string | null
  declarations: RuleDeclaration[]
}

interface RuleDeclaration {
  property: string
  value: string
  important: boolean
  isOverridden: boolean
}

interface ElementClass {
  name: string
  enabled: boolean         // false when user has toggled it off (preview only)
  propertyCount: number
  persisted: boolean       // true = exists in source, false = added via preview
}

interface CssVariable {
  name: string             // "--color-primary"
  value: string            // "#4a90d9"
  resolvedValue: string    // "#4a90d9" (after resolving var references)
  source: string           // ":root" or ".dark-theme"
  sourceFile: string | null
  sourceLine: number | null
  isColor: boolean         // true if value resolves to a color
}
```

---

## 8. Iframe-Side Data Collection

A new utility module (`css-inspector.ts`) runs inside the iframe context to collect CSS data. It is injected by the Vite plugin or loaded as a script.

### Key functions:

**`readMatchedRules(element: Element): MatchedRule[]`**

1. Iterate `element.ownerDocument.styleSheets`.
2. For each stylesheet, iterate `sheet.cssRules`.
3. For each `CSSStyleRule`, test `element.matches(rule.selectorText)`.
4. Collect matching rules with their declarations.
5. For `CSSMediaRule`, check `window.matchMedia(rule.conditionText).matches` and recurse into contained rules.
6. Sort by specificity (descending).
7. Mark overridden declarations by tracking which properties have already been claimed by higher-specificity rules.
8. Prepend `element.style` as a synthetic "inline" rule block.

**`readCssVariables(element: Element): CssVariable[]`**

1. Iterate all stylesheets and collect every property name starting with `--`.
2. For each variable, call `getComputedStyle(element).getPropertyValue(varName)` to get the resolved value.
3. Track which rule defines each variable (for source attribution).
4. Detect color values via regex or `CSS.supports('color', value)`.

**`getAllClassNames(): string[]`**

1. Iterate all stylesheets.
2. For each `CSSStyleRule`, extract class names from the selector (regex: `/\.([a-zA-Z_-][\w-]*)/g`).
3. Deduplicate and sort alphabetically.

**Performance note**: These functions should cache results per-stylesheet and invalidate when stylesheets change (listen for `<link>` load events and `MutationObserver` on `<style>` elements). On a typical page with 5-10 stylesheets and 200-500 rules, the full scan takes <10ms.

---

## 9. Server-Side Changes

### 9.1 New `applyCssRuleChange()` in `source-writer.ts`

For editing CSS file properties (not inline HTML styles), a new function:

```
applyCssRuleChange(source: string, line: number, property: string, value: string): string
```

This function:
1. Splits the CSS source into lines.
2. Finds the rule block containing the target line.
3. Within that block, finds the declaration matching `property`.
4. Replaces only the value portion via string surgery (preserving formatting, whitespace, comments).
5. If the property does not exist in the rule, appends a new declaration.

### 9.2 New `applyClassChange()` in `source-writer.ts`

For adding/removing classes from HTML elements:

```
applyClassAdd(source: string, fingerprint: string, line: number, col: number, className: string): string
applyClassRemove(source: string, fingerprint: string, line: number, col: number, className: string): string
```

These use the same `findElement()` + byte-offset surgery approach as `applyStyleChange()`, but target the `class=""` attribute instead of `style=""`.

### 9.3 New `file:open` handler in `ws-handler.ts`

Handles the "open in editor" action:
1. Reads `$EDITOR` environment variable or defaults to VS Code.
2. Spawns: `code --goto <file>:<line>:<col>` (VS Code) or equivalent.
3. Falls back to `open` / `xdg-open` for other editors.

---

## 10. Implementation Priority

### Phase 1: Foundation (Element Identity + Computed Expansion)
1. Add Element Identity section (tag, classes, id, source location).
2. Expand Computed section from 3 groups to 7.
3. Expand `readComputedStyles()` to cover all new properties.
4. No new WS messages required. Pure UI work.

### Phase 2: Classes Section
1. Add `elementClasses` to store, populated from `element.classList`.
2. Build class toggle UI (checkbox list).
3. Implement `edit:class-add` and `edit:class-remove` WS messages.
4. Implement `applyClassAdd()` and `applyClassRemove()` in source-writer.
5. Build autocomplete for class names from stylesheets.

### Phase 3: Applied CSS Rules
1. Build `css-inspector.ts` iframe-side module.
2. Implement `readMatchedRules()` function.
3. Build rules display UI with specificity ordering and strikethrough.
4. Implement `edit:css-rule` WS message.
5. Implement `applyCssRuleChange()` in source-writer.
6. Wire inline editing of rule values.

### Phase 4: CSS Variables
1. Implement `readCssVariables()` function.
2. Build variables section UI with grouping and color swatches.
3. Wire variable editing to `edit:css-rule` (variables are just properties on rules).

### Phase 5: Polish
1. Keyboard shortcuts.
2. "Open in editor" (`file:open`) handler.
3. Cross-linking between Computed and Applied Rules (click computed value to scroll to rule).
4. Performance optimization (caching, debounced stylesheet re-scans).
5. Error states for CORS-blocked stylesheets.

---

## 11. Design Tokens for New Components

These extend the existing token system in `styles.css`:

```css
:root {
  /* Existing tokens (unchanged) */
  --editor-bg: #1e1e2e;
  --panel-bg: #2a2a3e;
  --border-color: #3a3a4e;
  --text-primary: #e0e0e8;
  --text-secondary: #8888a0;
  --accent: #4a90d9;

  /* New tokens for Style Panel redesign */
  --style-section-gap: 0;
  --style-section-border: 1px solid var(--border-color);
  --style-row-height: 24px;
  --style-indent: 16px;

  /* Source badges */
  --badge-inline-bg: rgba(74, 144, 217, 0.15);
  --badge-inline-text: #6ab0f3;
  --badge-file-bg: rgba(74, 222, 128, 0.15);
  --badge-file-text: #4ade80;

  /* Strikethrough for overridden properties */
  --style-overridden-text: #5a5a70;
  --style-overridden-decoration: line-through;

  /* Class toggle */
  --class-pill-bg: rgba(255, 255, 255, 0.06);
  --class-pill-border: 1px solid rgba(255, 255, 255, 0.1);
  --class-pill-disabled-opacity: 0.4;

  /* Variable section */
  --var-prefix-color: #8888a0;
  --var-name-color: #e0e0e8;
  --var-value-color: #b0b0c0;
  --var-swatch-size: 12px;

  /* Computed section */
  --computed-default-color: #5a5a70;
  --computed-active-color: #e0e0e8;

  /* Autocomplete dropdown */
  --autocomplete-bg: #323248;
  --autocomplete-hover-bg: rgba(74, 144, 217, 0.2);
  --autocomplete-border: 1px solid var(--border-color);
  --autocomplete-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}
```

---

## 12. Responsive Behavior

The style panel is fixed at 320px in the grid layout (`grid-template-columns: 240px 1fr 320px`). It does not need responsive breakpoints itself, but two accommodations:

1. **Small viewport (<1200px total)**: The style panel collapses to an icon-only rail (24px). Clicking the icon expands it as an overlay (position: absolute, right: 0, width: 320px, z-index above canvas).

2. **Very long values**: CSS values like `font-family: "Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, sans-serif` get truncated with ellipsis. Hovering shows the full value in a tooltip. Focusing the value for editing shows the full value in the input.

---

## 13. Accessibility

- All interactive elements have visible focus rings (existing `--accent` color, 2px offset).
- Checkboxes in the Classes section are native `<input type="checkbox">` elements, not divs with click handlers.
- Section headers are `<button>` elements with `aria-expanded` (already implemented in `StyleGroup`).
- The autocomplete dropdown uses `role="listbox"` with `aria-activedescendant` for screen reader navigation.
- Color swatches include `aria-label="Color: #4a90d9"` for screen readers.
- Source badges include `role="link"` and `aria-label="Open styles.css at line 18"`.

---

## Appendix: Reference Comparison

| Feature | Chrome DevTools | Webflow | This Editor (proposed) |
|---|---|---|---|
| Shows matched CSS rules | Yes, full cascade | No (hides cascade) | Yes, full cascade |
| Shows specificity order | Yes | N/A | Yes |
| Strikethrough overridden | Yes | N/A | Yes |
| Shows source file:line | Yes | N/A | Yes, clickable |
| Class toggle | No (must edit manually) | No (class is the entity) | Yes, checkbox toggle |
| CSS variable inspection | Computed only | No | Yes, dedicated section |
| Inline value editing | Yes | Yes (visual controls) | Yes |
| Shows write target | Implicit (inline vs rule) | Always Webflow DB | Explicit badge |
| Edit CSS file rules | No (edits are ephemeral) | N/A | Yes, persisted to file |
| Autocomplete classes | No | Yes (from design system) | Yes (from stylesheets) |
