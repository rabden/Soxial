# Soxial Backup, Restore, and Export

## Two different artifacts

Soxial uses two formats for two different jobs:

- **SQLite backup**: a restorable snapshot of the complete local database. It is
  stored under the Electron `userData/backups` directory and should be treated
  as sensitive local data.
- **Portable export**: an inspectable `.zip` archive or `.json` file intended
  for moving user-owned content between environments. Credentials and the
  credential vault are intentionally excluded.

## SQLite backups

Each backup has a `.db` file and a sidecar `.meta.json` file. Metadata includes:

- backup format and version
- app version
- SQLite schema version
- creation time and reason
- byte size
- SHA-256 checksum
- successful SQLite `PRAGMA integrity_check`

Backups are created with `better-sqlite3`'s online backup API. The source
database can remain in WAL mode; the destination is written to a temporary
file, verified, checksummed, and atomically renamed into the backup directory.
Interrupted writes therefore do not appear as valid backup files.

Automatic backups are scheduled shortly after application startup when the app
is idle. At most one automatic backup is created per 24-hour period. A backup
is also created before a destructive profile rebuild and before a restore.

Retention keeps the newest backup, recent daily snapshots, recent weekly
snapshots, and stays within count and size limits. The newest verified backup
is never pruned.

## Restore procedure

1. Stop active generation or onboarding work.
2. Verify the selected backup's metadata, checksum, and SQLite integrity.
3. Create a verified `pre-restore` snapshot of the current database.
4. Close the active SQLite connection and atomically replace the database.
5. Reopen the database and run pending migrations.
6. Remove the rollback snapshot only after reopening succeeds.
7. If any step fails, restore the pre-restore snapshot and reopen it.

The UI reloads after a successful restore so stale in-memory profile and chat
state cannot overwrite restored data.

## Portable export format

The ZIP archive contains:

```text
manifest.json
data.json
media/              # only when safe local media was selected and fits limits
```

`data.json` contains a versioned manifest and user-owned tables:

- profile fields that are not credentials
- strategy and memory tables
- chat sessions and messages
- scheduled posts
- milestones and social content

The export excludes `api_keys`, `schema_migrations`, `onboarding_strategy_drafts`,
`onboarding_enrichment_jobs`, the credential vault, and secret-bearing profile
fields. Drafts and enrichment jobs are run-local working state, not user-owned
content; SQLite backups continue to include them. Secret-like strings in user content are
redacted as an additional defense. Media is included only when its resolved
path stays under the app's media directory, the individual file is at most
25 MiB, and the total included media is at most 100 MiB. Otherwise the content
remains in the export without the unsafe or oversized file.

Selecting JSON produces a single inspectable file. Selecting ZIP produces the
archive above and is the preferred format when media or a larger dataset is
needed.

## Disaster recovery

For local recovery, copy the entire `backups` directory before reinstalling
Soxial. Restore only backups that show as verified in the app. A backup that
fails checksum or integrity validation must not be manually renamed or opened
as the active database; retain it for forensic review and use an earlier
verified snapshot.

