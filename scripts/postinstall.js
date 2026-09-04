const { spawnSync } = require('node:child_process')

const run = (cmd, args) => {
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (res.error) throw res.error
  if (res.status !== 0) process.exit(res.status ?? 1)
}

run('node', ['node_modules/electron/install.js'])

const target = process.env.SOXIAL_NATIVE_TARGET
if (target === 'node') {
  console.log('Preparing native dependencies for the Node test ABI...')
  run('npm', ['rebuild', 'better-sqlite3', '--force'])
} else if (target === 'electron' || !process.env.CI) {
  console.log('Rebuilding native dependencies for the Electron ABI...')
  run('electron-builder', ['install-app-deps'])
} else {
  console.log('CI install complete; native ABI will be prepared by the explicit test/build step.')
}
