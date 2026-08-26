import * as React from "react";
import { MessageSquare } from "lucide-react";
import { AgentTrace } from "src/components/ai-elements/agent-trace";
import { ChainOfThoughtStep } from "src/components/ai-elements/chain-of-thought";
import { RichContent } from "src/components/rich-content";
import { groupStepsIntoSegments } from "src/features/chat/trace-groups";
import type { StepItem } from "src/features/chat/types";

interface MessageSegmentsProps {
  steps: StepItem[];
  working?: boolean;
  onCardAction?: (type: string, data: any) => void;
  /** Optional custom expanded body for tool pills (e.g. attachment previews). */
  renderToolBody?: (step: Extract<StepItem, { type: "tool" }>) => React.ReactNode;
}

/**
 * Renders a step timeline as collapsible agent traces (reasoning + tools),
 * markdown segments, and question rows — no steps are hidden anymore.
 */
export function MessageSegments({
  steps,
  working = false,
  onCardAction,
  renderToolBody,
}: MessageSegmentsProps) {
  const segments = groupStepsIntoSegments(steps, {
    decorateTool: renderToolBody
      ? (node, step) => {
          const body = renderToolBody(step);
          return body ? { ...node, renderContent: () => body } : node;
        }
      : undefined,
  });

  return segments.map((seg) => {
    if (seg.kind === "trace") {
      return (
        <AgentTrace
          key={seg.key}
          nodes={seg.nodes}
          working={working}
          settled={seg.settled}
        />
      );
    }
    if (seg.kind === "text") {
      const isLast = seg === segments[segments.length - 1];
      return (
        <RichContent
          key={seg.key}
          isAnimating={working && isLast}
          onCardAction={onCardAction}
        >
          {seg.text}
        </RichContent>
      );
    }
    const q = seg.step;
    return (
      <ChainOfThoughtStep
        key={seg.key}
        icon={MessageSquare}
        label={
          q.status === "answered"
            ? `${q.text} → ${Array.isArray(q.answer) ? q.answer.join(", ") : q.answer}`
            : q.text
        }
        status={q.status === "answered" ? "complete" : "active"}
      />
    );
  });
}
