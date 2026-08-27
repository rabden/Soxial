import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Loader2, MessageSquare, User } from "lucide-react";
import type { AppError } from "src/types/app-error";
import { TweetCard, parseTweetData } from "src/components/ui/tweet-card";
import { OperationalError } from "src/components/ui/operational-error";
import { usePaginatedList } from "../hooks/usePaginatedList";
import { AuthGate } from "./AuthGate";
import { EmptyState } from "./EmptyState";
import { ProfileHeader } from "./ProfileHeader";
import type {
  HumanProfileSubTab,
  HumanTweet,
  HumanUser,
  Paginated,
} from "../types";

const springTransition = {
  type: "spring" as const,
  stiffness: 450,
  damping: 38,
};

const SUB_TABS: Array<{ id: HumanProfileSubTab; label: string }> = [
  { id: "posts", label: "Posts" },
  { id: "replies", label: "Replies" },
];

/** Windowed pagination: the next page asks for items older than the oldest seen. */
function deriveOldestDate(page: Paginated<HumanTweet>): string | undefined {
  const oldest = page.items[page.items.length - 1];
  const iso =
    oldest?.createdAtISO ?? oldest?.createdAtLocal ?? oldest?.createdAt;
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString().slice(0, 10);
}

/** Authenticated user's profile: flat header + Posts/Replies nested tabs. */
export default function HumanProfile({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const [subTab, setSubTab] = useState<HumanProfileSubTab>("posts");
  const [profile, setProfile] = useState<HumanUser | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<AppError | null>(null);
  const [rechecking, setRechecking] = useState(false);

  const reloadProfile = useCallback(() => {
    setProfileLoading(true);
    setProfileError(null);
    window.api
      .humanProfile()
      .then((res) => {
        if (res.ok) setProfile(res.data);
        else setProfileError(res.error);
      })
      .catch(() =>
        setProfileError({
          code: "HUMAN_PROFILE_FAILED",
          category: "network",
          message: "The profile could not be loaded. Retry.",
          retryable: true,
          action: "retry",
        }),
      )
      .finally(() => setProfileLoading(false));
  }, []);

  useEffect(() => {
    reloadProfile();
  }, [reloadProfile]);

  const posts = usePaginatedList<HumanTweet>({
    resetKey: subTab,
    fetchPage: (until) =>
      window.api.humanProfilePosts({ subTab, count: 10, until }),
    getItemId: (tweet) => tweet.id,
    deriveNextCursor: deriveOldestDate,
  });

  const recheck = useCallback(async () => {
    setRechecking(true);
    try {
      const session = await window.api.humanVerifySession();
      if (session.ok && session.data.authenticated) {
        reloadProfile();
        posts.reload();
      }
    } finally {
      setRechecking(false);
    }
  }, [reloadProfile, posts.reload]);

  const authError = profileError?.category === "auth";
  const isEmpty = !posts.loading && !posts.error && posts.items.length === 0;

  return (
    <div className="h-full overflow-y-auto scrollbar-none">
      <div className="mx-auto max-w-[600px] border-x border-white/[0.06]">
        {profileLoading && (
          <div
            className="space-y-4 p-4"
            aria-busy="true"
            aria-label="Loading profile"
          >
            <div className="size-[112px] animate-pulse rounded-full bg-white/[0.06]" />
            <div className="h-4 w-48 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-3 w-32 animate-pulse rounded bg-white/[0.04]" />
          </div>
        )}

        {!profileLoading && authError && (
          <AuthGate
            title="Log in to x.com to see your profile"
            onRecheck={recheck}
            checking={rechecking}
          />
        )}

        {!profileLoading && !authError && (
          <>
            {profileError && (
              <div className="p-4">
                <OperationalError
                  error={profileError}
                  onRetry={reloadProfile}
                />
              </div>
            )}

            {!profileError && profile && <ProfileHeader user={profile} />}

            {/* Posts / Replies nested tabs */}
            <div
              className="sticky top-0 z-20 flex border-b border-white/[0.06] bg-black/80 backdrop-blur-md"
              inert={disabled || undefined}
            >
              {SUB_TABS.map((tab) => {
                const active = subTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSubTab(tab.id)}
                    className={`relative flex-1 py-3 text-sm font-medium transition-colors hover:text-white ${
                      active ? "text-white" : "text-zinc-500"
                    } ${disabled ? "opacity-40 pointer-events-none" : ""}`}
                  >
                    {tab.label}
                    {active && (
                      <motion.span
                        layoutId="profileSubToggleIndicator"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1d9bf0]"
                        transition={springTransition}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {posts.loading && (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-zinc-500">
                <Loader2 className="size-3.5 animate-spin" /> Loading…
              </div>
            )}

            {!posts.loading &&
              posts.error &&
              posts.error.category === "auth" && (
                <AuthGate
                  title="Log in to x.com to see your posts"
                  onRecheck={recheck}
                  checking={rechecking}
                />
              )}

            {!posts.loading &&
              posts.error &&
              posts.error.category !== "auth" && (
                <div className="p-4">
                  <OperationalError
                    error={posts.error}
                    onRetry={posts.reload}
                  />
                </div>
              )}

            {isEmpty && (
              <EmptyState
                icon={subTab === "replies" ? MessageSquare : User}
                title={subTab === "replies" ? "No replies yet" : "No posts yet"}
                body={
                  subTab === "replies"
                    ? "Replies you post on X will show up here."
                    : "Posts you create on X will show up here."
                }
              />
            )}

            {posts.items.map((tweet) => (
              <TweetCard
                key={tweet.id}
                variant="feed"
                {...parseTweetData(tweet)}
              />
            ))}

            {posts.moreError && (
              <div className="p-4">
                <OperationalError
                  error={posts.moreError}
                  onRetry={posts.loadMore}
                />
              </div>
            )}

            {posts.loadingMore && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-zinc-500">
                <Loader2 className="size-3.5 animate-spin" /> Loading…
              </div>
            )}

            {posts.hasMore && posts.items.length > 0 && !posts.moreError && (
              <div
                ref={posts.sentinelRef}
                className="h-px w-full"
                aria-hidden="true"
              />
            )}

            {!posts.hasMore && posts.items.length > 0 && (
              <div className="py-6 text-center text-xs text-zinc-600">
                You&rsquo;re all caught up
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
