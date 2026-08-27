import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// The renderer uses `src/...` bare-specifier imports (resolved by electron-vite
// via tsconfig paths). Vitest's jsdom (web) transform needs them too, so mirror
// the mapping here. Renderer tests opt into jsdom per-file via
// `// @vitest-environment jsdom`.
export default defineConfig({
  resolve: {
    alias: {
      src: resolve(__dirname, 'src'),
    },
  },
})
