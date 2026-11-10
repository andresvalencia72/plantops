import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const root = new URL('../', import.meta.url).pathname
const suffixes = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.md', '.json'])
const ignored = new Set(['.git', '.engram', '.codegraph', 'node_modules', 'dist', 'build', 'coverage'])
const generated = new Set(['package-lock.json'])
const violations = []

function inspect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) inspect(path)
      continue
    }
    if (!entry.isFile() || !suffixes.has(extname(path)) || generated.has(entry.name)) continue
    const lines = readFileSync(path, 'utf8').split(/\r?\n/).length
    if (lines > 400) violations.push({ file: relative(root, path), lines })
  }
}

inspect(root)
if (violations.length) {
  console.error('Archivos que superan 400 líneas:', violations)
  process.exitCode = 1
} else {
  console.info('OK: cada archivo escrito a mano tiene como máximo 400 líneas.')
}
