import type * as React from "react";
import type { LucideIcon } from "lucide-react";

/* Shared types for the collapsible agent trace: pill nodes + tool registry. */

export interface ToolDefinition {
  name: string;
  label?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  monoChip?: boolean;
}

export type TraceNodeStatus = "pending" | "running" | "completed" | "failed";

export type TraceNode = {
  id?: string | number;
  type: "reasoning" | "tool";
  toolName?: string;
  primary?: string;
  secondary?: string;
  mono?: boolean;
  icon?: LucideIcon;
  iconClassName?: string;
  status?: TraceNodeStatus;
  args?: any;
  result?: any;
  sentences?: string[];
  /** Custom expanded-body renderer (e.g. attachment previews); the only expandable pill body. */
  renderContent?: () => React.ReactNode;
};
