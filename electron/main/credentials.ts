import { app, safeStorage } from 'electron'
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

type Vault = { version: 1; credentials: Record<string, string> }

function vaultPath(): string {
  return join(app.getPath('userData'), 'credentials.vault')
}

function readVault(): Vault {
  const path = vaultPath()
  if (!existsSync(path)) return { version: 1, credentials: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Vault
    return parsed.version === 1 && parsed.credentials ? parsed : { version: 1, credentials: {} }
  } catch {
    throw new Error('Secure credential storage is unreadable. Re-enter your API credentials.')
  }
}

function writeVault(vault: Vault): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure credential storage is unavailable. API credentials were not saved.')
  }
  const path = vaultPath()
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify(vault), { mode: 0o600 })
  chmodSync(temp, 0o600)
  renameSync(temp, path)
}

export function isCredentialStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function saveCredential(id: string, value: string): void {
  const vault = readVault()
  vault.credentials[id] = safeStorage.encryptString(value).toString('base64')
  writeVault(vault)
}

export function getCredential(id: string): string | null {
  try {
    const encoded = readVault().credentials[id]
    if (!encoded) return null
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  } catch (err) {
    return null
  }
}

export function deleteCredential(id: string): void {
  const vault = readVault()
  if (!vault.credentials[id]) return
  delete vault.credentials[id]
  writeVault(vault)
}

export function credentialFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export function credentialSuffix(value: string): string {
  return value.length > 4 ? `••••${value.slice(-4)}` : '••••'
}
