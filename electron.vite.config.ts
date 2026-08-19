import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src',
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/index.html') },
        output: {
          manualChunks: {
            markdown: ['streamdown', '@streamdown/cjk', '@streamdown/code', '@streamdown/math'],
            mermaid: ['@streamdown/mermaid'],
            socialEmbeds: ['react-tweet'],
          },
        },
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src'),
        'src': resolve(__dirname, 'src')
      }
    },
    plugins: [react()]
  }
})
