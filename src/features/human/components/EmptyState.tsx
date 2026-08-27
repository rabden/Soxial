import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  body?: string
}

/** Friendly copy for empty Human surfaces. */
export function EmptyState({ icon: Icon, title, body }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <Icon className="size-10 stroke-1 text-zinc-700" />
      <h3 className="text-base font-semibold text-zinc-300">{title}</h3>
      {body && <p className="max-w-sm text-xs text-zinc-600">{body}</p>}
    </div>
  )
}
