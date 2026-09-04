// Shared loader for agent-facing reference markdown.
//
// Guides live in <repo>/references and ship as extraResources, so the path
// differs between dev (app path) and packaged builds (process.resourcesPath).
// Resolve through candidate directories instead of __dirname — out/main sits
// inside app.asar when packaged, where references/ does not exist.

import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface WorkflowGuide {
  /** Tool-facing name passed to read_workflow_guide. */
  name: string
  /** File name under references/ or references/workflows/. */
  file: string
  title: string
}

/**
 * Every guide the chat agent can load. The routing table in
 * agent-system-prompt.ts and the tool's enum are derived from this list, so a
 * guide cannot be advertised without existing on disk (tests enforce both).
 */
export const WORKFLOW_GUIDES: readonly WorkflowGuide[] = [
  { name: 'post-crafting', file: 'workflows/post-crafting.md', title: 'Post crafting pipeline' },
  { name: 'reply-crafting', file: 'workflows/reply-crafting.md', title: 'Reply crafting' },
  { name: 'thread-writing', file: 'workflows/thread-writing.md', title: 'Thread writing' },
  { name: 'engagement-session', file: 'workflows/engagement-session.md', title: 'Engagement session' },
  { name: 'content-planner', file: 'workflows/content-planner.md', title: 'Content planner' },
  { name: 'strategy-chat', file: 'workflows/strategy-chat.md', title: 'Strategy chat' },
  { name: 'intelligence-update', file: 'workflows/intelligence-update.md', title: 'Intelligence update' },
  { name: 'competitor-analysis', file: 'workflows/competitor-analysis.md', title: 'Competitor analysis' },
  { name: 'trend-hunter', file: 'workflows/trend-hunter.md', title: 'Trend hunter' },
  { name: 'media-safety', file: 'media-safety.md', title: 'Media safety rules' },
  { name: 'voice-guide', file: 'voice-guide.md', title: 'Voice guide' },
]

const GUIDE_BY_NAME = new Map(WORKFLOW_GUIDES.map(guide => [guide.name, guide]))

/** Candidate roots, dev first. Mirrors getIconPath()'s candidates pattern. */
function referenceRoots(): string[] {
  const roots = [join(app.getAppPath(), 'references')]
  // process.resourcesPath is undefined under vitest/node runs.
  if (process.resourcesPath) roots.push(join(process.resourcesPath, 'references'))
  return roots
}

export function isKnownGuide(name: string): boolean {
  return GUIDE_BY_NAME.has(name)
}

/** Read one catalogued reference file; throws with a safe message when missing. */
export function readWorkflowGuide(name: string): string {
  const guide = GUIDE_BY_NAME.get(name)
  if (!guide) throw new Error(`Unknown workflow guide: ${name}`)

  for (const root of referenceRoots()) {
    const path = join(root, guide.file)
    if (existsSync(path)) return readFileSync(path, 'utf-8')
  }
  throw new Error(`Reference file for guide "${name}" was not found on disk.`)
}

/** Legacy image-generation guide ships beside the workflow guides. */
export function readImageGenerationGuide(): string {
  for (const root of referenceRoots()) {
    const path = join(root, 'image-generation.md')
    if (existsSync(path)) return readFileSync(path, 'utf-8')
  }
  throw new Error('image-generation.md was not found on disk.')
}
