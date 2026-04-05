# Edit -- Vite Dev Server Architecture Research

**Date**: 2026-04-05
**Status**: Research complete, ready for implementation planning

---

## Table of Contents

1. [Vite as a Library / Middleware](#1-vite-as-a-library--middleware)
2. [Vite Plugin for HTML Transformation](#2-vite-plugin-for-html-transformation)
3. [WebSocket Integration](#3-websocket-integration)
4. [File System API](#4-file-system-api)
5. [CLI Scaffolding](#5-cli-scaffolding)
6. [Monorepo Structure](#6-monorepo-structure)

---

## 1. Vite as a Library / Middleware

### Summary

Vite exposes a full programmatic JavaScript API via `createServer()`. You can run Vite as middleware inside any Connect-compatible Node.js server (Express, Koa, Fastify, plain `http.createServer`). This is the foundation for the Edit architecture: one Vite instance serves the editor UI, and a second mechanism serves the user's project files into the iframe.

### Version Information

- **Target**: Vite 6.x (current stable as of early 2026). Vite 7.0 and 8.0 exist on Context7 but are pre-release/canary.
- **Vite 6 key change**: The new Environment API (`server.environments`, `hotUpdate` hook) replaces some older patterns. `handleHotUpdate` still works but `hotUpdate` is the forward-looking hook.
- **Vite uses chokidar internally** for file watching (exposed as `server.watcher`).

### createServer() API

```typescript
import { createServer, type InlineConfig, type ViteDevServer } from 'vite'

const server: ViteDevServer = await createServer({
  // InlineConfig extends UserConfig with:
  configFile: false,        // false = don't auto-resolve vite.config.ts
  root: '/path/to/project', // project root directory
  server: {
    port: 4444,
    middlewareMode: true,    // KEY: don't create own HTTP server
  },
  appType: 'custom',        // KEY: don't include Vite's HTML-handling middlewares
})
```

### ViteDevServer Interface -- Key Properties

| Property | Type | Purpose |
|----------|------|---------|
| `config` | `ResolvedConfig` | The resolved Vite configuration |
| `middlewares` | `Connect.Server` | Connect app instance -- attach to any HTTP server |
| `httpServer` | `http.Server \| null` | Native HTTP server (null in middleware mode) |
| `watcher` | `FSWatcher` | Chokidar file watcher instance |
| `ws` | `WebSocketServer` | WebSocket server for HMR + custom events |
| `moduleGraph` | `ModuleGraph` | Tracks import relationships, URL-to-module mapping |
| `pluginContainer` | `PluginContainer` | Runs plugin hooks on files programmatically |
| `resolvedUrls` | `ResolvedServerUrls \| null` | Resolved URLs (null in middleware mode) |

### ViteDevServer Interface -- Key Methods

| Method | Signature | Purpose |
|--------|-----------|---------|
| `transformRequest` | `(url: string, options?) => Promise<TransformResult \| null>` | Resolve + load + transform a module |
| `transformIndexHtml` | `(url: string, html: string, originalUrl?) => Promise<string>` | Apply all plugin HTML transforms to an HTML string |
| `ssrLoadModule` | `(url: string) => Promise<Record<string, any>>` | Load a module for SSR |
| `listen` | `(port?, isRestart?) => Promise<ViteDevServer>` | Start listening |
| `close` | `() => Promise<void>` | Shut down the server |
| `restart` | `(forceOptimize?) => Promise<void>` | Restart the server |
| `reloadModule` | `(module: ModuleNode) => void` | Trigger HMR for a specific module |
| `waitForRequestsIdle` | `(ignoredId?) => Promise<void>` | Wait for static imports to settle |

### Architecture Pattern: Two-App Serving

For Edit, we need to serve two things from one HTTP server:

1. **Editor UI** (React app) -- the main page at `localhost:4444`
2. **User's project** (arbitrary HTML/CSS/JS) -- served at a sub-path for the iframe

**Recommended approach: Single Express server with two Vite instances in middleware mode.**

```typescript
import express from 'express'
import http from 'node:http'
import { createServer as createViteServer } from 'vite'

async function startEditServer(projectRoot: string) {
  const app = express()
  const httpServer = http.createServer(app)

  // Vite instance #1: User's project (served for iframe)
  const projectVite = await createViteServer({
    configFile: false,
    root: projectRoot,
    server: {
      middlewareMode: { server: httpServer }, // share HTTP server for WS
    },
    appType: 'custom',
    plugins: [editSourceMapPlugin()], // injects data-edit-loc attributes
  })

  // Vite instance #2: Editor UI (React app)
  const editorVite = await createViteServer({
    configFile: false,
    root: path.resolve(__dirname, '../editor-ui'),
    server: {
      middlewareMode: { server: httpServer },
    },
    appType: 'spa',
    base: '/__editor__/',
  })

  // Route: user's project files under /project/
  app.use('/project', projectVite.middlewares)

  // Route: editor UI under /__editor__/
  app.use('/__editor__', editorVite.middlewares)

  // Route: root serves the editor shell (which iframes /project/)
  app.get('/', (req, res) => {
    res.redirect('/__editor__/')
  })

  httpServer.listen(4444, () => {
    console.log('Edit running at http://localhost:4444')
  })
}
```

**Alternative (simpler, recommended for V1): Single Vite instance for the user's project, serve the editor UI as pre-built static files.**

```typescript
import express from 'express'
import { createServer as createViteServer } from 'vite'
import path from 'node:path'

async function startEditServer(projectRoot: string) {
  const app = express()

  // Serve pre-built editor UI as static files
  const editorDistPath = path.resolve(__dirname, '../editor-ui/dist')
  app.use('/__editor__', express.static(editorDistPath))

  // Vite dev server for user's project (with HTML transformation)
  const vite = await createViteServer({
    configFile: false,
    root: projectRoot,
    server: { middlewareMode: true },
    appType: 'custom',
    plugins: [editSourceMapPlugin()],
  })

  // User's project files
  app.use('/project', vite.middlewares)

  // API endpoints for file operations
  app.post('/api/save', express.json(), async (req, res) => {
    // Write changes back to source files
  })

  // Root redirects to editor
  app.get('/', (req, res) => res.redirect('/__editor__/'))

  app.listen(4444)
}
```

### Key Considerations

- **`middlewareMode: true`** disables Vite's own HTTP server creation. You must attach `vite.middlewares` to your own server.
- **`appType: 'custom'`** disables Vite's built-in HTML serving and SPA fallback. You handle all HTML serving.
- **`appType: 'spa'`** includes Vite's HTML middlewares and SPA fallback. Good for the editor UI.
- When passing `middlewareMode: { server: httpServer }`, Vite attaches its WebSocket to the provided HTTP server. This is critical when two Vite instances share one port.
- `server.transformIndexHtml(url, html)` can be called programmatically to apply all plugin HTML transforms to a string. This is how we inject `data-edit-loc` attributes.

---

## 2. Vite Plugin for HTML Transformation

### Summary

Vite's plugin API provides `transformIndexHtml` -- a hook specifically for modifying HTML files as they are served. This is the mechanism for injecting `data-edit-loc="file.html:42:5"` attributes into every element before the user's page is served in the iframe.

### transformIndexHtml Hook -- Full API

```typescript
type IndexHtmlTransformHook = (
  html: string,
  ctx: {
    path: string       // URL path being served
    filename: string   // Absolute file path on disk
    server?: ViteDevServer  // Only available in dev
    bundle?: import('rollup').OutputBundle  // Only available in build
    chunk?: import('rollup').OutputChunk    // Only available in build
  },
) =>
  | IndexHtmlTransformResult
  | void
  | Promise<IndexHtmlTransformResult | void>

type IndexHtmlTransformResult =
  | string                    // Return transformed HTML string
  | HtmlTagDescriptor[]       // Return tags to inject
  | {
      html: string            // Transformed HTML + tags to inject
      tags: HtmlTagDescriptor[]
    }

interface HtmlTagDescriptor {
  tag: string
  attrs?: Record<string, string | boolean>
  children?: string | HtmlTagDescriptor[]
  injectTo?: 'head' | 'body' | 'head-prepend' | 'body-prepend'
}
```

### Hook Ordering

The hook can specify execution order:

```typescript
// Object form with order
transformIndexHtml: {
  order: 'pre',    // Run BEFORE other HTML processing
  handler(html, ctx) { ... }
}

// or
transformIndexHtml: {
  order: 'post',   // Run AFTER all other hooks
  handler(html, ctx) { ... }
}

// Default (no order): runs after HTML has been transformed
```

### Implementation: editSourceMapPlugin

For Edit, we need a plugin that:
1. Parses the user's HTML with source location tracking
2. Injects `data-edit-loc="filename:line:col"` onto every element
3. Injects the Edit client-side bridge script

**Using parse5 for source location tracking:**

```typescript
import type { Plugin } from 'vite'
import { parse, serialize } from 'parse5'
import type { Element, ChildNode } from 'parse5/dist/tree-adapters/default'

export function editSourceMapPlugin(): Plugin {
  return {
    name: 'edit-source-map',

    transformIndexHtml: {
      order: 'pre', // Run first so we get the original HTML positions
      handler(html, ctx) {
        const filename = ctx.filename

        // Parse with source location tracking
        const document = parse(html, {
          sourceCodeLocationInfo: true,
        })

        // Walk the tree and inject data-edit-loc on every element
        function walk(node: ChildNode) {
          if ('tagName' in node && node.sourceCodeLocation) {
            const loc = node.sourceCodeLocation
            // Add data attribute with source location
            if (!node.attrs) node.attrs = []
            node.attrs.push({
              name: 'data-edit-loc',
              value: `${filename}:${loc.startLine}:${loc.startCol}`,
            })
          }
          if ('childNodes' in node) {
            for (const child of node.childNodes) {
              walk(child)
            }
          }
        }

        for (const child of document.childNodes) {
          walk(child)
        }

        // Serialize back to HTML
        const transformedHtml = serialize(document)

        // Also inject the Edit bridge script
        return {
          html: transformedHtml,
          tags: [
            {
              tag: 'script',
              attrs: { type: 'module' },
              children: `import '/__editor__/bridge.js'`,
              injectTo: 'body',
            },
          ],
        }
      },
    },
  }
}
```

### parse5 Source Location API

When `sourceCodeLocationInfo: true` is set:

```typescript
import { parse } from 'parse5'

const doc = parse('<div class="foo">hello</div>', {
  sourceCodeLocationInfo: true,
})

// Each element node gets a sourceCodeLocation property:
interface ElementLocation {
  startLine: number   // 1-based line number
  startCol: number    // 1-based column number
  startOffset: number // 0-based byte offset
  endLine: number
  endCol: number
  endOffset: number
  startTag: Location  // Location of the opening tag
  endTag: Location    // Location of the closing tag (if present)
  attrs: Record<string, Location> // Location of each attribute
}
```

Key notes:
- Lines and columns are **1-based** (matches editor conventions).
- If an element was implicitly created by the parser (tree correction), its `sourceCodeLocation` will be `undefined`.
- `parseFragment()` also supports `sourceCodeLocationInfo`.

### Alternative: htmlparser2

htmlparser2 is faster but less spec-compliant. It provides `startIndex` and `endIndex` (byte offsets only, not line/col). For Edit, **parse5 is recommended** because:
- It gives line/col directly (htmlparser2 only gives byte offsets -- you would need to compute line/col yourself)
- It implements the full WHATWG HTML spec, so the parsed tree matches what browsers produce
- It is what Vite itself uses internally for HTML parsing

### Handling Non-index.html Files

`transformIndexHtml` only runs on the "index" HTML file. For multi-page projects or HTML files served at sub-paths, use the `transform` hook on `.html` files or configure Vite's MPA (multi-page app) mode:

```typescript
export function editHtmlPlugin(): Plugin {
  return {
    name: 'edit-html-transform',

    // For ALL HTML files (not just index.html), use configureServer
    configureServer(server) {
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.endsWith('.html')) return next()

          const filePath = path.join(server.config.root, req.url)
          if (!fs.existsSync(filePath)) return next()

          let html = fs.readFileSync(filePath, 'utf-8')

          // Apply Vite's built-in transforms (resolves imports, injects HMR client)
          html = await server.transformIndexHtml(req.url, html)

          // Our source-map injection happens in transformIndexHtml hook above

          res.setHeader('Content-Type', 'text/html')
          res.end(html)
        })
      }
    },

    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        // Same parse5-based injection as above
        return injectSourceLocations(html, ctx.filename)
      },
    },
  }
}
```

---

## 3. WebSocket Integration

### Summary

Vite has a built-in WebSocket server (`server.ws`) used for HMR. This same channel supports custom events, making it ideal for editor-to-server communication. For Edit, we can use Vite's WS for most communication and optionally add a separate `ws` server for the editor UI.

### Vite's Built-in WebSocket API

#### Server-to-Client (broadcasting)

```typescript
// In a Vite plugin's configureServer hook:
configureServer(server) {
  // Broadcast to ALL connected clients
  server.ws.send('edit:file-changed', {
    file: '/src/index.html',
    timestamp: Date.now(),
  })

  // On connection
  server.ws.on('connection', () => {
    server.ws.send('edit:connected', { version: '1.0.0' })
  })
}
```

#### Client-to-Server

```typescript
// Client-side (in the iframe'd user page, via injected bridge script):
if (import.meta.hot) {
  // Send event to server
  import.meta.hot.send('edit:element-clicked', {
    loc: 'index.html:42:5',
    tagName: 'div',
    rect: { x: 100, y: 200, width: 300, height: 50 },
  })

  // Listen for server events
  import.meta.hot.on('edit:dom-update', (data) => {
    // Server is telling us to update the DOM
    applyDomUpdate(data)
  })
}
```

#### Server Handling Client Events

```typescript
configureServer(server) {
  // Listen for events from clients
  server.ws.on('edit:element-clicked', (data, client) => {
    console.log('Element clicked:', data.loc)

    // Reply to SPECIFIC client (not broadcast)
    client.send('edit:selection-confirmed', {
      loc: data.loc,
      styles: getComputedStylesFromSource(data.loc),
    })
  })

  server.ws.on('edit:style-change', async (data, client) => {
    // data = { loc: 'index.html:42:5', property: 'color', value: 'red' }
    await writeStyleChange(data)
    // Vite's file watcher will detect the change and trigger HMR
  })
}
```

### TypeScript Type Safety for Custom Events

Create a declaration file to type your custom events:

```typescript
// edit-events.d.ts
interface EditCustomEventMap {
  'edit:element-clicked': { loc: string; tagName: string }
  'edit:style-change': { loc: string; property: string; value: string }
  'edit:dom-update': { loc: string; html: string }
  'edit:file-changed': { file: string; timestamp: number }
  'edit:connected': { version: string }
}

declare module 'vite/types/customEvent' {
  interface CustomEventMap extends EditCustomEventMap {}
}
```

### Separate WebSocket for Editor UI

The editor UI (React app) runs in the parent frame, not inside Vite's module system. It does not have access to `import.meta.hot`. Two options:

**Option A: Use the iframe as a message relay (recommended for simplicity)**

```
Editor UI (parent) <--postMessage--> iframe (user's page with HMR) <--Vite WS--> Server
```

```typescript
// In the iframe's injected bridge script:
if (import.meta.hot) {
  // Forward server events to parent frame
  import.meta.hot.on('edit:dom-update', (data) => {
    window.parent.postMessage({ type: 'edit:dom-update', data }, '*')
  })
}

// Listen for commands from parent frame
window.addEventListener('message', (event) => {
  if (event.data.type === 'edit:select-element') {
    import.meta.hot?.send('edit:select-element', event.data.payload)
  }
})
```

**Option B: Standalone WebSocket server alongside Vite (for richer editor communication)**

```typescript
import { WebSocketServer } from 'ws'
import http from 'node:http'

const httpServer = http.createServer(app)

// Vite's WS for HMR (user's project)
const vite = await createViteServer({
  server: { middlewareMode: { server: httpServer } },
  // ...
})

// Separate WS for editor UI communication
const editorWss = new WebSocketServer({
  server: httpServer,
  path: '/__editor__/ws',
})

editorWss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    const msg = JSON.parse(raw.toString())
    switch (msg.type) {
      case 'save-file':
        await saveFile(msg.payload)
        break
      case 'get-file-tree':
        ws.send(JSON.stringify({
          type: 'file-tree',
          payload: await buildFileTree(projectRoot),
        }))
        break
    }
  })
})
```

### Recommended Architecture for Edit

```
Browser
  +------------------+     +----------------------------+
  | Editor UI        |     | iframe (user's project)    |
  | (React, parent)  |     | (served by project Vite)   |
  |                  |     |                            |
  | WS to            |     | import.meta.hot            |
  | /__editor__/ws   |     | (Vite HMR WebSocket)       |
  +--------+---------+     +------------+---------------+
           |                            |
           |   postMessage for          |  Vite WS for
           |   selection sync           |  HMR + custom events
           |                            |
  +--------v----------------------------v---------------+
  |                Node.js Server                       |
  |                                                     |
  |  Express + Vite middleware + Editor WS               |
  |  /project/*  --> vite.middlewares                    |
  |  /__editor__/*  --> static files                    |
  |  /__editor__/ws --> WebSocketServer (editor comms)  |
  |  /api/*  --> REST endpoints (file ops)              |
  +-----------------------------------------------------+
```

---

## 4. File System API

### Summary

The server needs to read, write, and watch project files. Chokidar (which Vite uses internally) is the standard for file watching. For writing changes back to source files, we need AST-aware modifications using parse5 for HTML and a CSS parser for styles.

### Chokidar -- File Watching

Vite already exposes a chokidar watcher as `server.watcher`. We can piggyback on it or create a separate instance for editor-specific watching.

```typescript
import chokidar from 'chokidar'

const watcher = chokidar.watch(projectRoot, {
  ignored: [
    /node_modules/,
    /\.git/,
    /dist/,
  ],
  persistent: true,
  ignoreInitial: true,  // Don't fire events for existing files on startup
  awaitWriteFinish: {
    stabilityThreshold: 100, // Wait 100ms after last write
    pollInterval: 50,
  },
  atomic: true,  // Handle atomic writes from editors (temp file swap)
})

watcher
  .on('change', (filePath) => {
    // Notify editor UI that a file changed (external edit)
    editorWss.clients.forEach(client => {
      client.send(JSON.stringify({
        type: 'external-file-change',
        file: path.relative(projectRoot, filePath),
      }))
    })
  })
  .on('add', (filePath) => { /* new file */ })
  .on('unlink', (filePath) => { /* file deleted */ })
  .on('ready', () => { /* initial scan complete */ })
```

**Using Vite's built-in watcher instead:**

```typescript
configureServer(server) {
  // Vite's watcher is already watching the project root
  server.watcher.on('change', (filePath) => {
    // This fires for ALL file changes Vite watches
    // Filter to only files we care about
    if (filePath.endsWith('.html') || filePath.endsWith('.css')) {
      notifyEditor('file-changed', { file: filePath })
    }
  })
}
```

### File Writing -- AST-Based Modifications

For writing style changes back to source files, prefer AST manipulation over string replacement to avoid breaking the source.

**HTML modifications with parse5:**

```typescript
import { parse, serialize } from 'parse5'
import fs from 'node:fs/promises'

async function updateHtmlElement(
  filePath: string,
  line: number,
  col: number,
  changes: { attribute?: string; value?: string; textContent?: string }
) {
  const html = await fs.readFile(filePath, 'utf-8')
  const document = parse(html, { sourceCodeLocationInfo: true })

  function findNode(node: any): any {
    if (node.sourceCodeLocation?.startLine === line &&
        node.sourceCodeLocation?.startCol === col) {
      return node
    }
    if (node.childNodes) {
      for (const child of node.childNodes) {
        const found = findNode(child)
        if (found) return found
      }
    }
    return null
  }

  const target = findNode(document)
  if (!target) throw new Error(`Element not found at ${line}:${col}`)

  if (changes.attribute && changes.value !== undefined) {
    const existing = target.attrs?.find(
      (a: any) => a.name === changes.attribute
    )
    if (existing) {
      existing.value = changes.value
    } else {
      target.attrs = target.attrs || []
      target.attrs.push({ name: changes.attribute, value: changes.value })
    }
  }

  if (changes.textContent !== undefined) {
    target.childNodes = [{ nodeName: '#text', value: changes.textContent }]
  }

  await fs.writeFile(filePath, serialize(document), 'utf-8')
}
```

**CSS modifications -- use a proper CSS parser:**

For inline styles or stylesheet edits, use `postcss` or `css-tree`:

```typescript
import postcss from 'postcss'
import fs from 'node:fs/promises'

async function updateCssProperty(
  filePath: string,
  selector: string,
  property: string,
  value: string
) {
  const css = await fs.readFile(filePath, 'utf-8')
  const root = postcss.parse(css)

  root.walkRules(selector, (rule) => {
    let found = false
    rule.walkDecls(property, (decl) => {
      decl.value = value
      found = true
    })
    if (!found) {
      rule.append({ prop: property, value })
    }
  })

  await fs.writeFile(filePath, root.toString(), 'utf-8')
}
```

### Inline Style to External CSS Promotion

When the user edits an element's style in the visual editor, decide where to write the change:

```
1. Element has inline style?  --> Modify inline style attribute in HTML
2. Element has a class?       --> Find/create CSS rule for that class
3. Neither?                   --> Generate a class, add to element + stylesheet
```

### File Tree API

For the layers panel and file browser:

```typescript
import fs from 'node:fs/promises'
import path from 'node:path'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

async function buildFileTree(
  dir: string,
  relativeTo: string = dir
): Promise<FileNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nodes: FileNode[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue

    const fullPath = path.join(dir, entry.name)
    const relPath = path.relative(relativeTo, fullPath)

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relPath,
        type: 'directory',
        children: await buildFileTree(fullPath, relativeTo),
      })
    } else {
      nodes.push({
        name: entry.name,
        path: relPath,
        type: 'file',
      })
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
```

---

## 5. CLI Scaffolding

### Summary

The CLI is the entry point: `npx edit` should launch the dev server in the current directory. We need a CLI framework, proper `package.json` configuration, and the shebang.

### CLI Framework Comparison

| Library | Size | TypeScript | Used By | Best For |
|---------|------|-----------|---------|----------|
| **cac** | ~3.6KB, zero deps | Yes | **Vite, Vitest, Rolldown** | Simple CLIs, Vite ecosystem alignment |
| **commander** | ~50KB, zero deps | Yes (built-in) | Many | Feature-rich, well-documented |
| **citty** | ~4KB, zero deps | Yes (first-class) | **Nuxt, UnJS ecosystem** | Modern, ESM-first, plugin system |
| **meow** | ~12KB, few deps | Via DefinitelyTyped | Sindre ecosystem | Simple flag parsing |

**Recommendation: `cac`**. It is what Vite itself uses, zero dependencies, tiny, and provides everything Edit needs (commands, options, help, version). Using cac aligns the project with the Vite ecosystem.

### CLI Implementation with cac

```typescript
#!/usr/bin/env node

// packages/cli/src/cli.ts
import cac from 'cac'
import { version } from '../package.json'

const cli = cac('edit')

cli
  .command('[root]', 'Start Edit visual editor')
  .option('-p, --port <port>', 'Server port', { default: 4444 })
  .option('--host [host]', 'Specify hostname')
  .option('--open', 'Open browser on start', { default: true })
  .option('--no-open', 'Do not open browser')
  .action(async (root: string | undefined, options) => {
    const { startServer } = await import('./server')
    await startServer({
      root: root || process.cwd(),
      port: Number(options.port),
      host: options.host,
      open: options.open,
    })
  })

cli
  .command('build [root]', 'Build the project (passthrough to Vite)')
  .action(async (root: string | undefined) => {
    // Future: production build support
  })

cli.help()
cli.version(version)

cli.parse()
```

### package.json Configuration for npx

```json
{
  "name": "edit",
  "version": "0.1.0",
  "description": "Visual editor for any web project",
  "type": "module",
  "bin": {
    "edit": "./dist/cli.js"
  },
  "files": [
    "dist"
  ],
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "build": "tsup src/cli.ts --format esm --dts",
    "dev": "tsup src/cli.ts --format esm --watch"
  }
}
```

Critical requirements for `npx edit` to work:
1. **`bin` field** points to the compiled JS (never TypeScript source)
2. **Shebang** `#!/usr/bin/env node` at the top of the entry file
3. **`files` array** includes the dist directory
4. The built file must be **executable** (tsup/build script should handle this, or add `chmod +x` to the build step)
5. `"type": "module"` for ESM

### How `npx edit` Resolution Works

1. npm checks if `edit` is installed locally, then globally
2. If not found, it downloads from the npm registry temporarily
3. Looks at `package.json` `bin.edit` to find the executable
4. Runs it with Node.js (shebang line tells the OS to use node)

### CLI UX Patterns from Popular Tools

Studied from `create-vite`, `astro`, `next`:

- **Colored output**: Use `picocolors` (tiny, fast) or `chalk` for terminal colors
- **Spinner**: Use `nanospinner` or `ora` for loading states
- **Box/banner**: A startup banner showing the URL and controls
- **Keyboard shortcuts**: Vite's `bindCLIShortcuts` provides `r` to restart, `u` to show URLs, `o` to open browser, `c` to clear, `q` to quit

```typescript
// Startup banner example
import pc from 'picocolors'

function printBanner(port: number) {
  console.log()
  console.log(`  ${pc.bold(pc.cyan('Edit'))} ${pc.dim(`v${version}`)}`)
  console.log()
  console.log(`  ${pc.green('>')} Local:   ${pc.cyan(`http://localhost:${port}/`)}`)
  console.log(`  ${pc.green('>')} Project: ${pc.dim(process.cwd())}`)
  console.log()
  console.log(`  ${pc.dim('press')} ${pc.bold('o')} ${pc.dim('to open in browser')}`)
  console.log(`  ${pc.dim('press')} ${pc.bold('q')} ${pc.dim('to quit')}`)
  console.log()
}
```

---

## 6. Monorepo Structure

### Summary

Edit consists of: (1) a CLI/server package (Node.js), (2) a React editor UI, and (3) shared types/utilities. A pnpm workspace monorepo keeps these organized while publishing as a single npm package.

### Recommended Project Structure

```
edit/
+-- package.json              # Root workspace config
+-- pnpm-workspace.yaml       # Workspace definition
+-- tsconfig.base.json        # Shared TypeScript config
+-- turbo.json                # (optional) Turborepo for build orchestration
|
+-- packages/
|   +-- cli/                  # The npm package users install
|   |   +-- package.json      # name: "edit", bin: { edit: "./dist/cli.js" }
|   |   +-- tsconfig.json
|   |   +-- tsup.config.ts
|   |   +-- src/
|   |       +-- cli.ts        # CLI entry (cac-based)
|   |       +-- server.ts     # Express + Vite middleware server
|   |       +-- plugins/
|   |       |   +-- source-map.ts   # transformIndexHtml plugin
|   |       |   +-- hmr-bridge.ts   # Custom HMR events plugin
|   |       +-- api/
|   |       |   +-- files.ts        # File read/write/tree endpoints
|   |       |   +-- styles.ts       # CSS modification endpoints
|   |       +-- watcher.ts    # File watching logic
|   |
|   +-- editor-ui/            # React editor UI (Vite app)
|   |   +-- package.json      # name: "@edit/editor-ui", private: true
|   |   +-- vite.config.ts    # Build config for the editor
|   |   +-- tsconfig.json
|   |   +-- index.html
|   |   +-- src/
|   |       +-- main.tsx
|   |       +-- App.tsx
|   |       +-- components/
|   |       |   +-- Canvas.tsx       # iframe container + selection overlay
|   |       |   +-- StylePanel.tsx   # CSS property editor
|   |       |   +-- LayersPanel.tsx  # DOM tree view
|   |       |   +-- Toolbar.tsx      # Top toolbar
|   |       +-- hooks/
|   |       |   +-- useEditorSocket.ts  # WebSocket connection
|   |       |   +-- useSelection.ts     # Element selection state
|   |       +-- stores/
|   |           +-- editor.ts       # Editor state (Zustand or similar)
|   |
|   +-- shared/               # Shared types and utilities
|   |   +-- package.json      # name: "@edit/shared"
|   |   +-- tsconfig.json
|   |   +-- src/
|   |       +-- types.ts      # Shared TypeScript interfaces
|   |       +-- protocol.ts   # WebSocket message types
|   |       +-- constants.ts  # Shared constants
|   |
|   +-- bridge/               # Injected into user's iframe
|       +-- package.json      # name: "@edit/bridge", private: true
|       +-- tsconfig.json
|       +-- src/
|           +-- index.ts      # Element selection, postMessage bridge
|           +-- selection.ts  # Click-to-select, hover highlight
|           +-- overlay.ts    # Selection box rendering
|           +-- mutations.ts  # DOM mutation observer
```

### pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'
```

### Root package.json

```json
{
  "private": true,
  "scripts": {
    "dev": "pnpm --filter @edit/editor-ui dev",
    "build": "pnpm -r build",
    "build:cli": "pnpm --filter edit build",
    "build:editor": "pnpm --filter @edit/editor-ui build"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

### Build Strategy

**packages/cli** -- built with **tsup**:

```typescript
// packages/cli/tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node18',
  dts: true,
  clean: true,
  sourcemap: true,
  // Bundle dependencies that shouldn't be required at runtime
  noExternal: ['@edit/shared'],
  banner: {
    js: '#!/usr/bin/env node',
  },
})
```

**packages/editor-ui** -- built with **Vite** (standard React app build):

```typescript
// packages/editor-ui/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/__editor__/',
  build: {
    outDir: 'dist',
    // The CLI package copies this dist into its own dist at build time
  },
})
```

**packages/shared** -- built with **tsup**:

```typescript
// packages/shared/tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
})
```

**packages/bridge** -- built with **tsup** (single IIFE bundle for injection):

```typescript
// packages/bridge/tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['iife'],       // Single file, no imports
  globalName: '__editBridge',
  target: 'es2020',
  clean: true,
  minify: true,
})
```

### Publishing Strategy

Only `packages/cli` is published to npm as `edit`. It bundles:
- Its own server code (via tsup)
- `@edit/shared` (via `noExternal`)
- Copies `@edit/editor-ui/dist` and `@edit/bridge/dist` into its own dist at build time

```json
// packages/cli/package.json
{
  "name": "edit",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "edit": "./dist/cli.js"
  },
  "files": [
    "dist",
    "editor-ui",
    "bridge"
  ],
  "dependencies": {
    "vite": "^6.0.0",
    "express": "^5.0.0",
    "cac": "^6.7.0",
    "parse5": "^7.0.0",
    "postcss": "^8.0.0",
    "picocolors": "^1.0.0",
    "ws": "^8.0.0"
  },
  "scripts": {
    "build": "pnpm run build:deps && tsup",
    "build:deps": "cp -r ../editor-ui/dist ./editor-ui && cp -r ../bridge/dist ./bridge",
    "prepublishOnly": "pnpm run build"
  }
}
```

### tsup vs unbuild vs Vite Library Mode

| Tool | Engine | Best For | Config |
|------|--------|----------|--------|
| **tsup** | esbuild | CLI tools, Node packages | Zero-config, very fast, good DTS |
| **unbuild** | rollup | UnJS ecosystem packages | Auto-infers from package.json |
| **Vite lib mode** | rollup | Browser libraries, React components | Full Vite plugin ecosystem |

**Recommendation**: tsup for Node.js packages (CLI, shared, bridge), Vite for the React editor UI. This matches the ecosystem conventions -- Vite itself uses rollup for building but esbuild for the dev server.

---

## Common Issues and Gotchas

### 1. Two Vite Instances on One Port

When running two Vite dev servers on the same HTTP server, their WebSocket connections can collide. Set different `server.hmr.path` values:

```typescript
// Project Vite
server: { hmr: { path: '/__vite_hmr_project' } }

// Editor Vite (if using a second Vite instance)
server: { hmr: { path: '/__vite_hmr_editor' } }
```

### 2. CORS in iframe

The iframe loads from the same origin (same port), so CORS is not an issue. If you ever separate origins:

```typescript
server: {
  cors: true,
  headers: {
    'X-Frame-Options': 'SAMEORIGIN',
  },
}
```

### 3. transformIndexHtml Only Runs on HTML Entry Points

It does NOT run on HTML fragments or non-entry HTML files by default. For multi-page support, you need the `configureServer` middleware approach shown in Section 2.

### 4. parse5 Serialization May Alter Formatting

parse5's `serialize()` may change whitespace and formatting. For minimal-diff writes:
- Consider using string manipulation with byte offsets from `sourceCodeLocation` instead of re-serializing the entire document.
- Use `startOffset` and `endOffset` to do surgical string replacements.

```typescript
// Surgical replacement using offsets (preserves formatting)
function injectAttribute(
  html: string,
  element: { sourceCodeLocation: ElementLocation },
  attrName: string,
  attrValue: string
): string {
  const tagEnd = element.sourceCodeLocation.startTag.endOffset
  // Insert before the closing > of the start tag
  const insertPos = tagEnd - 1 // before >
  const attr = ` ${attrName}="${attrValue}"`
  return html.slice(0, insertPos) + attr + html.slice(insertPos)
}
```

### 5. HMR Full Reload vs Hot Update

For HTML file changes, Vite does a full page reload (HTML is not hot-replaceable). CSS changes do hot-update. For the editor:
- Style changes: Vite HMR handles it automatically (CSS hot reload)
- HTML changes: Need to reload the iframe. Preserve scroll position and selection state.

### 6. File Write Debouncing

When the user is actively editing styles, many rapid changes happen. Debounce file writes:

```typescript
import { debounce } from './utils'

const pendingWrites = new Map<string, string>()

const flushWrites = debounce(async () => {
  for (const [filePath, content] of pendingWrites) {
    await fs.writeFile(filePath, content, 'utf-8')
  }
  pendingWrites.clear()
}, 150)

function queueWrite(filePath: string, content: string) {
  pendingWrites.set(filePath, content)
  flushWrites()
}
```

---

## References

### Vite Official Documentation
- [JavaScript API (createServer)](https://vite.dev/guide/api-javascript)
- [Plugin API (transformIndexHtml, configureServer, handleHotUpdate)](https://vite.dev/guide/api-plugin)
- [Server Options (middlewareMode)](https://vite.dev/config/server-options)
- [SSR Guide (middleware mode examples)](https://vite.dev/guide/ssr)
- [HMR API](https://vite.dev/guide/api-hmr)
- [Environment API (Vite 6)](https://vite.dev/guide/api-environment-frameworks)

### CLI Libraries
- [cac (Vite's CLI framework)](https://github.com/cacjs/cac)
- [citty (UnJS CLI framework)](https://github.com/unjs/citty)
- [Commander.js](https://github.com/tj/commander.js)

### HTML Parsing
- [parse5 (WHATWG-compliant HTML parser)](https://parse5.js.org/)
- [parse5 ParserOptions (sourceCodeLocationInfo)](https://parse5.js.org/interfaces/parse5.ParserOptions.html)
- [htmlparser2 (fast, forgiving HTML parser)](https://github.com/fb55/htmlparser2)

### File Watching
- [chokidar](https://github.com/paulmillr/chokidar)

### Build Tools
- [tsup](https://tsup.egoist.dev/)
- [pnpm workspaces](https://pnpm.io/workspaces)

### Community Resources
- [Vite dev server middleware -- DEV Community](https://dev.to/brense/vite-dev-server-adding-middleware-3mp5)
- [Vite plugin for modifying HTML -- Branimir Rijavec](https://rijavecb.com/blog/building-a-vite-plugin-for-modifying-html/)
- [Send real-time events via Vite WS -- Vue School](https://vueschool.io/articles/vuejs-tutorials/how-to-send-real-time-custom-events-from-the-browser-a-vite-dev-server/)
- [Complete Monorepo Guide: pnpm + Workspace -- jsdev.space](https://jsdev.space/complete-monorepo-guide/)
- [vite-plugin-multiple (multiple Vite instances)](https://github.com/vite-plugin/vite-plugin-multiple)
