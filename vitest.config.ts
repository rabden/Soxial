import { defineConfig, configDefaults } from 'vitest/config'
import { resolve } from 'path'

// The renderer uses `src/...` bare-specifier imports (resolved by electron-vite
// via tsconfig paths). Vitest's jsdom (web) transform needs them too, so mirror
// the mapping here. Renderer tests opt into jsdom per-file via
// `// @vitest-environment jsdom`.
//
// globalSetup self-heals the better-sqlite3 ABI (Electron dev build vs Node
// test runtime — see scripts/vitest-global-setup.cjs) so a bare
// `npx vitest run` is as safe as `npm test`.
export default defineConfig({
  test: {
    globalSetup: './scripts/vitest-global-setup.cjs',
    // `.delta/` holds agent worktree checkouts of this same repo — their test
    // copies must not run alongside the real suite. `.tmp/` holds reference
    // clones (grok-build, opencode) studied during design work — same rule.
    exclude: [...configDefaults.exclude, '**/.delta/**', '**/.tmp/**'],
  },
  resolve: {
    alias: {
      src: resolve(__dirname, 'src'),
    },
  },
})
