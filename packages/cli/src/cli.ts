import cac from 'cac'
import pc from 'picocolors'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createEditServer } from './server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(await readFile(path.resolve(__dirname, '../package.json'), 'utf-8')) as { version: string }
const version = pkg.version

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
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error(`\n  ${pc.red('ERROR')}  ${message}\n`)
      process.exit(1)
    }
  })

cli.help()
cli.version(version)
cli.parse()
