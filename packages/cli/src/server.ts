import { createServer as createViteServer } from 'vite'
import { createServer as createHttpServer } from 'node:http'
import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { editVitePlugin } from './vite-plugin.js'
import { createWsHandler } from './ws-handler.js'
import { createWriteQueue } from './write-queue.js'

interface ServerOptions {
  projectRoot: string
  port: number
  host: string
  open: boolean
}

export async function createEditServer(options: ServerOptions) {
  const { projectRoot, port, host, open } = options

  // Verify project root exists and has HTML files
  if (!fs.existsSync(projectRoot)) {
    throw new Error(`Directory not found: ${projectRoot}`)
  }

  // Generate auth token
  const authToken = crypto.randomBytes(24).toString('hex')

  // Create the serialized write queue
  const writeQueue = createWriteQueue()

  // Resolve editor-ui dist path (bundled into the CLI package)
  const editorDistPath = resolveEditorDist()

  // Create Vite dev server in middleware mode for the user's project
  const vite = await createViteServer({
    root: projectRoot,
    server: {
      middlewareMode: true,
      hmr: {
        // Use a separate path for HMR to avoid conflicts
        path: '/__edit_hmr__',
      },
    },
    appType: 'custom',
    plugins: [
      editVitePlugin({ projectRoot, ownWrites: writeQueue.ownWrites }),
    ],
    // Don't clear the screen — we have our own CLI output
    clearScreen: false,
    logLevel: 'warn',
  })

  // Create HTTP server
  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    // Validate Host header (DNS rebinding protection)
    const hostHeader = req.headers.host ?? ''
    if (!hostHeader.startsWith('localhost:') && !hostHeader.startsWith('127.0.0.1:')) {
      res.writeHead(403)
      res.end('Forbidden: Invalid host header')
      return
    }

    // Serve editor UI at the root and its assets
    if (url.pathname === '/' || url.pathname.startsWith('/__editor__/') || url.pathname.startsWith('/assets/')) {
      // Auth check for editor pages
      const token = url.searchParams.get('token')
      if (url.pathname === '/' && token !== authToken) {
        res.writeHead(401, { 'Content-Type': 'text/html' })
        res.end('<h1>401 Unauthorized</h1><p>Invalid or missing auth token.</p>')
        return
      }

      serveEditorUI(req, res, url, editorDistPath, authToken)
      return
    }

    // API: list HTML files in the project
    if (url.pathname === '/__project__/_files') {
      const htmlFiles = findHtmlFiles(projectRoot)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ files: htmlFiles }))
      return
    }

    // Serve user's project files under /__project__/
    if (url.pathname.startsWith('/__project__/')) {
      const projectPath = url.pathname.replace('/__project__', '')
      const filePath = path.join(projectRoot, projectPath)

      // Only transform HTML files through our pipeline
      if (filePath.endsWith('.html') && fs.existsSync(filePath)) {
        try {
          let html = fs.readFileSync(filePath, 'utf-8')
          html = await vite.transformIndexHtml(projectPath, html)
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(html)
        } catch (err) {
          res.writeHead(500)
          res.end('Error transforming HTML')
        }
        return
      }

      // For non-HTML assets, let Vite serve them
      req.url = projectPath
      vite.middlewares(req, res)
      return
    }

    // Serve static assets from the project directory
    // This handles absolute paths like /assets/images/photo.jpg referenced in HTML
    const staticPath = path.join(projectRoot, url.pathname)
    if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
      const ext = path.extname(staticPath)
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'
      const fileContent = fs.readFileSync(staticPath)
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(fileContent)
      return
    }

    // Let Vite handle everything else (HMR, assets, etc.)
    vite.middlewares(req, res)
  })

  // Set up WebSocket handler
  createWsHandler({
    server: httpServer,
    projectRoot,
    authToken,
    writeQueue,
  })

  // Start listening
  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', reject)
    httpServer.listen(port, host, () => resolve())
  })

  const url = `http://localhost:${port}/?token=${authToken}`

  // Open browser
  if (open) {
    const { exec } = await import('node:child_process')
    const cmd = process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open'
    exec(`${cmd} "${url}"`)
  }

  return { url, authToken, httpServer, vite }
}

function resolveEditorDist(): string {
  // In development: look for editor-ui/dist relative to this file
  // In production: it's bundled into the CLI's dist/editor directory
  const candidates = [
    path.resolve(import.meta.dirname, '../../editor-ui/dist'),
    path.resolve(import.meta.dirname, '../editor'),
    path.resolve(import.meta.dirname, './editor'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  // Fallback: serve a minimal inline editor
  return ''
}

function serveEditorUI(
  _req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  url: URL,
  editorDistPath: string,
  authToken: string,
) {
  // If no built editor-ui found, serve an inline minimal editor
  if (!editorDistPath) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(getInlineEditorHtml(authToken))
    return
  }

  // Serve static files from editor-ui/dist
  let filePath: string
  if (url.pathname === '/') {
    filePath = path.join(editorDistPath, 'index.html')
  } else if (url.pathname.startsWith('/__editor__/')) {
    filePath = path.join(editorDistPath, url.pathname.replace('/__editor__/', ''))
  } else {
    // /assets/... and other paths served directly from editor dist
    filePath = path.join(editorDistPath, url.pathname)
  }

  // Security: ensure we stay within editor dist
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(editorDistPath))) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  if (!fs.existsSync(resolved)) {
    // SPA fallback
    filePath = path.join(editorDistPath, 'index.html')
  }

  const ext = path.extname(filePath)
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'

  if (ext === '.html') {
    let content = fs.readFileSync(filePath, 'utf-8')
    // Inject auth token into the editor HTML
    content = content.replace(
      '</head>',
      `<script>window.__EDIT_TOKEN__="${authToken}";</script></head>`,
    )
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(content)
    return
  }

  // Non-HTML: serve as binary
  const content = fs.readFileSync(filePath)
  res.writeHead(200, { 'Content-Type': contentType })
  res.end(content)
}

/** Synchronously find all .html files in a directory (recursive, skips node_modules/dist/.dirs) */
function findHtmlFiles(dir: string, base = ''): string[] {
  const results: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue
      const rel = base ? `${base}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        results.push(...findHtmlFiles(path.join(dir, entry.name), rel))
      } else if (entry.name.endsWith('.html')) {
        results.push(rel)
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return results
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
}

/**
 * Inline minimal editor HTML for when the editor-ui is not yet built.
 * This provides basic functionality during development.
 */
function getInlineEditorHtml(_authToken: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>onpage</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { display: grid; grid-template-columns: 240px 1fr; grid-template-rows: 1fr 44px; height: 100vh; font-family: -apple-system, sans-serif; background: #1e1e2e; color: #e0e0e8; }
    .sidebar { background: #2a2a3e; border-right: 1px solid #3a3a4e; padding: 12px; overflow-y: auto; }
    .sidebar h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #8888a0; margin-bottom: 8px; }
    .canvas { position: relative; background: #181825; overflow: hidden; }
    .canvas iframe { width: 100%; height: 100%; border: none; background: white; }
    .toolbar { grid-column: 1/-1; background: #2a2a3e; border-top: 1px solid #3a3a4e; display: flex; align-items: center; padding: 0 12px; font-size: 12px; color: #8888a0; gap: 8px; }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; }
    #selection-info { margin-left: auto; font-family: monospace; font-size: 11px; }
    .overlay { position: absolute; border: 2px solid #4a90d9; pointer-events: none; z-index: 1000; transition: all 0.1s ease-out; display: none; }
  </style>
</head>
<body>
  <div class="sidebar">
    <h2>Layers</h2>
    <p style="font-size:12px;color:#8888a0">Click an element to select it.</p>
  </div>
  <div class="canvas">
    <div class="overlay" id="overlay"></div>
    <iframe id="preview" src="/__project__/index.html"></iframe>
  </div>
  <div class="toolbar">
    <div class="dot"></div>
    <span>Ready</span>
    <span id="selection-info"></span>
  </div>
  <script>
    const iframe = document.getElementById('preview');
    const overlay = document.getElementById('overlay');
    const info = document.getElementById('selection-info');

    iframe.addEventListener('load', () => {
      const doc = iframe.contentDocument;
      if (!doc) return;

      doc.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        let el = e.target;
        while (el && !el.getAttribute('data-edit-loc')) el = el.parentElement;
        if (!el) return;

        const loc = el.getAttribute('data-edit-loc');
        const rect = el.getBoundingClientRect();
        const iframeRect = iframe.getBoundingClientRect();

        overlay.style.display = 'block';
        overlay.style.left = (rect.x + iframeRect.x) + 'px';
        overlay.style.top = (rect.y + iframeRect.y) + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
        info.textContent = loc;

        console.log('[Edit] Selected:', loc, { tag: el.tagName, rect });
      }, true);

      doc.addEventListener('click', (e) => {
        if (e.target.closest('a')) e.preventDefault();
      }, true);
      doc.addEventListener('submit', (e) => e.preventDefault(), true);
    });
  </script>
</body>
</html>`
}
