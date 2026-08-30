"use client";

import * as React from "react";
import { cn } from "src/lib/utils";
import {
  AlertCircle,
  AtSign,
  BadgeCheck,
  Bookmark,
  BookOpen,
  Brain,
  CalendarClock,
  ChevronDown,
  Command,
  CornerUpLeft,
  Crosshair,
  Database,
  FileSearch,
  FileText,
  Flame,
  Gauge,
  Globe,
  Heart,
  ImageIcon,
  Info,
  Layers,
  Lightbulb,
  List,
  MessageCircle,
  MessageSquare,
  Newspaper,
  Repeat2,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  SquarePen,
  SquareX,
  ThumbsUp,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  ToolDefinition,
  TraceNode,
  TraceNodeStatus,
} from "src/lib/agent-trace-types";
import { pillSecondaryText } from "src/lib/trace-text";
import { getToolLabel } from "src/lib/tool-labels";
import {
  isFailedResult,
  summarizeTrace,
  toolDetails,
} from "src/lib/tool-format";

/* ─────────────────────────────────────────────────────────
 * SAFE DYNAMIC ICON RENDERER
 * ───────────────────────────────────────────────────────── */
function renderDynamicIcon(
  icon: LucideIcon | undefined,
  className?: string
): React.ReactNode {
  if (!icon) return null;
  return React.createElement(icon, {
    className: cn("size-3.5 shrink-0", className),
    "aria-hidden": "true",
  });
}

/* ─────────────────────────────────────────────────────────
 * COMPACT 3x3 PIXEL DOT GRID LOADER
 * ───────────────────────────────────────────────────────── */
const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

export function PixelDotsLoader({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 grid-cols-[repeat(3,3px)] gap-[1.5px] items-center",
        className
      )}
    >
      {CHEVRON_DELAYS.map((delay, index) => (
        <span
          key={index}
          className="size-[3px] rounded-full bg-foreground/80 transition-opacity motion-reduce:animate-none"
          style={{
            opacity: 0.2,
            animation: `agent-pixel-on 650ms cubic-bezier(0.23, 1, 0.32, 1) ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────
 * SOXIAL TOOL REGISTRY
 * Consolidated from the per-page icon maps + human labels.
 * Node/registry types live in src/lib/agent-trace-types.
 * ───────────────────────────────────────────────────────── */
const TOOL_ICONS: Record<string, LucideIcon> = {
  connect_twitter: Sparkles,
  connect_reddit: Sparkles,
  twitter_search: Search,
  twitter_user: AtSign,
  twitter_user_posts: List,
  twitter_replies: CornerUpLeft,
  twitter_status: BadgeCheck,
  twitter_whoami: BadgeCheck,
  twitter_followers: Users,
  twitter_following: Users,
  twitter_likes: Heart,
  twitter_article: FileText,
  twitter_list: List,
  twitter_delete: RotateCcw,
  twitter_tweet: Globe,
  twitter_post: Send,
  twitter_reply: CornerUpLeft,
  twitter_quote: Send,
  twitter_feed: Newspaper,
  twitter_like: Heart,
  twitter_retweet: Repeat2,
  twitter_bookmark: Bookmark,
  twitter_bookmarks: Bookmark,
  twitter_follow: UserPlus,
  reddit_search: Search,
  reddit_sub: Layers,
  reddit_sub_info: Info,
  reddit_read: BookOpen,
  reddit_user: AtSign,
  reddit_user_posts: List,
  reddit_user_comments: MessageCircle,
  reddit_login: BadgeCheck,
  reddit_whoami: BadgeCheck,
  reddit_feed: Newspaper,
  reddit_popular: Flame,
  reddit_all: Globe,
  reddit_saved: Bookmark,
  reddit_upvoted: ThumbsUp,
  reddit_comment: Send,
  reddit_upvote: ThumbsUp,
  reddit_save: Bookmark,
  reddit_subscribe: UserPlus,
  read_profile: AtSign,
  read_hooks: Lightbulb,
  read_voice_rules: MessageCircle,
  read_pillars: Layers,
  read_algorithm: Gauge,
  read_targets: Crosshair,
  read_replies: CornerUpLeft,
  read_social_content: Database,
  read_memory: Database,
  save_hook: Lightbulb,
  save_voice_rule: ShieldCheck,
  save_pillar: Save,
  save_algorithm_rule: Gauge,
  save_target: Crosshair,
  save_reply: CornerUpLeft,
  save_memory: Database,
  update_soxial_profile: SquarePen,
  reset_strategy_defaults: RotateCcw,
  delete_voice_rules: RotateCcw,
  delete_hooks: RotateCcw,
  delete_pillars: RotateCcw,
  delete_targets: RotateCcw,
  delete_algorithm_rules: RotateCcw,
  save_milestone: TrendingUp,
  inspect_image_url: ImageIcon,
  generate_image: ImageIcon,
  schedule_post: CalendarClock,
  get_scheduled_posts: CalendarClock,
  read_workflow_guide: BookOpen,
  run_subagent: Users,
  get_subagent_output: FileSearch,
  cancel_subagent: SquareX,
  ask_user: MessageSquare,
};

export const SOXIAL_TOOL_REGISTRY: Record<string, ToolDefinition> =
  Object.fromEntries(
    Object.entries(TOOL_ICONS).map(([name, icon]) => [
      name,
      {
        name,
        icon,
        label: getToolLabel(name),
      } satisfies ToolDefinition,
    ])
  );

const MAX_SENTENCES = 40;

/* ─────────────────────────────────────────────────────────
 * NESTED REASONING BLOCK
 * Streams sentences live; stays collapsible when done.
 * ───────────────────────────────────────────────────────── */
interface NestedReasoningBlockProps {
  sentences: string[];
  isActive: boolean;
}

export function NestedReasoningBlock({
  sentences,
  isActive,
}: NestedReasoningBlockProps) {
  const [manualOpen, setManualOpen] = React.useState(false);
  const viewportRef = React.useRef<HTMLDivElement>(null);

  const shown = sentences.slice(0, MAX_SENTENCES);

  // Keep the newest sentence visible while streaming.
  React.useEffect(() => {
    if (!isActive) return;
    const el = viewportRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, isActive]);

  const expanded = isActive || manualOpen;

  return (
    <div
      className="flex w-full flex-col my-0.5"
      style={{ animation: "agent-fade 280ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      <button
        type="button"
        disabled={isActive}
        aria-expanded={expanded}
        onClick={() => !isActive && setManualOpen((v) => !v)}
        className={cn(
          "group/row relative flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left text-[12px] transition-colors duration-150",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          !isActive &&
            "hover:bg-muted/60 cursor-pointer active:scale-[0.98]"
        )}
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          <Brain
            aria-hidden="true"
            className={cn(
              "size-3.5 opacity-75 transition-opacity duration-150",
              !isActive && "group-hover/row:opacity-0",
              manualOpen && !isActive && "opacity-0"
            )}
          />
          {!isActive && (
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "absolute size-3.5 transition-transform duration-200 opacity-0",
                "group-hover/row:opacity-100",
                manualOpen ? "opacity-100 rotate-0" : "opacity-100 -rotate-90 group-hover/row:opacity-100"
              )}
            />
          )}
        </span>

        <span className="text-[12px] font-medium transition-colors">
          {isActive ? (
            <span
              className="bg-clip-text text-transparent font-medium"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, var(--color-muted-foreground, oklch(0.55 0 0)) 35%, var(--color-foreground, oklch(0.95 0 0)) 50%, var(--color-muted-foreground, oklch(0.55 0 0)) 65%)",
                backgroundSize: "200% 100%",
                animation: "agent-shimmer 1.8s linear infinite",
              }}
            >
              Thinking…
            </span>
          ) : (
            <span className="text-foreground">Thought</span>
          )}
        </span>
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300",
          expanded
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0 pointer-events-none"
        )}
        style={{ transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-1 mb-1.5 ml-2.5 border-l border-border/70 py-0.5 pl-2.5">
            <div
              ref={viewportRef}
              className="max-h-48 overflow-y-auto scrollbar-none pr-1"
            >
              <div className="flex flex-col gap-2">
                {shown.map((line, i) => (
                  <p
                    key={i}
                    className="m-0 text-[13px] font-[425] leading-[23px] tracking-tight text-muted-foreground text-pretty"
                    style={{
                      animation:
                        "agent-fade 250ms cubic-bezier(0.23,1,0.32,1) both",
                    }}
                  >
                    {line}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * PILL ROW (tool call)
 * ───────────────────────────────────────────────────────── */
interface TracePillRowProps {
  node: TraceNode;
  isActive: boolean;
  registry: Record<string, ToolDefinition>;
}

function TracePillRow({ node, isActive, registry }: TracePillRowProps) {
  const [open, setOpen] = React.useState(false);

  const toolDef = node.toolName ? registry[node.toolName] : undefined;
  // Expanded body: a custom renderer (e.g. image attachment previews) when
  // present, otherwise compacted args/result rows — never the raw payloads.
  const details = React.useMemo(
    () => (node.renderContent ? [] : toolDetails(node.toolName ?? "", node.args, node.result)),
    [node.renderContent, node.toolName, node.args, node.result]
  );
  const hasDetails = Boolean(node.renderContent) || details.length > 0;

  const primaryText =
    node.primary ||
    (node.type === "tool"
      ? toolDef?.label || (node.toolName ? getToolLabel(node.toolName) : "Working")
      : node.toolName || node.type);

  // Once the call completes the chip shows a result summary ("q" → 12 posts)
  // instead of the raw args; failures surface the short error instead.
  const done = !isActive && (node.status === "completed" || node.status === "failed");

  const secondaryText = pillSecondaryText({ node, toolDef, done });

  const isFailed =
    node.status === "failed" || (!isActive && isFailedResult(node.result));

  const renderIcon = () => {
    if (isActive) {
      return (
        <span
          aria-hidden="true"
          className="size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-foreground"
        />
      );
    }
    if (isFailed) {
      return (
        <AlertCircle
          className="size-3.5 text-rose-500 shrink-0"
          aria-hidden="true"
        />
      );
    }
    if (node.icon) return renderDynamicIcon(node.icon, node.iconClassName);
    if (toolDef?.icon)
      return renderDynamicIcon(toolDef.icon, toolDef.iconClassName);
    return (
      <Command
        className="size-3.5 text-muted-foreground/80 shrink-0"
        aria-hidden="true"
      />
    );
  };

  return (
    <div
      className="flex flex-col my-0.5"
      style={{ animation: "agent-fade 280ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      <button
        type="button"
        disabled={!hasDetails}
        aria-expanded={open}
        onClick={() => hasDetails && setOpen((v) => !v)}
        className={cn(
          "group/row relative flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left text-[12px] transition-colors duration-150",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          hasDetails
            ? "hover:bg-muted/60 cursor-pointer active:scale-[0.98]"
            : "cursor-default"
        )}
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          <span
            className={cn(
              "transition-opacity duration-150 flex items-center justify-center",
              hasDetails && "group-hover/row:opacity-0",
              open && "opacity-0"
            )}
          >
            {renderIcon()}
          </span>
          {hasDetails && (
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "absolute size-3.5 transition-transform duration-200",
                open ? "opacity-100 rotate-0" : "-rotate-90 opacity-0 group-hover/row:opacity-100"
              )}
            />
          )}
        </span>

        <span className="shrink-0 text-[12px] font-medium text-foreground tracking-tight">
          {primaryText}
        </span>

        {secondaryText && (
          <span
            className={cn(
              "inline-flex h-5 min-w-0 max-w-[65%] items-center truncate rounded-md px-1.5 text-[11px] border transition-colors group-hover/row:border-border/80 group-hover/row:text-foreground",
              isFailed
                ? "bg-rose-500/5 text-rose-500 border-rose-500/30"
                : "bg-muted/80 text-muted-foreground border-border/40",
              (node.mono ?? toolDef?.monoChip) ? "font-mono" : "font-sans"
            )}
          >
            <span className="truncate">{secondaryText}</span>
          </span>
        )}
      </button>

      {hasDetails && (
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-300",
            open
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0 pointer-events-none"
          )}
          style={{ transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="mt-1 mb-1.5 ml-2.5 flex flex-col gap-1 border-l border-border/70 py-0.5 pl-2.5">
              {node.renderContent
                ? node.renderContent()
                : details.map((row, i) => (
                    <div
                      key={i}
                      className="flex min-w-0 items-baseline gap-2 text-[11.5px] leading-[18px]"
                    >
                      <span className="w-24 shrink-0 text-muted-foreground/60">
                        {row.label}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 break-words",
                          row.tone === "error" ? "text-rose-500" : "text-foreground/80"
                        )}
                      >
                        {row.value}
                      </span>
                    </div>
                  ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
 * AGENT TRACE
 * Collapsible timeline of an agent's thinking + tool calls.
 * Expanded while `working`, collapses to a duration summary
 * when work finishes; the reader can re-expand at any time.
 * ───────────────────────────────────────────────────────── */
export interface AgentTraceProps extends React.HTMLAttributes<HTMLDivElement> {
  nodes: TraceNode[];
  working?: boolean;
  /**
   * True once the agent moved past this trace (e.g. prose started) or the
   * whole turn finished — collapses the trace even while the parent is
   * still streaming.
   */
  settled?: boolean;
  workingLabel?: string;
  defaultExpanded?: boolean;
  registry?: Record<string, ToolDefinition>;
}

export function AgentTrace({
  nodes,
  working = false,
  settled = false,
  workingLabel = "Working...",
  defaultExpanded = false,
  registry = SOXIAL_TOOL_REGISTRY,
  className,
  ...props
}: AgentTraceProps) {
  const [manualExpanded, setManualExpanded] = React.useState<boolean | null>(null);
  const active = working && !settled;

  const expanded =
    manualExpanded !== null ? manualExpanded : active || defaultExpanded;

  const traceSummary = React.useMemo(() => summarizeTrace(nodes), [nodes]);

  return (
    <div
      className={cn(
        "flex w-full flex-col font-sans select-none text-foreground",
        className
      )}
      {...props}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() =>
          setManualExpanded((prev) => !(prev !== null ? prev : active || defaultExpanded))
        }
        className={cn(
          "group/tracehead flex w-fit items-center gap-1.5 p-0 bg-transparent text-left transition-colors duration-150 cursor-pointer",
          "text-muted-foreground/75 hover:text-foreground font-normal text-[13.5px] leading-relaxed",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-xs"
        )}
      >
        {active && <PixelDotsLoader />}

        <span className="text-[13.5px] font-normal transition-colors">
          {active ? (
            <span
              className="bg-clip-text text-transparent font-medium"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, var(--color-muted-foreground, oklch(0.55 0 0)) 35%, var(--color-foreground, oklch(0.95 0 0)) 50%, var(--color-muted-foreground, oklch(0.55 0 0)) 65%)",
                backgroundSize: "200% 100%",
                animation: "agent-shimmer 1.5s linear infinite",
              }}
            >
              {workingLabel}
            </span>
          ) : (
            <span>
              {traceSummary.phrases.length > 0
                ? traceSummary.phrases.join(" · ")
                : "Worked"}
            </span>
          )}
        </span>

        {!active && traceSummary.failedCount > 0 && (
          <span className="text-[12px] text-rose-500/90">
            · {traceSummary.failedCount} failed
          </span>
        )}

        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-3 opacity-30 transition-transform duration-300 group-hover/tracehead:opacity-80",
            expanded ? "rotate-180" : "rotate-0"
          )}
        />
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
          expanded
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0 pointer-events-none"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-1 ml-2 border-l border-border/60 py-0.5 pl-2 flex flex-col gap-0.5">
            {nodes.map((node, idx) => {
              const isNodeActive = active && idx === nodes.length - 1;
              if (node.type === "reasoning") {
                return (
                  <NestedReasoningBlock
                    key={node.id ?? idx}
                    sentences={node.sentences ?? []}
                    isActive={isNodeActive}
                  />
                );
              }
              return (
                <TracePillRow
                  key={node.id ?? idx}
                  node={node}
                  isActive={isNodeActive}
                  registry={registry}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
