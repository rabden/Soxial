import Database from 'better-sqlite3'
import { app } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { promises as fs, readFileSync, statSync } from 'fs'
import { basename, dirname, extname, join, resolve, sep } from 'path'
import { zipSync, strToU8 } from 'fflate'
import { getDb, getDatabasePath, closeDb, getSchemaVersion } from './db'
import { logger } from './log'

export const BACKUP_FORMAT_VERSION = 1
export const EXPORT_FORMAT_VERSION = 1
const BACKUP_DIRECTORY = 'backups'
const MEDIA_DIRECTORY = 'media'
const MAX_MEDIA_FILE_BYTES = 25 * 1024 * 1024
const MAX_EXPORT_MEDIA_BYTES = 100 * 1024 * 1024

export interface BackupMetadata {
  format: 'soxial-sqlite-backup'
  formatVersion: number
  fileName: string
  appVersion: string
  schemaVersion: number
  createdAt: string
  reason: string
  sizeBytes: number
  sha256: string
  integrityCheck: 'ok'
}

export interface BackupListItem extends BackupMetadata {
  verified: boolean
  verificationError?: string
}

export interface ExportResult {
  destination: string
  format: 'json' | 'zip'
  sizeBytes: number
  includedMediaCount: number
  includedMediaBytes: number
}

function backupDirectory(): string {
  return join(app.getPath('userData'), BACKUP_DIRECTORY)
}

function metadataPath(fileName: string): string {
  return join(backupDirectory(), `${fileName}.meta.json`)
}

function assertBackupFileName(fileName: string): string {
  const safeName = basename(fileName)
  if (safeName !== fileName || !/^soxial-[a-z0-9TZ_.-]+\.db$/i.test(safeName)) {
    throw new Error('Invalid backup selection.')
  }
  const path = resolve(backupDirectory(), safeName)
  const root = resolve(backupDirectory()) + sep
  if (!path.startsWith(root)) throw new Error('Backup selection is outside the backup directory.')
  return path
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function verifySqliteFile(path: string): Promise<void> {
  const backupDb = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const result = backupDb.pragma('integrity_check', { simple: true })
    if (result !== 'ok') throw new Error(`SQLite integrity check failed: ${String(result)}`)
  } finally {
    backupDb.close()
  }
}

export async function createBackup(reason = 'manual', options: { prune?: boolean } = {}): Promise<BackupMetadata> {
  const directory = backupDirectory()
  await fs.mkdir(directory, { recursive: true })

  const createdAt = new Date().toISOString()
  const stamp = createdAt.replace(/[:.]/g, '-')
  const fileName = `soxial-${stamp}-${randomUUID().slice(0, 8)}.db`
  const finalPath = join(directory, fileName)
  const temporaryPath = join(directory, `.${fileName}.${process.pid}.tmp`)
  const temporaryMetadataPath = join(directory, `.${fileName}.${process.pid}.meta.tmp`)

  try {
    const db = getDb()
    await db.backup(temporaryPath)
    await verifySqliteFile(temporaryPath)

    const stat = await fs.stat(temporaryPath)
    const metadata: BackupMetadata = {
      format: 'soxial-sqlite-backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      fileName,
      appVersion: app.getVersion(),
      schemaVersion: getSchemaVersion(db),
      createdAt,
      reason,
      sizeBytes: stat.size,
      sha256: sha256(temporaryPath),
      integrityCheck: 'ok',
    }

    await fs.writeFile(temporaryMetadataPath, JSON.stringify(metadata, null, 2), { encoding: 'utf8', mode: 0o600 })
    await fs.rename(temporaryPath, finalPath)
    await fs.rename(temporaryMetadataPath, metadataPath(fileName))
    logger.info('backup', `created verified backup ${fileName} (${reason})`)
    if (options.prune !== false) await pruneBackups()
    return metadata
  } catch (error) {
    await Promise.allSettled([
      fs.rm(temporaryPath, { force: true }),
      fs.rm(temporaryMetadataPath, { force: true }),
      fs.rm(finalPath, { force: true }),
      fs.rm(metadataPath(fileName), { force: true }),
    ])
    throw error
  }
}

export async function verifyBackup(fileName: string): Promise<BackupListItem> {
  const path = assertBackupFileName(fileName)
  try {
    const metadata = JSON.parse(await fs.readFile(metadataPath(fileName), 'utf8')) as BackupMetadata
    if (metadata.format !== 'soxial-sqlite-backup' || metadata.formatVersion !== BACKUP_FORMAT_VERSION || metadata.fileName !== fileName) {
      throw new Error('Unsupported backup metadata.')
    }
    const stat = await fs.stat(path)
    if (stat.size !== metadata.sizeBytes || sha256(path) !== metadata.sha256) {
      throw new Error('Backup checksum does not match its metadata.')
    }
    await verifySqliteFile(path)
    return { ...metadata, verified: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backup verification failed.'
    return {
      format: 'soxial-sqlite-backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      fileName,
      appVersion: '',
      schemaVersion: 0,
      createdAt: '',
      reason: '',
      sizeBytes: 0,
      sha256: '',
      integrityCheck: 'ok',
      verified: false,
      verificationError: message,
    }
  }
}

export async function listBackups(): Promise<BackupListItem[]> {
  const directory = backupDirectory()
  await fs.mkdir(directory, { recursive: true })
  const names = (await fs.readdir(directory))
    .filter(name => name.endsWith('.db'))
    .sort()
    .reverse()
  const backups = await Promise.all(names.map(name => verifyBackup(name)))
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function pruneBackups(policy: { daily?: number; weekly?: number; maxCount?: number; maxBytes?: number } = {}): Promise<void> {
  const daily = policy.daily ?? 7
  const weekly = policy.weekly ?? 4
  const maxCount = policy.maxCount ?? 16
  const maxBytes = policy.maxBytes ?? 512 * 1024 * 1024
  const backups = (await listBackups()).filter(backup => backup.verified)
  if (backups.length <= 1) return

  const keep = new Set<string>([backups[0].fileName])
  const dailyKeys = new Set<string>()
  const weeklyKeys = new Set<string>()
  for (const backup of backups) {
    const date = new Date(backup.createdAt)
    if (Number.isNaN(date.getTime())) continue
    const dayKey = date.toISOString().slice(0, 10)
    const weekKey = `${date.getUTCFullYear()}-${Math.floor((date.getUTCDate() - 1) / 7)}-${date.getUTCMonth()}`
    if (dailyKeys.size < daily && !dailyKeys.has(dayKey)) {
      dailyKeys.add(dayKey)
      keep.add(backup.fileName)
    } else if (weeklyKeys.size < weekly && !weeklyKeys.has(weekKey)) {
      weeklyKeys.add(weekKey)
      keep.add(backup.fileName)
    }
  }

  let totalBytes = backups.filter(backup => keep.has(backup.fileName)).reduce((sum, backup) => sum + backup.sizeBytes, 0)
  for (const backup of backups) {
    if (keep.has(backup.fileName)) continue
    if (keep.size >= maxCount || totalBytes + backup.sizeBytes > maxBytes) {
      await Promise.all([
        fs.rm(assertBackupFileName(backup.fileName), { force: true }),
        fs.rm(metadataPath(backup.fileName), { force: true }),
      ])
      continue
    }
    keep.add(backup.fileName)
    totalBytes += backup.sizeBytes
  }
}

export async function restoreBackup(fileName: string): Promise<BackupMetadata> {
  const selected = await verifyBackup(fileName)
  if (!selected.verified) throw new Error(selected.verificationError || 'The selected backup is not valid.')

  const currentSnapshot = await createBackup('pre-restore', { prune: false })
  const databasePath = getDatabasePath()
  const rollbackPath = `${databasePath}.pre-restore-${randomUUID()}`
  const replacementPath = `${databasePath}.restore-${randomUUID()}`

  try {
    await closeDb()
    await fs.rename(databasePath, rollbackPath)
    await fs.copyFile(assertBackupFileName(fileName), replacementPath)
    await fs.rename(replacementPath, databasePath)
    getDb()
    await fs.rm(rollbackPath, { force: true })
    await Promise.all([
      fs.rm(`${databasePath}-wal`, { force: true }),
      fs.rm(`${databasePath}-shm`, { force: true }),
    ])
    logger.info('backup', `restored verified backup ${fileName}`)
    return currentSnapshot
  } catch (error) {
    await Promise.allSettled([
      closeDb(),
      fs.rm(replacementPath, { force: true }),
      fs.rm(databasePath, { force: true }),
    ])
    try {
      await fs.rename(rollbackPath, databasePath)
      getDb()
    } catch (rollbackError) {
      logger.error('backup', 'database restore rollback failed', rollbackError)
    }
    throw error
  }
}

function redactExportText(value: string): string {
  return value
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bZAI[_-][A-Za-z0-9_-]{12,}\b/gi, '[REDACTED_API_KEY]')
    .replace(/\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
}

function isSensitiveKey(key: string): boolean {
  return /api[_-]?key|credential|secret|token|password|cookie|authorization/i.test(key)
}

function sanitizeExportValue(value: unknown, key = ''): unknown {
  if (isSensitiveKey(key)) return undefined
  if (typeof value === 'string') return redactExportText(value)
  if (Array.isArray(value)) return value.map(item => sanitizeExportValue(item)).filter(item => item !== undefined)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([childKey, childValue]) => [childKey, sanitizeExportValue(childValue, childKey)] as const)
      .filter(([, childValue]) => childValue !== undefined))
  }
  return value
}

function safeTableRows(db: Database.Database, table: string): unknown[] {
  return (db.prepare(`SELECT * FROM ${table}`).all() as unknown[])
    .map(row => sanitizeExportValue(row))
}

function collectMedia(rows: unknown[], mediaFiles: Map<string, Uint8Array>, mediaDirectory: string, mediaBytes: { value: number }): void {
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const candidate = (row as Record<string, unknown>).media_path
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    const absolutePath = resolve(mediaDirectory, candidate)
    const root = resolve(mediaDirectory) + sep
    if (!absolutePath.startsWith(root)) continue
    try {
      const stat = statSync(absolutePath)
      if (!stat.isFile() || stat.size > MAX_MEDIA_FILE_BYTES || mediaBytes.value + stat.size > MAX_EXPORT_MEDIA_BYTES) continue
      const archiveName = `media/${basename(absolutePath)}`
      if (mediaFiles.has(archiveName)) continue
      mediaFiles.set(archiveName, new Uint8Array(readFileSync(absolutePath)))
      mediaBytes.value += stat.size
    } catch {
      // Missing media should not make the user's content export fail.
    }
  }
}

export async function exportUserData(destination: string, options: { includeMedia?: boolean } = {}): Promise<ExportResult> {
  const outputPath = resolve(destination)
  const outputFormat = extname(outputPath).toLowerCase() === '.json' ? 'json' : 'zip'
  const db = getDb()
  const tables = [
    'user_profile',
    'memory_entries',
    'hooks',
    'replies',
    'voice_rules',
    'algorithm_rules',
    'content_pillars',
    'target_accounts',
    'scheduled_posts',
    'chat_sessions',
    'chat_messages',
    'growth_milestones',
    'social_content',
  ]
  const data: Record<string, unknown[]> = {}
  for (const table of tables) data[table] = safeTableRows(db, table)

  const mediaFiles = new Map<string, Uint8Array>()
  const mediaBytes = { value: 0 }
  if (options.includeMedia) collectMedia(data.scheduled_posts, mediaFiles, join(app.getPath('userData'), MEDIA_DIRECTORY), mediaBytes)

  const manifest = {
    format: 'soxial-user-data-export',
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    schemaVersion: getSchemaVersion(db),
    credentialsExcluded: true,
    excludedTables: ['api_keys', 'schema_migrations'],
    media: {
      mode: options.includeMedia ? 'included-where-safe' : 'metadata-only',
      fileCount: mediaFiles.size,
      bytes: mediaBytes.value,
    },
  }
  const dataJson = JSON.stringify({ manifest, data }, null, 2)
  await fs.mkdir(dirname(outputPath), { recursive: true })
  if (outputFormat === 'json') {
    await fs.writeFile(outputPath, dataJson, { encoding: 'utf8', mode: 0o600 })
  } else {
    const archive: Record<string, Uint8Array> = {
      'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
      'data.json': strToU8(dataJson),
    }
    for (const [name, bytes] of mediaFiles) archive[name] = bytes
    await fs.writeFile(outputPath, zipSync(archive, { level: 6 }), { mode: 0o600 })
  }

  const stat = await fs.stat(outputPath)
  return {
    destination: outputPath,
    format: outputFormat,
    sizeBytes: stat.size,
    includedMediaCount: mediaFiles.size,
    includedMediaBytes: mediaBytes.value,
  }
}

let automaticBackupTimer: NodeJS.Timeout | null = null

export function scheduleAutomaticBackups(): void {
  if (automaticBackupTimer) clearTimeout(automaticBackupTimer)
  automaticBackupTimer = setTimeout(() => {
    void (async () => {
      try {
        const backups = await listBackups()
        const latestAutomatic = backups.find(backup => backup.verified && backup.reason === 'automatic')
        const age = latestAutomatic ? Date.now() - Date.parse(latestAutomatic.createdAt) : Infinity
        if (age >= 24 * 60 * 60 * 1000) await createBackup('automatic')
      } catch (error) {
        logger.warn('backup', 'automatic backup failed', error)
      }
    })()
  }, 30_000)
}

export function stopAutomaticBackups(): void {
  if (automaticBackupTimer) clearTimeout(automaticBackupTimer)
  automaticBackupTimer = null
}
