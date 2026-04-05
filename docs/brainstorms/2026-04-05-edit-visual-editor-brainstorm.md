# Edit — Visual Editor for Any Web Project

**Date**: 2026-04-05
**Status**: Brainstorm complete, ready for planning

---

## What We're Building

**Edit** is an open-source, browser-based visual editor that runs as a local dev server on top of any existing web project. You build a website with AI (or by hand), then run `npx edit` to open a Webflow-style WYSIWYG editor in your browser. Click any element, edit its HTML/CSS visually, drag to rearrange, and save changes back to your actual source files. Deploy the output as static HTML/CSS/JS anywhere.

### The Problem

AI tools (Claude Code, v0, Bolt, etc.) generate solid first-draft websites, but refinement still requires hand-editing code. Webflow provides a great visual editing experience, but it's a closed platform — you can't point it at an existing codebase. There is no open-source tool that lets you visually edit arbitrary web projects and save changes back to source files.

### The Workflow

```
1. Build with AI    →  Claude/v0/Bolt generates your site
2. npx edit         →  Opens visual editor at localhost
3. Click & refine   →  Webflow-style editing on your actual pages
4. Save & deploy    →  Changes write back to source, deploy anywhere
```

---

## Why This Approach

### iframe + Custom Editor Overlay

We chose to render the user's actual project inside an iframe and overlay editing controls on top, rather than importing into an existing editor framework (GrapesJS) or forking another project (Utopia/Webstudio).

**Why this wins:**
- **Framework-agnostic by design** — renders the real site, doesn't care what built it
- **True WYSIWYG** — what you see IS the actual site, not a recreation
- **Natural for AI handoff** — AI generates code, editor renders it live, you tweak visually
- **No model translation** — changes go from DOM directly to source files, no intermediate format

**What we considered and rejected:**
- **GrapesJS-based**: Mature editor UX but its internal component model doesn't round-trip cleanly to arbitrary source files
- **Fork Utopia**: Best round-tripping tech but deeply React-specific. Extending to all frameworks is essentially a rewrite
- **Fork Webstudio**: Doesn't work with existing codebases at all — designed for building new projects

### Landscape Gap

No open-source tool currently solves "point at any web project and edit it visually." The closest (Utopia, Plasmic) only work with React. This is a genuine market gap.

---

## Key Decisions

1. **Start with plain HTML/CSS only** — Deep editing UX on the simplest case first. Framework adapters come later via community plugins.

2. **Browser-based, local server** — Run `npx edit` in your project, opens localhost. No Electron, no cloud, no account required.

3. **Static HTML/CSS/JS output** — Deploy anywhere (Vercel, Netlify, S3, GitHub Pages). No proprietary hosting layer.

4. **TypeScript + React + Vite** — React for the editor UI panels, Vite as the dev server backbone, TypeScript throughout. Largest open-source contributor pool.

5. **Open-source (MIT license)** — Community-driven development with shared features and plugins.

6. **iframe + overlay architecture** — The user's site renders in an iframe. The editor UI (style panel, layers, toolbar) is an overlay around it. Changes modify the DOM, then a differ writes back to source files.

---

## Architecture Sketch

```
┌─────────────────────────────────────────────────┐
│  Browser (localhost:4444)                        │
│                                                  │
│  ┌──────────┐  ┌──────────────────────────────┐  │
│  │          │  │                              │  │
│  │  Layers  │  │   iframe (user's site)       │  │
│  │  Panel   │  │                              │  │
│  │          │  │   ┌─ selection overlay ────┐  │  │
│  │          │  │   │  click to select       │  │  │
│  │          │  │   │  drag to move/resize   │  │  │
│  │          │  │   └────────────────────────┘  │  │
│  │          │  │                              │  │
│  └──────────┘  └──────────────────────────────┘  │
│                                                  │
│  ┌──────────────────────────────────────────────┐│
│  │  Style Panel  │  Settings  │  Toolbar        ││
│  └──────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  Node.js Server (local)                          │
│                                                  │
│  ├── File watcher (project files)                │
│  ├── Source mapper (DOM ↔ source file locations)  │
│  ├── Differ (DOM changes → source file edits)    │
│  └── Static server (serves project for iframe)   │
└─────────────────────────────────────────────────┘
```

---

## Core Technical Challenges

### 1. DOM ↔ Source File Mapping (The Hard Problem)
How to map a clicked DOM element back to its line/column in a source file. For plain HTML this is solvable with source maps or AST annotation. For frameworks, this gets harder.

**V1 approach for HTML/CSS**: Parse HTML with a location-tracking parser, inject `data-edit-loc="file:line:col"` attributes during serve, use those to map clicks back to source.

### 2. Visual Editing UX
Building a Webflow-quality editing experience: element selection, style panel with visual controls, content editing, drag-and-drop reordering, responsive breakpoints.

### 3. Change Diffing
When the user modifies styles or content visually, translate those DOM mutations back into minimal, clean edits to the source files (not a full file rewrite).

### 4. Hot Reload
After source files are updated, the iframe should hot-reload to reflect changes without losing editor state (selection, scroll position, panel state).

---

## Open Questions

- **Plugin system**: How should community plugins work? (framework adapters, custom panels, export targets)
- **CMS / data layer**: Should Edit have any concept of structured data/collections, or is that a future concern?
- **Collaboration**: Real-time multi-user editing? Or single-user local tool only?
- **Undo/redo**: Visual undo in the editor, or rely on git?
- **npm package name**: Is `edit` available on npm? May need `@edit/cli` or similar.

---

## Next Steps

Run `/workflows:plan` to create a detailed implementation plan with sprints, starting from project initialization through MVP.
