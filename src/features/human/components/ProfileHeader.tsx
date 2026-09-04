import { BadgeCheck, CalendarDays, Link2, MapPin } from 'lucide-react'
import type { HumanUser } from '../types'

function formatCount(value: number | undefined): string {
  if (typeof value !== 'number') return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
  return String(value)
}

function joinDate(user: HumanUser): string | null {
  const iso = user.createdAtISO ?? user.createdAt
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/**
 * Flat profile header (no banner — the connector exposes none). Avatar, name,
 * handle, bio, location/website/join metadata and normalized counts.
 */
export function ProfileHeader({ user }: { user: HumanUser }) {
  const joined = joinDate(user)
  return (
    <div className="px-4 pb-3 pt-5">
      <div className="size-[112px] overflow-hidden rounded-full border-2 border-black bg-white/[0.06]">
        {user.profileImageUrl ? (
          <img
            src={user.profileImageUrl}
            alt={user.name}
            className="size-full object-cover"
            // Avatars 404 while the session is cold — degrade to the empty circle.
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
          />
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <h2 className="text-xl font-bold leading-tight text-white">{user.name}</h2>
        {user.verified && <BadgeCheck className="size-5 shrink-0 text-[#1d9bf0]" />}
      </div>
      <p className="text-sm text-zinc-500">@{user.screenName}</p>

      {user.bio && <p className="mt-3 whitespace-pre-wrap text-[15px] leading-normal text-zinc-200">{user.bio}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500">
        {user.location && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-4" /> {user.location}
          </span>
        )}
        {user.url && (
          <a
            href={user.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[#1d9bf0] hover:underline"
          >
            <Link2 className="size-4" /> {user.url.replace(/^https?:\/\/(www\.)?/, '')}
          </a>
        )}
        {joined && (
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-4" /> Joined {joined}
          </span>
        )}
      </div>

      <div className="mt-3 flex gap-4 text-sm">
        <span>
          <span className="font-bold text-white">{formatCount(user.following)}</span>{' '}
          <span className="text-zinc-500">Following</span>
        </span>
        <span>
          <span className="font-bold text-white">{formatCount(user.followers)}</span>{' '}
          <span className="text-zinc-500">Followers</span>
        </span>
        <span>
          <span className="font-bold text-white">{formatCount(user.tweets)}</span>{' '}
          <span className="text-zinc-500">Posts</span>
        </span>
      </div>
    </div>
  )
}
