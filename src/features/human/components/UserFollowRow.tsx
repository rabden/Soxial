import { useState } from 'react'
import { BadgeCheck, Loader2 } from 'lucide-react'
import { openExternalUrl } from 'src/lib/utils'
import type { HumanUser } from '../types'

interface UserFollowRowProps {
  user: HumanUser
  /** Relationship as loaded: everyone on the Following list is followed;
   *  follower relationships are unknown and start as Follow. */
  initialFollowing: boolean
  /** Rebuild lock — writes are blocked while a handle rebuild runs. */
  disabled?: boolean
}

/**
 * Person row with an optimistic Follow pill: click flips to Following
 * immediately; hover turns a Following pill into a red Unfollow; a failed
 * write rolls the pill back so the UI never lies about relationships.
 */
export function UserFollowRow({ user, initialFollowing, disabled = false }: UserFollowRowProps) {
  const [following, setFollowing] = useState(initialFollowing)
  const [pending, setPending] = useState(false)

  const toggle = async () => {
    if (pending || disabled) return
    const next = !following
    setFollowing(next) // optimistic flip
    setPending(true)
    try {
      const res = await window.api.humanFollowAction({
        handle: user.screenName,
        action: next ? 'follow' : 'unfollow',
      })
      if (!res.ok) setFollowing(!next) // rollback — never lie
    } catch {
      setFollowing(!next)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-start gap-3 border-b border-white/[0.06] px-4 py-3 transition-colors hover:bg-white/[0.02]">
      <button
        type="button"
        aria-label={`Open ${user.name}'s profile`}
        onClick={() => openExternalUrl(`https://x.com/${user.screenName}`)}
        className="size-10 shrink-0 overflow-hidden rounded-full bg-white/[0.06]"
      >
        {user.profileImageUrl ? (
          <img
            src={user.profileImageUrl}
            alt=""
            className="size-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
          />
        ) : null}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="truncate text-[15px] font-bold text-white">{user.name}</span>
          {user.verified && <BadgeCheck className="size-4 shrink-0 text-[#1d9bf0]" />}
        </div>
        <p className="text-sm text-zinc-500">@{user.screenName}</p>
        {user.bio && <p className="mt-0.5 line-clamp-2 text-sm text-zinc-400">{user.bio}</p>}
      </div>

      <button
        type="button"
        onClick={() => void toggle()}
        disabled={pending || disabled}
        aria-label={`${following ? 'Following' : 'Follow'} ${user.screenName}`}
        className={`group mt-1 inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-bold transition-colors ${
          following
            ? 'border border-white/[0.14] text-white hover:border-red-500/40 hover:bg-red-500/10'
            : 'bg-white text-black hover:bg-zinc-300'
        } ${pending || disabled ? 'cursor-default opacity-60' : ''}`}
      >
        {pending && <Loader2 className="size-3.5 animate-spin" />}
        {following ? (
          <>
            <span className="group-hover:hidden">Following</span>
            <span className="hidden text-red-400 group-hover:inline">Unfollow</span>
          </>
        ) : (
          'Follow'
        )}
      </button>
    </div>
  )
}
