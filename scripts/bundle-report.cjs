const { existsSync, readdirSync, statSync } = require('fs')
const { join, relative } = require('path')
const { gzipSync, brotliCompressSync } = require('zlib')

const root = join(process.cwd(), 'out', 'renderer')
if (!existsSync(root)) {
  console.error('Renderer output not found. Run the build before bundle:check.')
  process.exit(1)
}

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

const files = filesUnder(root)
const assets = files.filter(file => /\.(js|css)$/.test(file))
const report = assets.map(file => {
  const source = require('fs').readFileSync(file)
  return {
    file: relative(root, file),
    bytes: source.length,
    gzip: gzipSync(source).length,
    brotli: brotliCompressSync(source).length,
  }
}).sort((a, b) => b.bytes - a.bytes)

for (const entry of report) {
  console.log(`${entry.file}\t${entry.bytes} B raw\t${entry.gzip} B gzip\t${entry.brotli} B brotli`)
}

// Vite emits route and library chunks beside the entry. The index entry is the
// part fetched before the lazy workspace is selected, so keep the budget tied
// to that measurable startup artifact rather than summing every lazy chunk.
const initialJs = report
  .filter(entry => /^assets\/index-[^/]+\.js$/.test(entry.file))
  .reduce((total, entry) => total + entry.bytes, 0)
const initialCss = report
  .filter(entry => entry.file.endsWith('.css'))
  .reduce((total, entry) => total + entry.bytes, 0)

console.log(`Initial JS budget: ${initialJs} / 2,000,000 B`)
console.log(`Initial CSS budget: ${initialCss} / 500,000 B`)

if (initialJs > 2_000_000 || initialCss > 500_000) {
  console.error('Renderer bundle budget exceeded.')
  process.exitCode = 1
}
