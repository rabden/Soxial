# Database query and index ownership

The indexes in this document are created by the versioned migrations in
`electron/main/db-migrations.ts`. Query-plan assertions live in
`tests/db-indexes.test.ts`; update both files when a production query changes.

| Query shape | Index | Owner |
| --- | --- | --- |
| Chat messages for one session ordered by creation time and ID | `idx_chat_messages_session_created` | `getChatMessages` |
| Recent chat sessions | `idx_chat_sessions_updated` | `getChatSessions` |
| Scheduled posts filtered by status and time | `idx_scheduled_posts_status_time` | scheduled-post reads |
| Social content by author ordered by posting time | `idx_social_content_author_posted` | `getSocialContent` author filters |
| Social content by subreddit ordered by posting time | `idx_social_content_subreddit_posted` | `getSocialContent` subreddit filters |
| Model exhaustion for a model/key before availability | `idx_model_exhaustion_model_key_available` | `getAvailableApiKeyForModel` |
| Active API keys by provider and tier | `idx_api_keys_provider_tier_active` | model selection and exhaustion checks |

## Measurement procedure

Run the native Node smoke test before SQLite measurements:

```sh
npm run native:node
npm test
```

The index test uses `EXPLAIN QUERY PLAN` rather than wall-clock thresholds.
That keeps the regression check stable across machines while still failing if
SQLite falls back to a full scan for one of the user-visible query shapes.

When changing an index:

1. Add or update the query-plan assertion.
2. Run `PRAGMA integrity_check`.
3. Compare write-heavy workloads for chat-message streaming, social-content
   ingestion, and scheduled-post updates.
4. Add a new migration instead of modifying an applied migration.
