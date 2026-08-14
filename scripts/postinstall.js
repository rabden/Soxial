const { spawnSync } = require('node:child_process')

const run = (cmd, args) => {
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (res.error) throw res.error
  if (res.status !== 0) process.exit(res.status ?? 1)
}

run('node', ['node_modules/electron/install.js'])

if (process.env.CI) {
  console.log('CI detected: skipping electron-builder install-app-deps (native modules kept for Node ABI used by tests)')
} else {
  console.log('Rebuilding native dependencies for Electron ABI...')
  run('electron-builder', ['install-app-deps'])
}