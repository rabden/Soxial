// Public API of the tool-format split. Re-exports the exact surface the
// historical single-file module exposed, so '../lib/tool-format' imports
// keep working unchanged.
export { isFailedResult, itemsOf } from "./envelope";
export { toolArgsChip } from "./args-chip";
export { toolCompletedChip, toolResultPhrase } from "./result-phrase";
export { summarizeTrace, type TraceSummary } from "./activity";
export { toolDetails, type ToolDetailRow } from "./details";
