// Domain types and constants shared across the TPS meter extension.
//
// Node 24 executes this file directly via native type stripping, so only
// erasable TypeScript syntax is used: no `enum`, no `namespace`, and no
// parameter properties.

/** Throttle window for worker snapshot publication (milliseconds). */
export const THROTTLE_MS = 160 as const;

/** Maximum time before a worker snapshot is considered stale (milliseconds). */
export const STALENESS_MS = 5000 as const;

/** Schema protocol version for worker snapshots. */
export const SNAPSHOT_VERSION = 1 as const;

/** Maximum length of the worker snapshot `workerId` string. */
export const WORKER_ID_MAX_LENGTH = 128 as const;

/** Maximum length of optional snapshot strings (model, thinkingLevel, activeTool). */
export const SNAPSHOT_STRING_MAX_LENGTH = 64 as const;

export const WORKER_PHASES = [
 "waiting",
 "streaming",
 "tool",
 "complete",
] as const;

/** Current agent execution phase. */
export type WorkerPhase = (typeof WORKER_PHASES)[number];

/** Role selected at `session_start` based on context and environment. */
export type ExtensionRole = "parent-tui" | "gentle-worker" | "headless-noop";

/**
 * Minimal current-state telemetry packet published by a gentle-pi worker.
 * Contains zero prompt text, task text, or generated output.
 */
export interface WorkerSnapshot {
 /** Schema protocol version */
 v: typeof SNAPSHOT_VERSION;
 /** Worker operating system process ID */
 pid: number;
 /** Worker session identifier */
 workerId: string;
 /** Process start timestamp (epoch milliseconds) */
 startTime: number;
 /** Snapshot generation timestamp (epoch milliseconds) */
 updatedAt: number;
 /** Current agent execution phase */
 phase: WorkerPhase;
 /** Active model identifier (e.g. "claude-3-7-sonnet") */
 model?: string;
 /** Reasoning effort / thinking level if active */
 thinkingLevel?: string;
 /** Active tool name if in "tool" phase (e.g. "read", "bash") */
 activeTool?: string;
 /** Live output tokens per second (0 when not streaming) */
 tps: number;
 /** Cumulative output tokens for current assistant message */
 messageTokens: number;
 /** Total cumulative output tokens for this worker session */
 totalTokens: number;
 /** Completion timestamp if phase === "complete" */
 completedAt?: number;
}

export type TaskMode = "task" | "background";
export type TaskStatus = "pending" | "running" | "completed" | "cancelled";

/** A gentle-pi delegated task tracked on the parent side for correlation. */
export interface TrackedTask {
 taskId: string;
 agent: string;
 label?: string;
 mode: TaskMode;
 status: TaskStatus;
 startedAt: number;
}
