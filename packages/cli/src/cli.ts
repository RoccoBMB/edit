import cac from 'cac'
import pc from 'picocolors'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createEditServer } from './server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(await readFile(path.resolve(__dirname, '../package.json'), 'utf-8')) as { version: string }
const version = pkg.version

/** Recursively check if any .html files exist in a directory */
async function hasHtmlFiles(dir: string, depth = 0): Promise<boolean> {
  if (depth > 3) return false // Don't go too deep
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
        continue
      }
      if (entry.isFile() && entry.name.endsWith('.html')) {
        return true
      }
      if (entry.isDirectory()) {
        const found = await hasHtmlFiles(path.join(dir, entry.name), depth + 1)
        if (found) return true
      }
    }
  } catch {
    // Directory not readable
  }
  return false
}

const cli = cac('edit')

cli
  .command('[root]', 'Start the visual editor')
  .option('-p, --port <port>', 'Server port', { default: 4444 })
  .option('-o, --open', 'Open browser automatically', { default: true })
  .option('--no-open', 'Do not open browser')
  .option('--host <host>', 'Bind to a specific host')
  .action(async (root: string | undefined, options: { port: number; open: boolean; host?: string }) => {
    const projectRoot = root ?? process.cwd()

    console.log()
    console.log(`  ${pc.cyan('edit')} ${pc.dim(`v${version}`)}`)
    console.log()

    if (options.host && options.host !== '127.0.0.1' && options.host !== 'localhost') {
      console.log(pc.yellow(`  ⚠  Warning: Binding to ${options.host} exposes the editor to the network.`))
      console.log(pc.yellow(`     The editor has full read/write access to project files.`))
      console.log()
    }

    // Check for HTML files before starting the server
    const foundHtml = await hasHtmlFiles(projectRoot)
    if (!foundHtml) {
      console.error(`  ${pc.red('ERROR')}  No HTML files found in this directory.`)
      console.error()
      console.error(`  Edit looks for ${pc.cyan('.html')} files in the directory where you run it.`)
      console.error(`  Try running from your project root, or specify a path:`)
      console.error()
      console.error(`    ${pc.dim('$')} ${pc.cyan('npx @edit/cli ./my-project')}`)
      console.error()
      process.exit(1)
    }

    try {
      const { url } = await createEditServer({
        projectRoot,
        port: options.port,
        host: options.host ?? '127.0.0.1',
        open: options.open,
      })

      console.log(`  ${pc.green('➜')}  Editor:  ${pc.cyan(url)}`)
      console.log(`  ${pc.green('➜')}  Project: ${pc.dim(projectRoot)}`)
      console.log()
      console.log(`  ${pc.dim('Press')} ${pc.bold('q')} ${pc.dim('to quit')}`)
      console.log()

      // Handle keyboard shortcuts
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true)
        process.stdin.resume()
        process.stdin.on('data', (data) => {
          const key = data.toString()
          if (key === 'q' || key === '\x03') {
            console.log(pc.dim('\n  Shutting down...\n'))
            process.exit(0)
          }
        })
      }
    } catch (err) {
      // Handle port-in-use error with helpful message
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        console.error(`  ${pc.red('ERROR')}  Port ${options.port} is already in use.`)
        console.error()
        console.error(`  Try a different port:`)
        console.error()
        console.error(`    ${pc.dim('$')} ${pc.cyan(`npx @edit/cli --port ${options.port + 1}`)}`)
        console.error()
        process.exit(1)
      }

      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error(`\n  ${pc.red('ERROR')}  ${message}\n`)
      process.exit(1)
    }
  })

cli.help()
cli.version(version)
cli.parse()
