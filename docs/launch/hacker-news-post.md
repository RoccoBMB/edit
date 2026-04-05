# Show HN: onpage – Open-source visual editor for any HTML project

**Title**: Show HN: onpage – Open-source visual editor for any HTML project (npx onpage)

**URL**: https://github.com/RoccoBMB/edit

**Body** (post as a comment immediately after submitting):

---

Hi HN, I built onpage because I kept running into the same problem: AI tools (Claude, v0, Bolt) generate solid first-draft websites, but refinement still means hand-editing CSS values in source files.

Webflow has great visual editing, but it's a closed platform — you can't point it at an existing codebase. I wanted something that works with any HTML project.

Edit runs as a local dev server. Run `npx onpage` in your project directory and it opens a Webflow-style editor in your browser. Click any element to see its styles, edit them visually, and changes are written back to your actual source files.

**How it works technically:**

- A Vite plugin parses your HTML with parse5 and injects source location markers (`data-edit-loc="file:line:col"`) on every element at serve time
- Your site renders in a same-origin iframe. The editor accesses the DOM directly via `contentDocument` — no message relay needed
- Style changes apply instantly as a preview, then persist via byte-offset string surgery on the source file (never re-serializes your HTML, so formatting is preserved)
- A serialized write queue with own-write suppression prevents Vite's HMR from fighting with the editor

**What it can do today:**

- Click any element → selection overlay + style panel
- Edit CSS (spacing, typography, size) → instant preview → source file updated
- Double-click text → inline editing
- Drag to reorder elements
- Undo/redo (Ctrl+Z)
- Multi-page support

**What it can't do (yet):**

- No framework adapters (React, Vue, Svelte) — V1 is plain HTML only
- No external CSS file editing — writes to inline styles
- No responsive breakpoint preview
- No plugin system

MIT licensed, TypeScript throughout, pnpm monorepo (2 packages: CLI + editor UI).

Would love feedback, especially from anyone who's built similar tools or has strong opinions about visual editors.

---

**Posting tips:**
- Post Tuesday or Wednesday, 9-10am US Eastern
- Be available for 4-6 hours to respond to every comment
- Upvote will come from the quality of the discussion, not the post itself
