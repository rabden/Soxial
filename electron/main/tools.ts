import { z } from 'zod'
import { getDb, getProfile, queryAll, insertRow, updateProfile, getSocialContent, countSocialContent } from './db'
import { runCli, runTwitterCli, ensureRdtAuth, ensureTwitterAuth } from './cli'
import { logger } from './log'
import {
  fetchTwitterUserPosts,
  fetchTwitterReplies,
  fetchRedditUserPosts,
  fetchRedditUserComments,
  fetchRedditWhoami,
  persistSocialToolResult,
  MAX_SOCIAL_ITEMS,
  getSinceDate,
  compactTwitterForModel,
  compactRedditForModel,
} from './social-content'

export function createTools(opts?: {
  defaultMax?: number
  platforms?: { twitter?: boolean; reddit?: boolean }
}) {
  const defaultMax = opts?.defaultMax ?? MAX_SOCIAL_ITEMS
  const twitterEnabled = opts?.platforms?.twitter !== false
  const redditEnabled = opts?.platforms?.reddit !== false

  const platformEnum = twitterEnabled && redditEnabled
    ? z.enum(['twitter', 'reddit'])
    : twitterEnabled
    ? z.enum(['twitter'])
    : redditEnabled
    ? z.enum(['reddit'])
    : z.enum(['twitter', 'reddit'])

  const sharedTools: Record<string, any> = {

    read_profile: {
      description: 'Read the user profile: identity, niche, goals, voice, brand colors, API keys, platform handles.',
      parameters: z.object({}),
      execute: async () => {
        const p = getProfile()
        if (!p) return { error: 'Profile not set up yet. Run onboarding first.' }
        const { zai_api_key, gemini_api_key, openai_api_key, ...safe } = p
        return safe
      }
    },

    update_soxial_profile: {
      description: 'Update the user profile with strategy and voice data. Use for setting brand colors, voice, goals, growth strategy, etc. NOTE: User identity fields (name, handles, timezone) are owned by the user and cannot be changed here.',
      parameters: z.object({
        data: z.object({
          niche: z.string().optional(),
          specialization: z.string().optional(),
          superpower: z.string().optional(),
          primary_goal: z.string().optional(),
          target_audience: z.string().optional(),
          voice_description: z.string().optional(),
          avoid_words: z.string().optional(),
          brand_primary_color: z.string().optional(),
          brand_secondary_color: z.string().optional(),
          brand_accent_color: z.string().optional(),
          style_preset: z.string().optional(),
          growth_strategy: z.string().optional(),
          branding_strategy: z.string().optional(),
          tools_stack: z.string().optional(),
          monetization_goals: z.string().optional(),
          growth_target: z.string().optional(),
          portfolio_status: z.string().optional(),
          tone_balance: z.string().optional(),
        }).describe('Strategy and voice profile fields to update')
      }),
      execute: async ({ data }) => {
        const { name, twitter_handle, reddit_username, timezone, onboarding_complete, ...allowed } = (data || {}) as any
        updateProfile(allowed)
        return { success: true, message: 'Profile updated' }
      }
    },

    read_hooks: {
      description: 'Read the hook library — proven post opening frameworks ranked by performance. Use before crafting any post.',
      parameters: z.object({
        category: z.enum(['showcase', 'community', 'all']).optional().describe('Filter by category'),
        limit: z.number().optional().describe('Max hooks to return')
      }),
      execute: async ({ category, limit }) => {
        let sql = 'SELECT * FROM hooks'
        const params: any[] = []
        if (category && category !== 'all') {
          sql += ' WHERE category = ?'
          params.push(category)
        }
        sql += ' ORDER BY rank ASC'
        if (limit) sql += ` LIMIT ${limit}`
        return getDb().prepare(sql).all(...params)
      }
    },

    read_voice_rules: {
      description: 'Read voice anti-patterns — banned phrases, banned structures, and required natural elements. MUST read before writing any reply.',
      parameters: z.object({
        type: z.enum(['banned_phrase', 'banned_structure', 'natural_element', 'all']).optional()
      }),
      execute: async ({ type }) => {
        if (!type || type === 'all') return queryAll('voice_rules')
        return queryAll('voice_rules', 'type = ?', [type])
      }
    },

    read_replies: {
      description: 'Read curated voice snippets saved via save_reply during onboarding/strategy — selected examples for voice matching. For the full auto-saved post/reply archive, use read_social_content.',
      parameters: z.object({
        platform: z.string().optional().describe('Filter by platform (twitter/reddit)'),
        category: z.string().optional()
      }),
      execute: async ({ platform, category }) => {
        let sql = 'SELECT * FROM replies WHERE 1=1'
        const params: any[] = []
        if (platform) { sql += ' AND platform = ?'; params.push(platform) }
        if (category) { sql += ' AND category = ?'; params.push(category) }
        return getDb().prepare(sql).all(...params)
      }
    },

    read_social_content: {
      description: `Read auto-saved posts/replies/comments from the social_content archive (up to ${MAX_SOCIAL_ITEMS} per type, 2-month lookback). Populated automatically during onboarding and whenever twitter_user_posts, twitter_replies, reddit_user_posts, or reddit_user_comments run.`,
      parameters: z.object({
        platform: z.enum(['twitter', 'reddit']).optional(),
        content_type: z.enum(['post', 'reply', 'comment']).optional(),
        author_handle: z.string().optional(),
        subreddit: z.string().optional(),
        limit: z.number().optional().describe('Max rows (default 50, max 200)'),
        include_raw: z.boolean().optional().describe('Include the full raw payload per item (large)'),
        summary_only: z.boolean().optional().describe('Return counts by platform/type instead of rows'),
      }),
      execute: async ({ summary_only, ...opts }) => {
        if (summary_only) return countSocialContent({ platform: opts.platform, content_type: opts.content_type })
        return getSocialContent(opts)
      }
    },

    save_reply: {
      description: 'Save replies/comments to the archive. Pass ALL items in a single call.',
      parameters: z.object({
        items: z.array(z.object({
          platform: z.string(),
          category: z.string(),
          text: z.string()
        })).describe('Array of replies to save')
      }),
      execute: async ({ items }) => {
        for (const { platform, category, text } of items)
          insertRow('replies', { platform, category, text })
        return { success: true, count: items.length }
      }
    },

    read_algorithm: {
      description: 'Read platform algorithm rules — how each platform ranks content. Use for strategy decisions.',
      parameters: z.object({
        platform: z.enum(['twitter', 'reddit', 'instagram', 'facebook', 'all']).optional()
      }),
      execute: async ({ platform }) => {
        if (!platform || platform === 'all') return queryAll('algorithm_rules')
        return queryAll('algorithm_rules', 'platform = ?', [platform])
      }
    },

    read_memory: {
      description: 'Read memory entries — post performance, engagement patterns, lessons learned, competitor watchlist, audience intelligence.',
      parameters: z.object({
        type: z.enum(['performance', 'engagement', 'lesson', 'competitor', 'audience', 'milestone', 'all']).optional(),
        platform: z.string().optional(),
        limit: z.number().optional()
      }),
      execute: async ({ type, platform, limit }) => {
        let sql = 'SELECT * FROM memory_entries WHERE 1=1'
        const params: any[] = []
        if (type && type !== 'all') { sql += ' AND type = ?'; params.push(type) }
        if (platform) { sql += ' AND platform = ?'; params.push(platform) }
        sql += ' ORDER BY created_at DESC'
        if (limit) sql += ` LIMIT ${limit}`
        return getDb().prepare(sql).all(...params)
      }
    },

    save_memory: {
      description: 'Save memory entries. Pass ALL items in a single call.',
      parameters: z.object({
        items: z.array(z.object({
          type: z.string().describe('performance/engagement/lesson/competitor/audience/milestone'),
          platform: z.string().optional(),
          title: z.string(),
          content: z.string(),
          data_json: z.string().optional()
        })).describe('Array of memory entries to save')
      }),
      execute: async ({ items }) => {
        const db = getDb()
        let saved = 0
        const save = db.transaction(() => {
          for (const m of items) {
            const exists = db.prepare('SELECT id FROM memory_entries WHERE type = ? AND title = ? AND content = ?')
              .get(m.type, m.title, m.content)
            if (exists) continue
            insertRow('memory_entries', m)
            saved++
          }
        })
        save()
        return { success: true, saved, skipped: items.length - saved, total: items.length }
      }
    },

    read_pillars: {
      description: 'Read content pillars — the 4 content types the user should rotate through.',
      parameters: z.object({}),
      execute: async () => queryAll('content_pillars')
    },

    read_targets: {
      description: 'Read target accounts/subreddits for engagement.',
      parameters: z.object({
        platform: z.string().optional(),
        tier: z.string().optional()
      }),
      execute: async ({ platform, tier }) => {
        let sql = 'SELECT * FROM target_accounts WHERE 1=1'
        const params: any[] = []
        if (platform) { sql += ' AND platform = ?'; params.push(platform) }
        if (tier) { sql += ' AND tier = ?'; params.push(tier) }
        return getDb().prepare(sql).all(...params)
      }
    },

    save_pillar: {
      description: 'Save or update content pillars. Pass ALL pillars in a single call. Upserts by name.',
      parameters: z.object({
        items: z.array(z.object({
          name: z.string(),
          description: z.string(),
          structure: z.string().optional(),
          frequency: z.string().optional(),
          platform_adaptations: z.string().optional()
        })).describe('Array of pillars to save')
      }),
      execute: async ({ items }) => {
        let saved = 0, updated = 0
        const db = getDb()
        const save = db.transaction(() => {
          for (const p of items) {
            const existing = db.prepare('SELECT id FROM content_pillars WHERE name = ?').get(p.name) as any
            if (existing) {
              db.prepare(`UPDATE content_pillars SET description=@description, structure=@structure,
                frequency=@frequency, platform_adaptations=@platform_adaptations WHERE id=@id`)
                .run({ ...p, id: existing.id })
              updated++
            } else {
              insertRow('content_pillars', p)
              saved++
            }
          }
        })
        save()
        return { success: true, saved, updated, total: items.length }
      }
    },

    save_target: {
      description: 'Save target accounts/subreddits. Pass ALL targets in a single call. Deduplicates.',
      parameters: z.object({
        items: z.array(z.object({
          platform: z.enum(['twitter', 'reddit']),
          handle: z.string().describe('Twitter handle or subreddit name'),
          tier: z.string().optional().describe('tier1 = high-follower niche creators, tier2 = target audience peers'),
          why: z.string().optional(),
          strategy: z.string().optional()
        })).describe('Array of targets to save')
      }),
      execute: async ({ items }) => {
        let saved = 0, skipped = 0
        const db = getDb()
        const save = db.transaction(() => {
          for (const t of items) {
            const exists = db.prepare('SELECT id FROM target_accounts WHERE platform = ? AND handle = ?').get(t.platform, t.handle)
            if (exists) { skipped++; continue }
            insertRow('target_accounts', t)
            saved++
          }
        })
        save()
        return { success: true, saved, skipped, total: items.length }
      }
    },

    save_voice_rule: {
      description: 'Save voice anti-patterns/natural elements. Pass ALL rules in a single call. Deduplicates.',
      parameters: z.object({
        items: z.array(z.object({
          type: z.enum(['banned_phrase', 'banned_structure', 'natural_element']),
          content: z.string()
        })).describe('Array of voice rules to save')
      }),
      execute: async ({ items }) => {
        let saved = 0, skipped = 0
        const db = getDb()
        const save = db.transaction(() => {
          for (const v of items) {
            const exists = db.prepare('SELECT id FROM voice_rules WHERE type = ? AND content = ?').get(v.type, v.content)
            if (exists) { skipped++; continue }
            insertRow('voice_rules', v)
            saved++
          }
        })
        save()
        return { success: true, saved, skipped, total: items.length }
      }
    },

    save_hook: {
      description: 'Save or update hooks in the hook library. Pass ALL hooks in a single call. Upserts by name.',
      parameters: z.object({
        items: z.array(z.object({
          rank: z.number(),
          category: z.enum(['showcase', 'community']),
          name: z.string(),
          description: z.string(),
          why_it_works: z.string().optional(),
          template: z.string().optional(),
          niche_examples: z.string().optional(),
          performance_notes: z.string().optional()
        })).describe('Array of hooks to save')
      }),
      execute: async ({ items }) => {
        let saved = 0, updated = 0
        const db = getDb()
        const save = db.transaction(() => {
          for (const h of items) {
            const existing = db.prepare('SELECT id FROM hooks WHERE name = ?').get(h.name) as any
            if (existing) {
              db.prepare(`UPDATE hooks SET rank=@rank, category=@category, description=@description,
                why_it_works=@why_it_works, template=@template, niche_examples=@niche_examples,
                performance_notes=@performance_notes WHERE id=@id`)
                .run({ ...h, why_it_works: h.why_it_works || null, template: h.template || null,
                       niche_examples: h.niche_examples || null, performance_notes: h.performance_notes || null,
                       id: existing.id })
              updated++
            } else {
              insertRow('hooks', h)
              saved++
            }
          }
        })
        save()
        return { success: true, saved, updated, total: items.length }
      }
    },

    save_algorithm_rule: {
      description: 'Save platform algorithm rules. Pass ALL rules in a single call. Upserts by platform+signal.',
      parameters: z.object({
        items: z.array(z.object({
          platform: z.enum(['twitter', 'reddit']),
          signal: z.string(),
          weight: z.string(),
          description: z.string()
        })).describe('Array of algorithm rules to save')
      }),
      execute: async ({ items }) => {
        let saved = 0, updated = 0
        const db = getDb()
        const save = db.transaction(() => {
          for (const a of items) {
            const existing = db.prepare('SELECT id FROM algorithm_rules WHERE platform = ? AND signal = ?').get(a.platform, a.signal) as any
            if (existing) {
              db.prepare('UPDATE algorithm_rules SET weight = ?, description = ? WHERE id = ?').run(a.weight, a.description, existing.id)
              updated++
            } else {
              insertRow('algorithm_rules', a)
              saved++
            }
          }
        })
        save()
        return { success: true, saved, updated, total: items.length }
      }
    },

    delete_voice_rules: {
      description: 'Delete voice rules that don\'t fit the user. Try by content match first; pass ids as fallback if content match fails.',
      parameters: z.object({
        by_content: z.array(z.string()).optional().describe('Delete rules whose content matches these strings (exact match)'),
        by_ids: z.array(z.number()).optional().describe('Fallback: delete by row IDs'),
      }),
      execute: async ({ by_content, by_ids }) => {
        const db = getDb()
        let deleted = 0
        if (by_content?.length) {
          for (const c of by_content) {
            const r = db.prepare('DELETE FROM voice_rules WHERE content = ?').run(c)
            deleted += r.changes
          }
        }
        if (by_ids?.length) {
          for (const id of by_ids) {
            const r = db.prepare('DELETE FROM voice_rules WHERE id = ?').run(id)
            deleted += r.changes
          }
        }
        return { success: true, deleted }
      }
    },

    delete_hooks: {
      description: 'Delete hooks that don\'t fit the user\'s niche. Try by name first; pass ids as fallback.',
      parameters: z.object({
        by_name: z.array(z.string()).optional().describe('Delete hooks whose name matches (exact match)'),
        by_ids: z.array(z.number()).optional().describe('Fallback: delete by row IDs'),
      }),
      execute: async ({ by_name, by_ids }) => {
        const db = getDb()
        let deleted = 0
        if (by_name?.length) {
          for (const n of by_name) {
            const r = db.prepare('DELETE FROM hooks WHERE name = ?').run(n)
            deleted += r.changes
          }
        }
        if (by_ids?.length) {
          for (const id of by_ids) {
            const r = db.prepare('DELETE FROM hooks WHERE id = ?').run(id)
            deleted += r.changes
          }
        }
        return { success: true, deleted }
      }
    },

    delete_pillars: {
      description: 'Delete content pillars that don\'t fit the user. Try by name first; pass ids as fallback.',
      parameters: z.object({
        by_name: z.array(z.string()).optional().describe('Delete pillars whose name matches (exact match)'),
        by_ids: z.array(z.number()).optional().describe('Fallback: delete by row IDs'),
      }),
      execute: async ({ by_name, by_ids }) => {
        const db = getDb()
        let deleted = 0
        if (by_name?.length) {
          for (const n of by_name) {
            const r = db.prepare('DELETE FROM content_pillars WHERE name = ?').run(n)
            deleted += r.changes
          }
        }
        if (by_ids?.length) {
          for (const id of by_ids) {
            const r = db.prepare('DELETE FROM content_pillars WHERE id = ?').run(id)
            deleted += r.changes
          }
        }
        return { success: true, deleted }
      }
    },

    delete_targets: {
      description: 'Delete target accounts/subreddits. Try by platform+handle first; pass ids as fallback.',
      parameters: z.object({
        by_handle: z.array(z.object({
          platform: z.enum(['twitter', 'reddit']),
          handle: z.string()
        })).optional().describe('Delete by platform + handle match'),
        by_ids: z.array(z.number()).optional().describe('Fallback: delete by row IDs'),
      }),
      execute: async ({ by_handle, by_ids }) => {
        const db = getDb()
        let deleted = 0
        if (by_handle?.length) {
          for (const { platform, handle } of by_handle) {
            const r = db.prepare('DELETE FROM target_accounts WHERE platform = ? AND handle = ?').run(platform, handle)
            deleted += r.changes
          }
        }
        if (by_ids?.length) {
          for (const id of by_ids) {
            const r = db.prepare('DELETE FROM target_accounts WHERE id = ?').run(id)
            deleted += r.changes
          }
        }
        return { success: true, deleted }
      }
    },

    delete_algorithm_rules: {
      description: 'Delete algorithm rules. Try by platform+signal first; pass ids as fallback.',
      parameters: z.object({
        by_signal: z.array(z.object({
          platform: z.enum(['twitter', 'reddit']),
          signal: z.string()
        })).optional().describe('Delete by platform + signal match'),
        by_ids: z.array(z.number()).optional().describe('Fallback: delete by row IDs'),
      }),
      execute: async ({ by_signal, by_ids }) => {
        const db = getDb()
        let deleted = 0
        if (by_signal?.length) {
          for (const { platform, signal } of by_signal) {
            const r = db.prepare('DELETE FROM algorithm_rules WHERE platform = ? AND signal = ?').run(platform, signal)
            deleted += r.changes
          }
        }
        if (by_ids?.length) {
          for (const id of by_ids) {
            const r = db.prepare('DELETE FROM algorithm_rules WHERE id = ?').run(id)
            deleted += r.changes
          }
        }
        return { success: true, deleted }
      }
    },

    save_milestone: {
      description: 'Record a growth milestone — follower count, karma, or any metric snapshot. Use during onboarding to capture baselines.',
      parameters: z.object({
        items: z.array(z.object({
          platform: z.enum(['twitter', 'reddit']),
          metric: z.string().describe('e.g. followers, following, karma, comment_karma, link_karma, posts_count'),
          value: z.string().describe('The metric value as string'),
          note: z.string().optional().describe('Context note')
        })).describe('Array of milestones to record')
      }),
      execute: async ({ items }) => {
        for (const m of items)
          insertRow('growth_milestones', m)
        return { success: true, count: items.length }
      }
    },

    schedule_post: {
      description: 'Schedule a post for later. Stores it in the queue with platform, text, and time.',
      parameters: z.object({
        platform: platformEnum,
        type: z.string().describe('Post type from content pillars'),
        text: z.string().describe('Full post text'),
        media_path: z.string().optional(),
        hashtags: z.string().optional(),
        first_reply: z.string().optional(),
        scheduled_time: z.string().describe('ISO datetime string')
      }),
      execute: async (data) => {
        const id = insertRow('scheduled_posts', { ...data, status: 'scheduled' })
        return { success: true, id, message: `Post scheduled for ${data.scheduled_time}` }
      }
    },

    get_scheduled_posts: {
      description: 'Get scheduled/draft posts from the queue.',
      parameters: z.object({
        status: z.enum(['draft', 'scheduled', 'posted', 'skipped', 'all']).optional()
      }),
      execute: async ({ status }) => {
        if (!status || status === 'all') return queryAll('scheduled_posts', undefined, undefined)
        return queryAll('scheduled_posts', 'status = ?', [status])
      }
    },

    read_image_guide: {
      description: 'Read the complete image generation guide — platform specs, 5-part prompting framework, brand style integration, examples, common mistakes, and quality checklist. Call this BEFORE generate_image to get full context for crafting the best prompt.',
      parameters: z.object({}),
      execute: async () => {
        const { readFileSync } = await import('fs')
        const { join } = await import('path')
        const guidePath = join(__dirname, '../../references/image-generation.md')
        const content = readFileSync(guidePath, 'utf-8')
        return { guide: content }
      }
    },

    inspect_image_url: {
      description: 'Fetch an image from a direct URL, convert it to base64, and return it as a file part so the model can visually inspect the image content. Use this before replying to posts where the text depends on an attached image.',
      parameters: z.object({
        url: z.string().url().describe('Direct image URL to inspect'),
      }),
      execute: async ({ url }) => {
        const parsed = new URL(url)
        if (!/^https?:$/.test(parsed.protocol)) {
          return { error: 'Only http(s) image URLs are supported.' }
        }

        const needsXReferer =
          parsed.hostname.includes('twitter') ||
          parsed.hostname.includes('x.com') ||
          parsed.hostname.includes('twimg')
        const headers: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        }
        if (needsXReferer) {
          headers.Referer = 'https://x.com/'
          headers.Origin = 'https://x.com'
        }

        const response = await fetch(url, { headers })

        if (!response.ok) {
          return { error: `Failed to fetch image (${response.status} ${response.statusText})`, sourceUrl: url }
        }

        const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || ''
        if (!mimeType.startsWith('image/')) {
          return { error: `URL did not return an image content-type (${mimeType || 'unknown'})`, sourceUrl: url }
        }

        const maxBytes = 12 * 1024 * 1024
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.byteLength > maxBytes) {
          return { error: `Image is too large to inspect (${buffer.byteLength} bytes > ${maxBytes} bytes)`, sourceUrl: url, mimeType }
        }

        return {
          sourceUrl: url,
          mimeType,
          byteLength: buffer.byteLength,
          data: buffer.toString('base64'),
        }
      },
      toModelOutput: async ({ output }: { output: any }) => {
        if (!output || output.error || !output.data) {
          return { type: 'content' as const, value: [{ type: 'text' as const, text: JSON.stringify(output) }] }
        }
        return {
          type: 'content' as const,
          value: [
            { type: 'text' as const, text: `Image from ${output.sourceUrl} (${output.mimeType}, ${output.byteLength} bytes):` },
            { type: 'file' as const, mediaType: output.mimeType, data: { type: 'data' as const, data: output.data } },
          ],
        }
      },
    },

    generate_image: {
      description: 'Generate an image with Google AI Studio Gemini image generation by default, falling back to Puter.js if Gemini fails. Call read_image_guide first for the full prompting guide, then call read_profile for brand colors before building prompt. Use the 5-part prompting framework.',
      parameters: z.object({
        prompt: z.string().describe('Full image prompt. Include text for quotes, labels, headlines, hook cards, or branding when needed. Specify font style, color, size, and placement. End with constraints: "No watermarks, no logos, no AI artifacts."'),
        filename: z.string().describe('Output filename with .png extension, e.g. twitter_hook_2026-06-23.png'),
        model: z.enum(['gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-2']).optional().describe('Fallback Puter.js image model if Gemini image generation fails.')
      }),
      execute: async ({ prompt, filename }) => {
        let safeFilename = filename && filename.trim() ? filename.trim() : `generated_${Date.now()}.png`
        if (!safeFilename.endsWith('.png')) safeFilename += '.png'
        try {
          const { generateImage } = await import('./puter')
          const path = await generateImage(prompt, safeFilename)
          return { success: true, path, filename: safeFilename, message: `Image saved to ${path}` }
        } catch (e: any) {
          return { error: e.message }
        }
      }
    }
  }

  const twitterTools: Record<string, any> = {
    twitter_status: {
      description: 'Check Twitter/X authentication status. Verifies your X session.',
      parameters: z.object({}),
      execute: async () => ensureTwitterAuth()
    },

    twitter_whoami: {
      description: 'Show the authenticated user profile (followers, bio, tweet count). Requires login.',
      parameters: z.object({}),
      execute: async () => {
        await ensureTwitterAuth()
        return runCli('twitter', ['whoami', '--json'])
      }
    },

    twitter_search: {
      description: 'Search X/Twitter for posts. Returns JSON with content and engagement metrics.',
      parameters: z.object({
        query: z.string().optional().describe('Search keywords (optional when using --from filters)'),
        type: z.enum(['top', 'latest', 'photos', 'videos']).optional(),
        from: z.string().optional().describe('Filter to posts from a specific user'),
        to: z.string().optional().describe('Filter to posts directed at a user'),
        lang: z.string().optional().describe('Language ISO code, e.g. en'),
        since: z.string().optional().describe('Tweets since date YYYY-MM-DD'),
        until: z.string().optional().describe('Tweets until date YYYY-MM-DD'),
        exclude: z.enum(['retweets', 'replies', 'links']).optional(),
        filter: z.boolean().optional().describe('Enable score-based ranking filter'),
        max: z.number().optional().describe('Max results (default 20)')
      }),
      execute: async ({ query, type, from, to, lang, since, until, exclude, filter, max }) => {
        logger.info('tools', `twitter_search: "${query || from || ''}"`)
        const args: string[] = ['search']
        if (query?.trim()) args.push(query.trim())
        args.push('--json')
        if (type) args.push('--type', type)
        if (from) args.push('--from', from)
        if (to) args.push('--to', to)
        if (lang) args.push('--lang', lang)
        if (since) args.push('--since', since)
        if (until) args.push('--until', until)
        if (exclude) args.push('--exclude', exclude)
        if (filter) args.push('--filter')
        args.push('-n', String(max || defaultMax))
        return compactTwitterForModel(await runTwitterCli(args, { compact: false }))
      }
    },

    twitter_user: {
      description: 'Fetch an X/Twitter user profile (followers, following, bio, etc.).',
      parameters: z.object({ handle: z.string() }),
      execute: async ({ handle }) => runCli('twitter', ['user', handle, '--json'])
    },

    twitter_user_posts: {
      description: `Fetch recent posts from an X/Twitter user with engagement metrics. Returns up to ${MAX_SOCIAL_ITEMS} posts covering at least ${2} months when available.`,
      parameters: z.object({
        handle: z.string(),
        max: z.number().optional().describe(`Max results (default ${MAX_SOCIAL_ITEMS}, capped at ${MAX_SOCIAL_ITEMS})`)
      }),
      execute: async ({ handle, max }) => {
        const limit = max || defaultMax
        const raw = limit < MAX_SOCIAL_ITEMS
          ? await runTwitterCli(['user-posts', handle, '--max', String(limit), '--json'], { compact: false })
          : await fetchTwitterUserPosts(handle)
        const persist = persistSocialToolResult('twitter_user_posts', { handle }, raw)
        return { ...compactTwitterForModel(raw), _persist: persist }
      }
    },

    twitter_replies: {
      description: `Fetch recent replies from an X/Twitter user. Returns up to ${MAX_SOCIAL_ITEMS} replies covering at least ${2} months when available.`,
      parameters: z.object({
        handle: z.string(),
        max: z.number().optional().describe(`Max results (default ${MAX_SOCIAL_ITEMS})`)
      }),
      execute: async ({ handle, max }) => {
        const since = getSinceDate()
        const limit = max || defaultMax
        const raw = limit < MAX_SOCIAL_ITEMS
          ? await runTwitterCli(['search', `from:${handle} filter:replies`, '--since', since, '-n', String(limit), '--json'], { compact: false })
          : await fetchTwitterReplies(handle)
        const persist = persistSocialToolResult('twitter_replies', { handle }, raw)
        return { ...compactTwitterForModel(raw), _persist: persist }
      }
    },

    twitter_followers: {
      description: 'List followers of a Twitter/X user.',
      parameters: z.object({
        handle: z.string(),
        max: z.number().optional()
      }),
      execute: async ({ handle, max }) => {
        const args = ['followers', handle, '--json']
        args.push('-n', String(max || defaultMax))
        return runTwitterCli(args)
      }
    },

    twitter_following: {
      description: 'List accounts a Twitter/X user is following.',
      parameters: z.object({
        handle: z.string(),
        max: z.number().optional()
      }),
      execute: async ({ handle, max }) => {
        const args = ['following', handle, '--json']
        args.push('-n', String(max || defaultMax))
        return runTwitterCli(args)
      }
    },

    twitter_likes: {
      description: 'Show tweets liked by a user. NOTE: only works for the authenticated user (likes are private since 2024).',
      parameters: z.object({
        handle: z.string().optional().describe('Defaults to authenticated user'),
        max: z.number().optional(),
        filter: z.boolean().optional()
      }),
      execute: async ({ handle, max, filter }) => {
        const auth = await ensureTwitterAuth()
        if (!auth.ok) return auth
        const screenName = handle || auth.data?.user?.username || auth.data?.user?.screenName
        if (!screenName) return { ok: false, data: null, error: 'Could not determine authenticated user handle for likes' }
        const args = ['likes', screenName, '--json']
        if (filter) args.push('--filter')
        args.push('-n', String(max || defaultMax))
        return compactTwitterForModel(await runTwitterCli(args, { compact: false }))
      }
    },

    twitter_post: {
      description: 'Post a tweet. REQUIRES user approval first. Validates character count <=280.',
      parameters: z.object({
        text: z.string().max(280).optional().describe('Tweet text, max 280 chars'),
        content: z.string().max(280).optional().describe('Tweet text (alias for text)'),
        image_path: z.string().optional().describe('Path to image file to attach'),
        image_paths: z.array(z.string()).optional().describe('Up to 4 image paths'),
        reply_to: z.string().optional().describe('Tweet ID to reply to (alternative to twitter_reply)')
      }),
      execute: async (args) => {
        const text = args.text || args.content || ''
        if (!text) return { error: 'text (or content) is required' }
        if (text.length > 280) return { error: 'Text exceeds 280 characters' }
        await ensureTwitterAuth()
        const argsArr = ['post', text, '--json']
        const images = args.image_paths?.length ? args.image_paths : (args.image_path ? [args.image_path] : [])
        for (const img of images.slice(0, 4)) argsArr.push('-i', img)
        if (args.reply_to) argsArr.push('--reply-to', args.reply_to)
        return runCli('twitter', argsArr)
      }
    },

    twitter_reply: {
      description: 'Reply to a tweet. REQUIRES user approval first.',
      parameters: z.object({
        tweet_id: z.string().optional(),
        text: z.string().max(280).optional(),
        originalId: z.string().optional().describe('Tweet ID to reply to (alias for tweet_id)'),
        reply: z.string().max(280).optional().describe('Reply text (alias for text)'),
        image_path: z.string().optional()
      }),
      execute: async (args) => {
        const tweet_id = args.tweet_id || args.originalId
        const text = args.text || args.reply
        if (!tweet_id || !text) return { error: 'tweet_id (or originalId) and text (or reply) are required' }
        await ensureTwitterAuth()
        const argsArr = ['reply', tweet_id, text, '--json']
        if (args.image_path) argsArr.push('-i', args.image_path)
        return runCli('twitter', argsArr)
      }
    },

    twitter_feed: {
      description: 'Fetch the X/Twitter home feed for scanning engagement opportunities.',
      parameters: z.object({
        max: z.number().optional(),
        type: z.enum(['for-you', 'following']).optional().describe('for-you (algorithmic) or following (chronological)'),
        filter: z.boolean().optional().describe('Enable score-based ranking filter')
      }),
      execute: async ({ max, type, filter }) => {
        await ensureTwitterAuth()
        const args = ['feed', '--json']
        if (type) args.push('-t', type)
        if (filter) args.push('--filter')
        args.push('-n', String(max || defaultMax))
        return compactTwitterForModel(await runTwitterCli(args, { compact: false }))
      }
    },

    twitter_tweet: {
      description: 'View a single tweet and its replies by tweet ID. Use to understand full context before drafting a reply.',
      parameters: z.object({
        tweet_id: z.string().describe('Tweet ID or full URL'),
        max_replies: z.number().optional()
      }),
      execute: async ({ tweet_id, max_replies }) => {
        const args = ['tweet', tweet_id, '--json']
        if (max_replies) args.push('-n', String(max_replies))
        return runCli('twitter', args)
      }
    },

    twitter_article: {
      description: 'Fetch a Twitter/X Article (long-form post) by tweet ID or URL.',
      parameters: z.object({
        tweet_id: z.string(),
        as_markdown: z.boolean().optional().describe('Return article as markdown')
      }),
      execute: async ({ tweet_id, as_markdown }) => {
        const args = ['article', tweet_id, '--json']
        if (as_markdown) args.push('--markdown')
        return runCli('twitter', args)
      }
    },

    twitter_list: {
      description: 'Fetch tweets from a Twitter/X List by list ID.',
      parameters: z.object({
        list_id: z.string(),
        max: z.number().optional(),
        filter: z.boolean().optional()
      }),
      execute: async ({ list_id, max, filter }) => {
        const args = ['list', list_id, '--json']
        if (filter) args.push('--filter')
        args.push('-n', String(max || defaultMax))
        return compactTwitterForModel(await runTwitterCli(args, { compact: false }))
      }
    },

    twitter_like: {
      description: 'Like or unlike a tweet. REQUIRES user approval.',
      parameters: z.object({
        tweet_id: z.string(),
        action: z.enum(['like', 'unlike']).optional().describe('Default: like')
      }),
      execute: async ({ tweet_id, action }) => {
        await ensureTwitterAuth()
        const cmd = action === 'unlike' ? 'unlike' : 'like'
        return runCli('twitter', [cmd, tweet_id, '--json'])
      }
    },

    twitter_retweet: {
      description: 'Retweet or unretweet a tweet. REQUIRES user approval.',
      parameters: z.object({
        tweet_id: z.string(),
        action: z.enum(['retweet', 'unretweet']).optional().describe('Default: retweet')
      }),
      execute: async ({ tweet_id, action }) => {
        await ensureTwitterAuth()
        const cmd = action === 'unretweet' ? 'unretweet' : 'retweet'
        return runCli('twitter', [cmd, tweet_id, '--json'])
      }
    },

    twitter_delete: {
      description: 'Delete your own tweet. REQUIRES user approval.',
      parameters: z.object({
        tweet_id: z.string()
      }),
      execute: async ({ tweet_id }) => {
        await ensureTwitterAuth()
        return runCli('twitter', ['delete', tweet_id, '--yes', '--json'])
      }
    },

    twitter_bookmark: {
      description: 'Bookmark or list bookmarks. Bookmark saves a tweet for later reference.',
      parameters: z.object({
        action: z.enum(['save', 'remove', 'list']).describe('save = bookmark a tweet, remove = unbookmark, list = show all bookmarks'),
        tweet_id: z.string().optional().describe('Required for save/remove'),
        max: z.number().optional().describe('Max results for list (default 20)'),
        filter: z.boolean().optional()
      }),
      execute: async ({ action, tweet_id, max, filter }) => {
        await ensureTwitterAuth()
        if (action === 'list') {
          const args = ['bookmarks', '--json']
          if (filter) args.push('--filter')
          args.push('-n', String(max || defaultMax))
          return compactTwitterForModel(await runTwitterCli(args, { compact: false }))
        }
        if (!tweet_id) return { error: 'tweet_id required for save/remove' }
        const cmd = action === 'remove' ? 'unbookmark' : 'bookmark'
        return runCli('twitter', [cmd, tweet_id, '--json'])
      }
    },

    twitter_quote: {
      description: 'Quote tweet (retweet with commentary). REQUIRES user approval. Max 280 chars.',
      parameters: z.object({
        tweet_id: z.string().describe('Original tweet ID to quote'),
        text: z.string().max(280).describe('Quote text, max 280 chars'),
        image_path: z.string().optional().describe('Path to image to attach')
      }),
      execute: async ({ tweet_id, text, image_path }) => {
        if (text.length > 280) return { error: 'Text exceeds 280 characters' }
        await ensureTwitterAuth()
        const args = ['quote', tweet_id, text, '--json']
        if (image_path) args.push('-i', image_path)
        return runCli('twitter', args)
      }
    },

    twitter_follow: {
      description: 'Follow or unfollow a user. REQUIRES user approval.',
      parameters: z.object({
        handle: z.string(),
        action: z.enum(['follow', 'unfollow']).optional().describe('Default: follow')
      }),
      execute: async ({ handle, action }) => {
        await ensureTwitterAuth()
        const cmd = action === 'unfollow' ? 'unfollow' : 'follow'
        return runCli('twitter', [cmd, handle, '--json'])
      }
    }
  }

  const redditTools: Record<string, any> = {
    reddit_search: {
      description: 'Search Reddit for posts. Use subreddit parameter to browse specific subreddits (e.g., subreddit: "frontend"). Query can be empty when using subreddit parameter to browse all posts in that subreddit.',
      parameters: z.object({
        query: z.string().optional().describe('Search keywords (can be empty when using subreddit parameter)'),
        subreddit: z.string().optional().describe('Restrict search to a specific subreddit (e.g., "frontend", "webdev")'),
        sort: z.enum(['relevance', 'hot', 'top', 'new', 'comments']).optional(),
        time: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional().describe('Time filter for top/controversial sorts'),
        max: z.number().optional()
      }),
      execute: async ({ query, subreddit, sort, time, max }) => {
        const args = ['search', (query || ''), '--json']
        if (subreddit) args.push('-r', subreddit)
        if (sort) args.push('-s', sort)
        if (time) args.push('-t', time)
        args.push('-n', String(max || defaultMax))
        return compactRedditForModel(await runCli('rdt', args))
      }
    },

    reddit_sub: {
      description: 'Browse a subreddit for posts. Requires subreddit parameter (e.g., "frontend", "webdev").',
      parameters: z.object({
        subreddit: z.string().describe('Subreddit name without r/ prefix (e.g., "frontend", "webdev")'),
        sort: z.enum(['hot', 'new', 'top', 'rising', 'controversial', 'best']).optional(),
        time: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional().describe('Time filter for top/controversial'),
        max: z.number().optional()
      }),
      execute: async ({ subreddit, sort, time, max }) => {
        if (!subreddit || !subreddit.trim()) {
          return { ok: false, data: null, error: 'subreddit parameter is required (e.g., "frontend", "webdev")' }
        }
        
        const args = ['sub', subreddit, '--json']
        if (sort) args.push('-s', sort)
        if (time) args.push('-t', time)
        args.push('-n', String(max || defaultMax))
        return compactRedditForModel(await runCli('rdt', args))
      }
    },

    reddit_read: {
      description: 'Read a Reddit post and its comments.',
      parameters: z.object({
        post_id: z.string(),
        max_comments: z.number().optional(),
        sort: z.enum(['best', 'top', 'new', 'controversial', 'old', 'qa']).optional(),
        expand_more: z.boolean().optional().describe('Expand additional "more comments" entries')
      }),
      execute: async ({ post_id, max_comments, sort, expand_more }) => {
        const args = ['read', post_id, '--json']
        if (max_comments) args.push('-n', String(max_comments))
        if (sort) args.push('-s', sort)
        if (expand_more) args.push('--expand-more')
        return runCli('rdt', args)
      }
    },

    reddit_user_posts: {
      description: `Fetch recent posts from a Reddit user. Returns up to ${MAX_SOCIAL_ITEMS} posts covering at least ${2} months when available.`,
      parameters: z.object({
        username: z.string(),
        max: z.number().optional()
      }),
      execute: async ({ username, max }) => {
        const limit = max || defaultMax
        const raw = limit < MAX_SOCIAL_ITEMS
          ? await runCli('rdt', ['user-posts', username, '--json', '-n', String(limit)])
          : await fetchRedditUserPosts(username)
        const persist = persistSocialToolResult('reddit_user_posts', { username }, raw)
        return { ...compactRedditForModel(raw), _persist: persist }
      }
    },

    reddit_user_comments: {
      description: `Fetch recent comments from a Reddit user. Returns up to ${MAX_SOCIAL_ITEMS} comments covering at least ${2} months when available.`,
      parameters: z.object({
        username: z.string(),
        max: z.number().optional()
      }),
      execute: async ({ username, max }) => {
        const limit = max || defaultMax
        const raw = limit < MAX_SOCIAL_ITEMS
          ? await runCli('rdt', ['user-comments', username, '--json', '-n', String(limit)])
          : await fetchRedditUserComments(username)
        const persist = persistSocialToolResult('reddit_user_comments', { username }, raw)
        return { ...compactRedditForModel(raw), _persist: persist }
      }
    },

    reddit_login: {
      description: 'Verify or refresh the Reddit connection. Run when whoami/status fails or before write actions.',
      parameters: z.object({}),
      execute: async () => ensureRdtAuth()
    },

    reddit_whoami: {
      description: 'Check Reddit authentication status and karma. Uses session when logged in; otherwise falls back to public profile data.',
      parameters: z.object({}),
      execute: async () => {
        const profile = getProfile()
        return fetchRedditWhoami(profile?.reddit_username)
      }
    },

    reddit_feed: {
      description: 'Browse Reddit home feed (requires login).',
      parameters: z.object({
        max: z.number().optional(),
        subs_only: z.boolean().optional().describe('Subscriptions-only feed, no algorithm'),
        max_subs: z.number().optional().describe('Max subscriptions to fetch when subs_only is true')
      }),
      execute: async ({ max, subs_only, max_subs }) => {
        await ensureRdtAuth()
        const args = ['feed', '--json']
        if (subs_only) args.push('--subs-only')
        if (max_subs) args.push('--max-subs', String(max_subs))
        args.push('-n', String(max || defaultMax))
        return compactRedditForModel(await runCli('rdt', args))
      }
    },

    reddit_comment: {
      description: 'Comment on a Reddit post. REQUIRES user approval. Has built-in rate-limit delay (1.5-4s).',
      parameters: z.object({
        post_id: z.string().optional().describe('Post ID to comment on'),
        text: z.string().optional().describe('Comment text (markdown supported)'),
        postId: z.string().optional().describe('Post ID (alias for post_id)'),
        reply: z.string().optional().describe('Comment text (alias for text)')
      }),
      execute: async (args) => {
        const post_id = args.post_id || args.postId
        const text = args.text || args.reply
        if (!post_id || !text) return { error: 'post_id (or postId) and text (or reply) are required' }
        await ensureRdtAuth()
        return runCli('rdt', ['comment', post_id, text])
      }
    },

    reddit_upvote: {
      description: 'Upvote, downvote, or remove vote on a Reddit post. REQUIRES user approval.',
      parameters: z.object({
        post_id: z.string(),
        action: z.enum(['upvote', 'downvote', 'undo']).describe('undo = remove vote')
      }),
      execute: async ({ post_id, action }) => {
        await ensureRdtAuth()
        const args = ['upvote', post_id]
        if (action === 'downvote') args.push('--down')
        else if (action === 'undo') args.push('--undo')
        return runCli('rdt', args)
      }
    },

    reddit_save: {
      description: 'Save or unsave a Reddit post for later reference.',
      parameters: z.object({
        post_id: z.string(),
        action: z.enum(['save', 'remove']).optional().describe('Default: save')
      }),
      execute: async ({ post_id, action }) => {
        await ensureRdtAuth()
        const args = ['save', post_id]
        if (action === 'remove') args.push('--undo')
        return runCli('rdt', args)
      }
    },

    reddit_subscribe: {
      description: 'Subscribe or unsubscribe from a subreddit. REQUIRES user approval.',
      parameters: z.object({
        subreddit: z.string(),
        action: z.enum(['subscribe', 'unsubscribe']).optional().describe('Default: subscribe')
      }),
      execute: async ({ subreddit, action }) => {
        await ensureRdtAuth()
        const args = ['subscribe', subreddit]
        if (action === 'unsubscribe') args.push('--undo')
        return runCli('rdt', args)
      }
    },

    reddit_sub_info: {
      description: 'Get subreddit info — subscribers, description, rules. Use before engagement strategy decisions.',
      parameters: z.object({
        subreddit: z.string()
      }),
      execute: async ({ subreddit }) => runCli('rdt', ['sub-info', subreddit, '--json'])
    },

    reddit_popular: {
      description: 'Browse Reddit popular feed — trending posts across all subreddits.',
      parameters: z.object({ max: z.number().optional() }),
      execute: async ({ max }) => {
        const args = ['popular', '--json', '-n', String(max || defaultMax)]
        return compactRedditForModel(await runCli('rdt', args))
      }
    },

    reddit_all: {
      description: 'Browse /r/all — posts from across Reddit.',
      parameters: z.object({ max: z.number().optional() }),
      execute: async ({ max }) => {
        const args = ['all', '--json', '-n', String(max || defaultMax)]
        return compactRedditForModel(await runCli('rdt', args))
      }
    },

    reddit_saved: {
      description: 'Browse your saved Reddit posts (requires login).',
      parameters: z.object({ max: z.number().optional() }),
      execute: async ({ max }) => {
        await ensureRdtAuth()
        const args = ['saved', '--json', '-n', String(max || defaultMax)]
        return compactRedditForModel(await runCli('rdt', args))
      }
    },

    reddit_upvoted: {
      description: 'Browse posts you have upvoted (requires login).',
      parameters: z.object({ max: z.number().optional() }),
      execute: async ({ max }) => {
        await ensureRdtAuth()
        const args = ['upvoted', '--json', '-n', String(max || defaultMax)]
        return compactRedditForModel(await runCli('rdt', args))
      }
    },

    reddit_user: {
      description: 'View a Reddit user profile overview — karma, account age, trophy case.',
      parameters: z.object({
        username: z.string()
      }),
      execute: async ({ username }) => runCli('rdt', ['user', username, '--json'])
    }
  }

  return {
    ...sharedTools,
    ...(twitterEnabled ? twitterTools : {}),
    ...(redditEnabled ? redditTools : {})
  }
}
