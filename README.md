# onpage

> Open-source visual editor for any web project. Edit HTML & CSS visually, save to source files.

## Quick Start

```bash
npx onpage
```

Run in any directory with HTML files. That's it.

## What It Does

- **Click any element** -- see its styles in the right panel
- **Edit CSS visually** -- changes save back to your source files
- **Edit text inline** -- double-click any text to edit it
- **Drag to reorder** -- grab elements and rearrange them
- **Undo everything** -- Ctrl+Z / Ctrl+Shift+Z
- **Multiple pages** -- switch between HTML files

## How It Works

onpage runs a local dev server that renders your project in an iframe. A Vite plugin injects source location markers on every element. When you click an element, onpage knows exactly which file, line, and column it came from. Changes are written back using surgical byte-offset string replacement -- your formatting is never touched.

## Features

| Feature | Status |
|---------|--------|
| Click-to-select with overlay | Done |
| Style panel (Spacing, Typography, Size) | Done |
| DOM tree / Layers panel | Done |
| Inline text editing | Done |
| Drag-and-drop reorder | Done |
| Undo/redo | Done |
| Multi-page support | Done |
| Source-preserving writes | Done |
| Auth token security | Done |
| Responsive breakpoints | Planned |
| Framework adapters (React, Vue) | Planned |
| Plugin system | Planned |

## Requirements

- Node.js 20+

## Development

```bash
git clone https://github.com/RoccoBMB/edit.git
cd edit
pnpm install
pnpm dev
```

## License

MIT
