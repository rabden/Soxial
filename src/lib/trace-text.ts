// Pure text helpers for agent-trace pills — no react imports, so trace
// grouping and tests can use them without pulling in the component.
import { toolArgsChip, toolCompletedChip } from "./tool-format";
import type { ToolDefinition, TraceNode } from "./agent-trace-types";

export function toSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const byPunctuation = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byPunctuation.length > 1) return byPunctuation;
  const byLine = trimmed
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (byLine.length > 1) return byLine;
  return byPunctuation.length > 0 ? byPunctuation : [trimmed];
}

/**
 * Secondary pill text for a tool node, mirroring the live pill chain exactly:
 * explicit secondary → completed result chip → registry-gated args chip.
 * The args-chip fallback requires a registry entry, so unregistered tools
 * keep rendering no running chip.
 */
export function pillSecondaryText({
  node,
  toolDef,
  done,
}: {
  node: TraceNode;
  toolDef?: ToolDefinition;
  /** True once the call settled (not the active tail of a working trace). */
  done: boolean;
}): string | undefined {
  const completedText =
    done && node.toolName ? toolCompletedChip(node.toolName, node.args, node.result) : undefined;

  return (
    node.secondary ||
    completedText ||
    (toolDef && node.toolName ? toolArgsChip(node.toolName, node.args) : undefined)
  );
}
