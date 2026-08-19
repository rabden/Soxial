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
