---
title: "feat: Build Edit — Open-Source Visual Web Editor"
type: feat
date: 2026-04-05
deepened: 2026-04-05
---

## Enhancement Summary

**Deepened on:** 2026-04-05
**Agents used:** Architecture Strategist, Performance Oracle, Security Sentinel, Kieran TypeScript Reviewer, Julik Frontend Races Reviewer, Code Simplicity Reviewer, Framework Docs Researcher, Open-Source Launch Researcher

### Key Improvements from Deepening

1. **Simplified to 2 packages** (was 4) — merged `shared` and `bridge` inline, eliminated cross-package config overhead
2. **Direct `contentDocument` access** instead of postMessage — same-origin iframe means synchronous DOM access, no bridge relay needed
3. **Editor state machine** — the load-bearing structure that prevents all race conditions between iframe/server/UI
4. **Security hardened from Phase 1** — auth token, project root jail, `127.0.0.1` binding
5. **Surgical string replacement** for source writing instead of AST re-serialization — preserves user formatting
6. **Intercept Vite HMR** for HTML files — prevents full iframe reload that destroys editor state
7. **3 style groups** for MVP (was 8) — Spacing, Typography, Size + raw CSS fallback
8. **npm name: `@edit/cli`** — "edit" is taken, register `@edit` org

### Critical Discoveries

- Vite does **full page reload** for HTML changes (not hot update) — must intercept with `hotUpdate` hook
- parse5 `serialize()` **destroys formatting** — must use byte-offset string surgery for source writes
- **No open-source tool** currently solves "edit any web project visually" — confirmed market gap
- npm **revoked personal tokens** in 2025 — must use OIDC trusted publishing via GitHub Actions

---

# feat: Build Edit — Open-Source Visual Web Editor

## Overview

**Edit** is an open-source, browser-based visual editor that runs as a local dev server on top of any existing web project. Run `npx @edit/cli` in your project directory, and a Webflow-style WYSIWYG editor opens in your browser. Click any element, edit its HTML/CSS visually, drag to rearrange, and save changes back to your actual source files. Deploy the output as static HTML/CSS/JS anywhere.

## Problem Statement

AI tools generate solid first-draft websites, but refinement still requires hand-editing code. Webflow provides great visual editing, but it's a closed platform — you can't point it at an existing codebase. **No open-source tool lets you visually edit arbitrary web projects and save changes back to source files.** The closest tools (Utopia, Plasmic) only work with React.

## Proposed Solution

An **iframe + custom overlay** architecture with direct DOM access:

1. A Node.js CLI (`npx @edit/cli`) launches a local Vite dev server
2. The server parses project HTML files using `parse5`, injects `data-edit-loc` attributes with source positions, and serves them in a same-origin iframe
3. A React-based editor UI accesses the iframe via `contentDocument` (no postMessage relay needed)
4. Clicks read `data-edit-loc` attributes to map elements back to source file positions
5. Visual edits apply instantly as preview, then persist via surgical byte-offset string replacement on source files
6. A single WebSocket channel handles all editor-to-server communication

---

## Technical Approach

### Architecture

```
┌──────────────────────────────────────────────────────┐
│  Browser (localhost:4444?token=<random>)              │
│                                                       │
│  ┌──────────┐  ┌──────────────────────────────────┐  │
│  │  Layers  │  │  iframe (user's site)             │  │
│  │  Panel   │  │  - data-edit-loc on every element │  │
│  │ (react-  │  │  - 10-line click interceptor      │  │
│  │ arborist)│  │  - accessed via contentDocument   │  │
│  └──────────┘  └──────────────────────────────────┘  │
│                                                       │
│  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │ Style Panel (3 grps) │  │ Toolbar: breakpoints │  │
│  │ Spacing / Type / Size│  │ undo-redo / save     │  │
│  │ + raw CSS fallback   │  │                      │  │
│  └──────────────────────┘  └──────────────────────┘  │
│                                                       │
│  ┌──────────────────────────────────────────────────┐│
│  │  Editor State Machine (governs all interactions) ││
│  │  LOADING→IDLE→SELECTING→EDITING→WRITING→IDLE     ││
│  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
        │ direct contentDocument + single WebSocket
        ▼
┌──────────────────────────────────────────────────────┐
│  Node.js Server (Vite middleware mode)                │
│                                                       │
│  ├── Vite plugin: transformIndexHtml + hotUpdate      │
│  │   └── parse5 → inject data-edit-loc attributes     │
│  ├── WebSocket: bidirectional editor ↔ server         │
│  ├── Auth: random startup token required on all reqs  │
│  ├── File jail: all paths resolved within projectRoot │
│  ├── Write queue: serialized, own-write suppression   │
│  └── Source writer: byte-offset string surgery        │
└──────────────────────────────────────────────────────┘
```

### Simplified Monorepo (2 packages, not 4)

```
edit/
├── packages/
│   ├── cli/                    # Published npm package ("@edit/cli")
│   │   ├── src/
│   │   │   ├── cli.ts                # CLI entry (cac)
│   │   │   ├── server.ts             # Vite dev server + auth token
│   │   │   ├── vite-plugin.ts        # HTML transform + hotUpdate hook
│   │   │   ├── source-writer.ts      # Byte-offset string surgery
│   │   │   ├── write-queue.ts        # Serialized write queue
│   │   │   ├── file-jail.ts          # Path traversal protection
│   │   │   ├── ws-handler.ts         # WebSocket handler + validation
│   │   │   └── types.ts              # Shared types (protocol, EditOperation)
│   │   ├── iframe-interceptor.ts     # 10-line click interceptor (inlined)
│   │   ├── package.json
│   │   └── tsup.config.ts
│   │
│   └── editor-ui/              # React editor application
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── Canvas.tsx             # iframe + contentDocument access
│       │   │   ├── SelectionOverlay.tsx    # element highlight/resize
│       │   │   ├── StylePanel.tsx          # 3 groups + raw CSS input
│       │   │   ├── LayersPanel.tsx         # DOM tree (react-arborist)
│       │   │   └── Toolbar.tsx            # breakpoints, undo/redo
│       │   ├── state/
│       │   │   ├── editor-store.ts        # Zustand + Immer + Zundo
│       │   │   └── state-machine.ts       # Editor interaction states
│       │   └── lib/
│       │       ├── dom-access.ts          # contentDocument helpers
│       │       └── ws-client.ts           # WebSocket client
│       ├── package.json
│       └── vite.config.ts
│
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── LICENSE                     # MIT
└── README.md
```

### Research Insight: Why 2 Packages, Not 4

The `shared` package contained only TypeScript types — these can live in `cli/src/types.ts` and be imported at build time. The `bridge` package was a single file that handled postMessage relay — but since the iframe is same-origin, we can access `contentDocument` directly from the parent and only need a 10-line inline click interceptor script. Eliminating 2 packages removes ~8 config files and cross-package linking overhead.

### Key Technology Choices

| Component | Choice | Why |
|-----------|--------|-----|
| HTML parser | `parse5` v7.2 | Spec-compliant, `sourceCodeLocationInfo` gives line/col/attr byte offsets |
| Dev server | Vite 6.x (middleware mode) | `transformIndexHtml` + `hotUpdate` hooks, built-in file watcher |
| Editor UI | React 19 + TypeScript | Largest contributor pool; `ref` as prop (no forwardRef) |
| State | Zustand + Immer + Zundo | Zundo provides drop-in undo/redo via `temporal` middleware |
| Style panel | Radix UI + react-colorful | Accessible primitives + lightweight color picker |
| Layers panel | react-arborist | Purpose-built for VSCode/Figma-style tree views |
| Drag and drop | @dnd-kit | Best React DnD library, validated by Puck editor |
| CLI framework | cac | What Vite uses, zero deps, TypeScript support |
| Build | tsup (CLI) + Vite (editor-ui) | esbuild speed for Node.js, Vite for React |
| Terminal colors | picocolors | 7KB, zero deps (Vite switched from chalk to this) |

### Editor State Machine (Critical)

The state machine is the load-bearing structure that prevents all race conditions. Every user-facing action checks the current state before proceeding.

```
STATES:
  LOADING        — iframe loading, not ready
  IDLE           — ready for any interaction
  SELECTING      — click registered, gathering style data
  EDITING_STYLE  — input active, preview applied, writes suppressed
  EDITING_TEXT   — contentEditable active
  DRAGGING       — DnD in progress, writes + HMR frozen
  WRITING        — flush to disk in progress
  RECONCILING    — controlled reload after write
  NAVIGATING     — page switch in progress

TRANSITIONS:
  LOADING → IDLE            (iframe load complete)
  IDLE → SELECTING          (click in iframe or layers)
  SELECTING → IDLE          (style data gathered + rendered)
  IDLE → EDITING_STYLE      (style input focused / slider drag)
  EDITING_STYLE → WRITING   (debounce fires)
  WRITING → RECONCILING     (write complete, controlled reload)
  RECONCILING → IDLE        (reload done, selection restored)
  IDLE → EDITING_TEXT       (double-click, contentEditable on)
  EDITING_TEXT → WRITING    (blur fires, content commit)
  IDLE → DRAGGING           (drag start)
  DRAGGING → WRITING        (drop, write reorder)
  IDLE → NAVIGATING         (page switch)
  NAVIGATING → LOADING      (iframe src changed)

REFUSED (these are the races we prevent):
  EDITING_STYLE → SELECTING  (finish editing first)
  EDITING_TEXT → SELECTING   (blur must complete first)
  DRAGGING → WRITING         (drop must complete first)
  WRITING → EDITING_STYLE    (wait for reconcile)
  RECONCILING → anything     (wait for completion)
```

Implementation: Plain `Symbol()` states in Zustand. No state machine library needed — it's a switch statement and a variable.

### Core Data Flow

```
USER CLICKS ELEMENT IN IFRAME
  │
  ▼
Parent accesses iframe.contentDocument directly
  ├── Reads data-edit-loc="index.html:42:5" from element
  ├── Gets getBoundingClientRect() (synchronous)
  ├── Gets getComputedStyle() (~40 properties, not all 300+)
  ├── Checks selectionGeneration counter (discard stale)
  │
  ▼
Editor state updates (Zustand)
  ├── Draws SelectionOverlay (blue border, resize handles)
  ├── Populates StylePanel with styles
  ├── Highlights node in LayersPanel
  │
USER CHANGES A STYLE (e.g., color: red → blue)
  │
  ▼
State machine: IDLE → EDITING_STYLE
  ├── Instant preview: element.style.color = "blue" (via contentDocument)
  ├── Immer patch stored for undo/redo
  ├── Debounced (150ms): WebSocket sends EditOperation to server
  │
  ▼
Server write queue (serialized, one at a time)
  ├── Reads source file, computes hash
  ├── Parses with parse5 (cached AST)
  ├── Finds element by fingerprint (nth-child path) or line:col
  ├── Surgical byte-offset string replacement (NOT full re-serialize)
  ├── Writes with hash check (optimistic locking)
  ├── Marks as own-write (suppress Vite HMR)
  │
  ▼
State machine: WRITING → RECONCILING → IDLE
  ├── WebSocket confirms write success
  ├── Editor does NOT reload iframe (preview already correct)
  ├── Only on EXTERNAL file changes: controlled iframe reload
  └── Selection restored by data-edit-loc lookup
```

### Security Architecture (Phase 1 Requirements)

| Security Control | Implementation |
|-----------------|----------------|
| **Auth token** | Random token generated at startup, embedded in editor URL (`?token=<random>`). Required on all WebSocket connections and API requests. |
| **Project root jail** | `file-jail.ts`: `path.resolve(projectRoot, filePath)` + `startsWith()` check on every file operation. Reject paths with `..` segments. |
| **Bind address** | `127.0.0.1` only (not `0.0.0.0`). `--host` flag prints security warning. |
| **Host header validation** | Reject requests where `Host` is not `localhost:<port>` or `127.0.0.1:<port>`. Defeats DNS rebinding. |
| **Relative paths** | `data-edit-loc` uses paths relative to projectRoot, not absolute filesystem paths. |
| **Write safety** | Atomic writes (temp file + rename). Write queue prevents concurrent writes to same file. |

### Source Writing: Byte-Offset String Surgery

**Critical: Never use `parse5.serialize()` to write back to user files.** It destroys formatting.

parse5 gives `sourceCodeLocation` with `startOffset`/`endOffset` byte positions. Use these for surgical string replacement:

```typescript
// To update an inline style attribute:
const source = await fs.readFile(filePath, 'utf-8');
const attrLoc = node.sourceCodeLocation.attrs['style'];
const before = source.slice(0, attrLoc.startOffset);
const after = source.slice(attrLoc.endOffset);
const updated = before + `style="${newStyleValue}"` + after;
// Atomic write
await fs.writeFile(filePath + '.tmp', updated);
await fs.rename(filePath + '.tmp', filePath);
```

Two distinct uses of parse5:
1. **Vite plugin** (serve-time): `parse() + serialize()` is fine — output is ephemeral, never written to disk
2. **Source writer** (write-back): `parse()` for AST traversal only + byte-offset string surgery for modifications

### Element Identification: Fingerprint + Line:Col

Line numbers drift after edits. Use a dual identification strategy:

1. **Structural fingerprint** (primary): `tagName + nth-child path from root` (e.g., `html>body>div:nth-child(2)>p:nth-child(1)`)
2. **Line:col** (secondary fallback): From `data-edit-loc`
3. **File version counter**: Incremented on every write, embedded as `<meta name="edit-file-version">`. Server rejects commands with stale versions.

### TypeScript Configuration

```jsonc
// tsconfig.base.json — critical flags
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,    // Essential for editor's constant array/record indexing
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,        // Required for tsup/Vite tree-shaking
    "moduleResolution": "bundler"
  }
}
```

Key type patterns:
- `LocatedElement` branded wrapper for parse5 nodes with guaranteed `sourceCodeLocation`
- Discriminated unions for all WebSocket message types
- `Map<string, string>` over `Record` for styles (distinguishes "not set" from "set to empty")
- Zundo composition: `temporal(immer(...))` — order matters

---

## Implementation Phases

### Phase 1: Foundation & CLI (Sprint 1)

**Goal**: `npx @edit/cli` opens a browser with the editor shell, user's site in an iframe, click-to-log-source working.

**Tasks:**
- [ ] Initialize pnpm monorepo with 2 packages (cli, editor-ui)
- [ ] `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`
- [ ] `packages/cli/cli.ts`: CLI entry with `cac` — `--port`, `--open`, `--host` flags. Startup banner modeled on Vite output using `picocolors`
- [ ] `packages/cli/server.ts`: Vite in middleware mode (`appType: 'custom'`). Generate random auth token. Bind to `127.0.0.1`
- [ ] `packages/cli/file-jail.ts`: Path resolution + projectRoot boundary check. Applied to ALL file operations
- [ ] `packages/cli/vite-plugin.ts`: `transformIndexHtml` hook — parse5 with `sourceCodeLocationInfo`, inject `data-edit-loc` (relative paths) + element fingerprint on every element. `hotUpdate` hook — intercept HTML changes, suppress full reload, push morphable HTML via custom WS event
- [ ] `packages/cli/types.ts`: `EditOperation` discriminated union, `LocatedElement` branded type, WebSocket message types
- [ ] `packages/editor-ui`: Scaffold React 19 app with Vite — layout: left sidebar + center iframe
- [ ] `packages/editor-ui/Canvas.tsx`: Render iframe (same-origin), access `contentDocument` directly. Inject 10-line click interceptor (preventDefault on links/forms)
- [ ] `packages/editor-ui/state/state-machine.ts`: Editor state machine with `Symbol()` states in Zustand
- [ ] `packages/editor-ui/lib/dom-access.ts`: Read `data-edit-loc`, `getBoundingClientRect()`, selection helpers via `contentDocument`
- [ ] `packages/cli/ws-handler.ts`: WebSocket handler with auth token validation, message schema validation, Host header check
- [ ] CLI builds editor-ui into `cli/dist/editor/` and serves as static files
- [ ] Verify: `npx @edit/cli` in sample HTML project → see site in iframe → click elements → log source locations to console

**Deliverable**: Working CLI with security controls, source location annotations, click-to-source logging.

---

### Phase 2: Element Selection & Style Reading (Sprint 2)

**Goal**: Click an element, see it highlighted, view its styles in a panel.

**Tasks:**
- [ ] `SelectionOverlay.tsx`: Selection box (border + resize handles) positioned using translated `getBoundingClientRect()` coords. RAF loop for position sync with `isConnected` check
- [ ] Selection generation counter: monotonic counter, discard stale selection data
- [ ] `StylePanel.tsx`: **3 groups** for MVP — Spacing (margin/padding), Typography (font-size, weight, color, text-align), Size (width, height). Raw CSS text input fallback for all other properties
- [ ] Read only ~40 style-panel properties from `getComputedStyle()`, not all 300+
- [ ] Distinguish authored inline styles (editable) vs computed (grayed placeholder)
- [ ] `LayersPanel.tsx`: DOM tree via `react-arborist`. Lazy loading — top 2-3 levels initially, expand on demand
- [ ] Bidirectional selection sync: click element ↔ highlights in tree
- [ ] Keyboard: Escape to deselect

**Deliverable**: Full selection UX — click to select with overlay, style panel shows CSS, layers panel shows DOM tree.

---

### Phase 3: Style Editing & Source Writing (Sprint 3)

**Goal**: Edit CSS in the style panel → saves back to source files. Undo/redo works.

**Tasks:**
- [ ] Style inputs: number inputs with unit selector, color picker (`react-colorful`), dropdown selects for enum properties
- [ ] Instant preview: `element.style[prop] = value` via `contentDocument` (before server round-trip)
- [ ] `packages/cli/write-queue.ts`: Serialized write queue — one write at a time, latest-wins for pending, own-write suppression on Vite watcher
- [ ] `packages/cli/source-writer.ts`: Byte-offset string surgery — parse5 for AST traversal, string slice for modification. Atomic write (temp + rename). Hash-based optimistic locking
- [ ] **V1 writes to inline styles only** — avoids CSS cascade/specificity complexity. Show indicator when inline overrides a class rule
- [ ] WebSocket channel: editor sends `EditOperation`, server writes file, confirms via same WS
- [ ] Own-write suppression: server marks files it wrote, Vite watcher ignores them. Only external changes trigger iframe reload
- [ ] `editor-store.ts`: Zustand + `temporal(immer(...))` via Zundo. `partialize` to exclude UI state from undo history. `limit: 100`
- [ ] Ctrl+Z / Ctrl+Shift+Z wired to Zundo's `undo()`/`redo()`
- [ ] Separate debounce timings: 150ms for writes, 300ms for undo grouping

**Deliverable**: Edit any CSS property → live preview + source file updated. Undo/redo works. No formatting corruption.

---

### Phase 4: Content Editing & Drag-and-Drop (Sprint 4)

**Goal**: Double-click to edit text. Drag elements to reorder.

**Tasks:**
- [ ] `InlineEditor`: Double-click → `contentEditable` on iframe element. Blur saves, Escape cancels. State machine prevents click race during blur
- [ ] Content writes: byte-offset replacement of text node content in source
- [ ] Drag-and-drop with `@dnd-kit`: drag handle on selected elements, overlay-only strategy (`pointer-events: none` on iframe during drag)
- [ ] Freeze writes + HMR during drag operations (state machine: DRAGGING)
- [ ] Source writer: AST-based element reordering (this is where full AST modification is justified — cut/paste nodes)
- [ ] Multi-page: detect `.html` files, page switcher in toolbar
- [ ] Page session ID: discard stale messages during page navigation

**Deliverable**: Full content editing + reorder with source round-tripping. Multi-page support.

---

### Phase 5: Polish & Ship MVP (Sprint 5)

**Goal**: Ship a polished MVP to npm and launch on Hacker News.

**Tasks:**
- [ ] Error handling: toast on write failure, reconnect on WS disconnect
- [ ] Save indicator: dot showing unsaved changes, Ctrl+S as safety net
- [ ] Helpful CLI errors: "No HTML files found" with suggested fix, not raw stack traces
- [ ] `README.md`: demo GIF (30s workflow), one-command Quick Start, feature list, comparison table, badges (npm version, MIT, stars, CI)
- [ ] `CONTRIBUTING.md`: dev setup, architecture overview, PR process
- [ ] `.github/`: issue templates (bug + feature as YAML forms), PR template, CI workflow (lint + typecheck + build on Node 20 + 22)
- [ ] Register `@edit` npm org, configure OIDC trusted publishing via GitHub Actions
- [ ] Release workflow: git tag → GitHub Actions → `pnpm --filter @edit/cli publish`
- [ ] Record demo GIF showing: `npx @edit/cli` → editor opens → click element → change style → source file updates
- [ ] Draft Hacker News "Show HN" post

**Deliverable**: Published on npm, README with demo, CI green, ready for HN launch.

### Post-MVP (Future Sprints)

Each is its own mini-release after gathering user feedback:
- Responsive breakpoint preview (iframe resize + coordinate scaling)
- Full style panel (8 groups with scrub-to-edit inputs)
- External CSS file editing (postcss integration)
- `<style>` block editing
- Class toggle UI
- Image/link editing
- Delete/Duplicate/Copy/Paste keyboard shortcuts
- Framework adapters (React via Babel source plugin, Vue, Svelte, Astro)
- Plugin system for community extensions

---

## Acceptance Criteria

### Functional Requirements

- [ ] `npx @edit/cli` launches server and opens browser with auth token
- [ ] Any `.html` file renders correctly in the editor iframe
- [ ] Clicking any element shows selection overlay and populates style panel
- [ ] Editing CSS in style panel saves to correct source file at correct location
- [ ] Source files are never reformatted — only the changed bytes are modified
- [ ] Double-clicking text allows inline editing that saves back to source
- [ ] Undo/redo works for all operations (Ctrl+Z / Ctrl+Shift+Z)
- [ ] Multiple HTML pages can be navigated between
- [ ] Path traversal attempts are blocked

### Non-Functional Requirements

- [ ] Editor loads in < 2 seconds for typical project (< 50 HTML files)
- [ ] Style changes reflect in iframe in < 100ms (instant preview before server round-trip)
- [ ] Source file writes complete in < 500ms
- [ ] No data loss: source files are never corrupted by the editor
- [ ] Works on macOS, Linux, and Windows
- [ ] Zero runtime footprint in user's project
- [ ] Bound to 127.0.0.1 by default, auth token on all connections

### Quality Gates

- [ ] TypeScript strict mode + `noUncheckedIndexedAccess`, no `any` types
- [ ] Source-writer unit tests: parse → byte-offset modify → verify output matches expected
- [ ] E2E test: launch → click element → change style → verify source file changed correctly
- [ ] README with demo GIF and one-command Quick Start

---

## Risk Analysis & Mitigation

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Vite full-reloads HTML** (destroys iframe state) | CRITICAL | `hotUpdate` hook intercepts HTML changes, suppresses default reload, pushes morphable HTML via custom WS event |
| **parse5 serialize destroys formatting** | HIGH | Never use `serialize()` for source writes. Byte-offset string surgery preserves 100% of user formatting |
| **Source locations drift after edits** | HIGH | Element fingerprint (nth-child path) as primary lookup. File version counter rejects stale commands. Re-parse cached AST after every write |
| **Race conditions across iframe/WS/server** | HIGH | Editor state machine governs all interactions. Write queue serializes file ops. Selection generation counter discards stale data |
| **Unauthenticated file access** | CRITICAL | Auth token on startup, project root jail, 127.0.0.1 binding, Host header validation |
| **Write conflicts (editor + external editor)** | MEDIUM | Hash-based optimistic locking. External changes trigger controlled iframe reload. Undo stack cleared on external changes |
| **npm name "edit" unavailable** | LOW | Register `@edit` npm org, publish as `@edit/cli`. Binary name is still `edit` |

---

## References & Research

### Research Documents
- Brainstorm: `docs/brainstorms/2026-04-05-edit-visual-editor-brainstorm.md`
- HTML source mapping research: `docs/research/2026-04-05-visual-editing-ui-research.md`
- Vite dev server research: `docs/research/2026-04-05-vite-dev-server-research.md`

### Key Libraries
| Library | Version | Purpose |
|---------|---------|---------|
| parse5 | 7.2 | HTML parsing + source locations |
| Vite | 6.x | Dev server, plugins, HMR |
| React | 19 | Editor UI |
| Zustand | 5.x | State management |
| Zundo | 2.x | Undo/redo temporal middleware |
| Immer | latest | Immutable state with mutable syntax |
| react-arborist | latest | Tree view for layers panel |
| @dnd-kit | latest | Drag and drop |
| react-colorful | latest | Color picker |
| Radix UI | latest | Accessible UI primitives |
| postcss | latest | CSS parsing (post-MVP) |
| cac | latest | CLI framework |
| picocolors | latest | Terminal colors |

### Prior Art
- **Onlook** (closest, React-only): https://github.com/onlook-dev/onlook
- **GrapesJS** (iframe editor architecture): https://github.com/GrapesJS/grapesjs
- **Puck** (React page builder): https://github.com/puckeditor/puck
- **click-to-react-component** (click→source): https://github.com/ericclemmons/click-to-component
