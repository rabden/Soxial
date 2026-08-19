import { useState, useEffect } from 'react'
import { ArrowLeft, CalendarClock, Send, Trash2 } from 'lucide-react'
import { TweetCard } from 'src/components/ui/tweet-card'
import { RedditPostCard } from 'src/components/ui/reddit-post-card'

interface ScheduledPost {
  id: number
  platform: string
  type: string | null
  text: string | null
  media_path: string | null
  hashtags: string | null
  first_reply: string | null
  scheduled_time: string | null
  status: string
  result_json: string | null
  created_at: string
}

function formatScheduled(time: string | null): string {
  if (!time) return 'Not scheduled'
  const d = new Date(time.replace(' ', 'T') + (time.endsWith('Z') ? '' : 'Z'))
  if (isNaN(d.getTime())) return time
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function parseRedditContent(text: string): { title: string; selftext: string } {
  const lines = text.split('\n')
  if (lines.length <= 1) return { title: text, selftext: '' }
  return { title: lines[0], selftext: lines.slice(1).join('\n') }
}

export default function ScheduledPosts({ profile, onBack }: { profile: any; onBack: () => void }) {
  const [posts, setPosts] = useState<ScheduledPost[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  useEffect(() => {
    window.api.getScheduledPosts().then((data: any) => {
      setPosts(data || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleDelete = async (id: number) => {
    if (confirmId !== id) {
      setConfirmId(id)
      return
    }
    if (deletingId === id) return

    setDeletingId(id)
    try {
      await window.api.deleteScheduledPost(id)
      setPosts(prev => prev.filter(p => p.id !== id))
    } catch (err) {
      console.error('Failed to delete scheduled post:', err)
    } finally {
      setConfirmId(null)
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-sm text-muted-foreground/60">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-8 py-12">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground/60 hover:text-foreground transition-colors mb-8">
          <ArrowLeft className="size-4" /> Back
        </button>

        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Scheduled posts</h1>
          <p className="text-sm text-muted-foreground/60 mt-1">
            {posts.length === 0 ? 'No posts scheduled yet.' : `${posts.length} post${posts.length !== 1 ? 's' : ''} scheduled`}
          </p>
        </div>

        {posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <CalendarClock className="size-10 text-muted-foreground/60 mb-3" />
            <h2 className="text-base font-medium text-muted-foreground">Nothing scheduled</h2>
            <p className="text-sm text-muted-foreground/60 mt-1">Ask the AI to draft and schedule posts in chat.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {posts.map(post => {
              const isTwitter = post.platform === 'twitter'
              const text = post.text || ''
              const scheduledLabel = formatScheduled(post.scheduled_time)

              return (
                <div key={post.id} className="relative p-4 rounded-2xl bg-zinc-900/40 border border-white/[0.06] hover:border-white/10 transition-colors space-y-3">
                  {/* Post meta bar */}
                  <div className="flex items-center justify-between pb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                        isTwitter ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20' : 'bg-orange-500/15 text-orange-400 border border-orange-500/20'
                      }`}>
                        {isTwitter ? 'X' : 'Reddit'}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                        <CalendarClock className="size-3.5 text-zinc-500" />
                        {scheduledLabel}
                      </span>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md uppercase tracking-wider ${
                        post.status === 'scheduled' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {post.status}
                      </span>
                    </div>
                    {confirmId === post.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleDelete(post.id)}
                          disabled={deletingId === post.id}
                          className="flex items-center gap-1 text-xs font-semibold text-white px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 transition-all cursor-pointer shadow-sm"
                          title="Confirm deletion"
                        >
                          <span>{deletingId === post.id ? 'Deleting...' : 'Confirm'}</span>
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          disabled={deletingId === post.id}
                          className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleDelete(post.id)}
                        className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-all cursor-pointer"
                        title="Remove scheduled post"
                      >
                        <Trash2 className="size-3.5" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>

                  {/* Post preview card */}
                  {isTwitter ? (
                    <TweetCard
                      preview
                      content={text}
                      authorName={profile?.name}
                      authorHandle={profile?.twitter_handle}
                      timestamp={scheduledLabel}
                    />
                  ) : (
                    <RedditPostCard
                      preview
                      author={profile?.reddit_username}
                      {...parseRedditContent(text)}
                    />
                  )}

                  {/* Hashtags */}
                  {post.hashtags && (
                    <div className="text-xs text-blue-400/90 font-mono px-1">{post.hashtags}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
