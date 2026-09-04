import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  describeAbi,
  isExternallyOwned,
  parseCompiledAbi,
  resolveNativeOwner,
} from '../scripts/native-abi.cjs'

const PROJECT = path.resolve('/repo/app')

describe('locating the native addon owner', () => {
  it('derives the owning prefix from the package manifest', () => {
    const owner = resolveNativeOwner(() => '/repo/app/node_modules/better-sqlite3/package.json')

    expect(owner).toEqual({
      packageRoot: path.normalize('/repo/app/node_modules/better-sqlite3'),
      prefix: path.normalize('/repo/app'),
      binaryPath: path.normalize('/repo/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
    })
  })

  it('returns null when the package is not installed', () => {
    expect(resolveNativeOwner(() => { throw new Error('MODULE_NOT_FOUND') })).toBeNull()
  })

  it('resolves the real project install in this repo', () => {
    // Uses the live resolver, so it also proves the path shape is right.
    const owner = resolveNativeOwner()
    expect(owner).not.toBeNull()
    expect(owner!.packageRoot.endsWith(path.join('node_modules', 'better-sqlite3'))).toBe(true)
    expect(owner!.binaryPath.endsWith('better_sqlite3.node')).toBe(true)
  })
})

describe('detecting an out-of-project install', () => {
  it('flags a package hoisted above the project', () => {
    // The case that made `npm rebuild` silently no-op.
    const owner = resolveNativeOwner(() => '/repo/node_modules/better-sqlite3/package.json')
    expect(isExternallyOwned(owner, PROJECT)).toBe(true)
  })

  it('does not flag a normal local install', () => {
    const owner = resolveNativeOwner(() => '/repo/app/node_modules/better-sqlite3/package.json')
    expect(isExternallyOwned(owner, PROJECT)).toBe(false)
  })

  it('treats a missing package as not externally owned', () => {
    expect(isExternallyOwned(null, PROJECT)).toBe(false)
  })
})

describe('ABI diagnostics', () => {
  it('extracts the compiled ABI from a Node load error', () => {
    const message = [
      "The module '/x/better_sqlite3.node'",
      'was compiled against a different Node.js version using',
      'NODE_MODULE_VERSION 146. This version of Node.js requires',
      'NODE_MODULE_VERSION 137.',
    ].join('\n')

    // The first occurrence is what the binary was built against.
    expect(parseCompiledAbi(message)).toBe(146)
  })

  it('returns null for unrelated errors', () => {
    expect(parseCompiledAbi('Module did not self-register')).toBeNull()
    expect(parseCompiledAbi(undefined)).toBeNull()
  })

  it('names Electron when the ABI is ahead of the running Node', () => {
    const ahead = Number(process.versions.modules) + 9
    expect(describeAbi(ahead)).toContain('Electron')
    expect(describeAbi(ahead)).toContain('native:electron')
  })

  it('recognises a binary built for the running Node', () => {
    expect(describeAbi(Number(process.versions.modules))).toContain('Node')
  })

  it('handles an unknown ABI', () => {
    expect(describeAbi(null)).toBe('unknown runtime')
  })
})
