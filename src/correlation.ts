// Deterministic task/worker correlation with an honest never-guess fallback.
//
// The parent observes two public surfaces: `tool_call` events whose `input`
// carries the gentle-pi delegation arguments (`agent`, `task`, `label`, `mode`,
// or `task_id` for continue/cancel), and `tool_result` events whose
// `details.gentleAgents` carries `{ taskId, agent, status, mode }`. A child
// `pi --mode rpc` worker never receives `taskId` and the parent never receives
// the child PID via tool results, so there is no universal join key. This
// module tracks the task lifecycle from those events and joins tracked tasks to
// live worker snapshots using exactly two regimes:
//
//   * Regime A — exactly one live worker AND exactly one active task: the row
//     is named with the task's observed `agent` badge (safe because only one
//     delegated worker exists in the whole session). The task `label` stays in
//     the engine and is never rendered.
//   * Regime B — two or more workers, or a worker/task count mismatch, or a
//     worker without a registered task: every row renders only verified worker
//     runtime facts with a neutral `subagent` / `subagent · <pid>` label. The
//     engine never guesses by launch order, process timestamp, or FIFO queue.
//
// Only Node builtins and the format/types/render modules are used; every entry
// point degrades silently and never throws on malformed input.

import { sanitizeText } from "./format.ts";
import type { WorkerRow } from "./render.ts";
import type {
  TaskMode,
  TaskStatus,
  TrackedTask,
  WorkerSnapshot,
} from "./types.ts";

/** Gentle Agents tool names observed for correlation. */
export const SUBAGENT_RUN = "subagent_run";
export const SUBAGENT_CONTINUE = "subagent_continue";
export const SUBAGENT_CANCEL = "subagent_cancel";

/**
 * Anti-flicker window (milliseconds). A value that vanished from a worker snapshot
 * during a brief phase transition is carried forward from the last observation for
 * this long, so the panel does not blink between a tool and its follow-up phase.
 */
export const STABILIZE_MS = 400 as const;

type ToolKind = "run" | "continue" | "cancel";
type UnknownRecord = Record<string, unknown>;

/** A renderable worker row enriched with the correlated task identity (Regime A). */
export interface CorrelatedWorker extends WorkerRow {
  /** Matched task id; only present under the deterministic Regime A join. */
  taskId?: string;
}

/**
 * Last-known values observed for one worker PID, used to stabilize the panel across brief
 * phase transitions. Each carried value owns its observation timestamp, so a value can only
 * survive `STABILIZE_MS` after it was last *seen*: one that really disappeared expires
 * even while the panel keeps ticking.
 */
interface SmoothedWorker {
  /** Last tool name observed in a snapshot; absent when the worker published none. */
  activeTool?: string;
  /** Timestamp (ms) of the snapshot that carried `activeTool`; 0 when never seen. */
  activeToolAt: number;
  /** Phase of the last snapshot, used to detect a drop out of a live phase. */
  phase?: string;
  /** Last displayed rate; carried forward across a brief transition. */
  tps: number;
  /** Timestamp (ms) of the snapshot that carried a positive `tps`; 0 when never. */
  tpsAt: number;
  /** Highest cumulative token count observed so far. */
  tokens: number;
}

/** Tracks the arguments of a `subagent_run` tool call until its result arrives. */
interface PendingRun {
  toolCallId: string;
  agent: string;
  label?: string;
  mode: TaskMode;
  startedAt: number;
}

interface CallEntry {
  kind: ToolKind;
  taskId?: string;
}

export interface CorrelationOptions {
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
}

function defaultNow(): number {
  return Date.now();
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readToolCallId(event: UnknownRecord): string | undefined {
  return (
    readString(event.toolCallId) ??
    readString(asRecord(event.toolCall)?.id) ??
    readString(event.id)
  );
}

function readToolName(event: UnknownRecord): string | undefined {
  return (
    readString(event.toolName) ??
    readString(asRecord(event.tool)?.name) ??
    readString(event.name)
  );
}

/** Reads a string field from the tool's `input` arguments object. */
function readInputString(
  event: UnknownRecord,
  key: string,
): string | undefined {
  const input = asRecord(event.input);
  if (input === null) return undefined;
  return readString(input[key]);
}

/** continue/cancel target a prior task via `input.task_id` (gentle-pi snake_case). */
function readTaskIdFromInput(event: UnknownRecord): string | undefined {
  return readInputString(event, "task_id") ?? readInputString(event, "taskId");
}

function readMode(value: unknown): TaskMode | undefined {
  if (value === "background") return "background";
  if (value === "task") return "task";
  return undefined;
}

/** `details.gentleAgents = { taskId, agent, status, mode }` from a tool result. */
interface GentleAgentsInfo {
  taskId?: string;
  agent?: string;
  status?: string;
  mode?: TaskMode;
}

function readGentleAgents(event: UnknownRecord): GentleAgentsInfo {
  const details = asRecord(event.details);
  const gentleAgents =
    asRecord(details?.gentleAgents) ?? asRecord(event.gentleAgents);
  if (gentleAgents === null) return {};
  return {
    taskId: readString(gentleAgents.taskId) ?? readString(gentleAgents.task_id),
    agent: readString(gentleAgents.agent),
    status: readString(gentleAgents.status),
    mode: readMode(gentleAgents.mode),
  };
}

function readToolKind(event: UnknownRecord): ToolKind | null {
  switch (readToolName(event)) {
    case SUBAGENT_RUN:
      return "run";
    case SUBAGENT_CONTINUE:
      return "continue";
    case SUBAGENT_CANCEL:
      return "cancel";
    default:
      return null;
  }
}

/**
 * Maps a gentle-pi `TASK_STATUS` value to the local `TrackedTask.status`. An
 * unknown or absent status falls back to `"running"` (the design's default for a
 * task that just produced a result), while finished statuses `completed`,
 * `failed`, and `timed_out` collapse to the terminal `"completed"` state.
 */
function mapGentleStatus(status: string | undefined): TaskStatus {
  switch (status) {
    case "queued":
      return "pending";
    case "waiting":
    case "running":
      return "running";
    case "cancelled":
      return "cancelled";
    case "completed":
    case "failed":
    case "timed_out":
      return "completed";
    default:
      return "running";
  }
}

function isFinishedStatus(status: string | undefined): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "timed_out" ||
    status === "cancelled"
  );
}

/** continue re-activates unless its result is terminal; queued/running keep it running. */
function continueStatus(status: string | undefined): TaskStatus {
  return isFinishedStatus(status) ? mapGentleStatus(status) : "running";
}

function isActive(status: TaskStatus): boolean {
  return status === "pending" || status === "running";
}

/**
 * Tracks gentle-pi delegated tasks from public tool events and joins them to
 * live worker snapshots using the deterministic two-regime correlation.
 */
export class CorrelationEngine {
  private readonly now: () => number;
  private readonly registry = new Map<string, TrackedTask>();
  private readonly pending = new Map<string, PendingRun>();
  private readonly calls = new Map<string, CallEntry>();
  private readonly smoothed = new Map<number, SmoothedWorker>();

  constructor(options: CorrelationOptions = {}) {
    this.now = options.now ?? defaultNow;
  }

  /** A stable snapshot of every tracked (non-evicted) task. */
  tasks(): TrackedTask[] {
    return [...this.registry.values()]
      .map((task) => ({ ...task }))
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  /** Tracked tasks that are still active (`pending` or `running`). */
  activeTasks(): TrackedTask[] {
    return this.tasks().filter((task) => isActive(task.status));
  }

  /** Resolves the tool kind from the event, falling back to the recorded call. */
  private resolveKind(
    rec: UnknownRecord,
    toolCallId: string | undefined,
  ): ToolKind | null {
    const fromName = readToolKind(rec);
    if (fromName !== null) return fromName;
    if (toolCallId === undefined) return null;
    return this.calls.get(toolCallId)?.kind ?? null;
  }

  /** Resolves a continue/cancel target from gentleAgents, input, or the recorded call. */
  private resolveTaskId(
    gentle: GentleAgentsInfo,
    rec: UnknownRecord,
    toolCallId: string | undefined,
  ): string | undefined {
    if (gentle.taskId !== undefined) return gentle.taskId;
    const fromInput = readTaskIdFromInput(rec);
    if (fromInput !== undefined) return fromInput;
    return toolCallId === undefined
      ? undefined
      : this.calls.get(toolCallId)?.taskId;
  }

  /** Records a toolCallId → call association when a call id is present. */
  private recordCall(
    toolCallId: string | undefined,
    kind: ToolKind,
    taskId: string | undefined,
  ): void {
    if (toolCallId === undefined) return;
    this.calls.set(toolCallId, { kind, taskId });
  }

  /**
   * Consumes one gentle-pi `tool_call` event for `subagent_run` (register a
   * pending task), `subagent_continue` (re-activate), or `subagent_cancel`
   * (evict). Missing fields and non-subagent tools are ignored safely.
   */
  handleToolCall(event: unknown): void {
    const rec = asRecord(event);
    if (rec === null || rec.type !== "tool_call") return;
    const kind = readToolKind(rec);
    if (kind === null) return;
    const toolCallId = readToolCallId(rec);
    if (toolCallId === undefined) return;

    if (kind === "run") {
      const agent = sanitizeText(readInputString(rec, "agent") ?? "");
      const rawLabel = readInputString(rec, "label");
      const label = rawLabel === undefined ? undefined : sanitizeText(rawLabel);
      const mode = readMode(readInputString(rec, "mode")) ?? "task";
      const startedAt = this.now();
      this.pending.set(toolCallId, {
        toolCallId,
        agent,
        label,
        mode,
        startedAt,
      });
      // Register the pending task under its toolCallId placeholder so the active
      // set (and Regime A) sees it before the result assigns the real taskId.
      this.upsert(toolCallId, {
        agent,
        label,
        mode,
        status: "pending",
        startedAt,
      });
      this.recordCall(toolCallId, kind, undefined);
      return;
    }

    const taskId = readTaskIdFromInput(rec);
    this.recordCall(toolCallId, kind, taskId);
    if (kind === "continue") {
      this.reactivate(taskId);
    } else {
      this.evict(taskId);
    }
  }

  /**
   * Consumes one gentle-pi `tool_result` event. The `details.gentleAgents`
   * payload drives status transitions; any result carrying that metadata
   * (run/continue/cancel/status/result tools) updates the matching task. Cancel
   * evicts; finished statuses clear the task from the active set.
   */
  handleToolResult(event: unknown): void {
    const rec = asRecord(event);
    if (rec === null || rec.type !== "tool_result") return;
    const gentle = readGentleAgents(rec);
    const toolCallId = readToolCallId(rec);
    const kind = this.resolveKind(rec, toolCallId);

    if (kind === "run") {
      const pendingRun =
        toolCallId === undefined ? undefined : this.pending.get(toolCallId);
      const taskId =
        gentle.taskId ?? pendingRun?.toolCallId ?? readTaskIdFromInput(rec);
      if (taskId === undefined) return;
      this.upsert(taskId, {
        agent: gentle.agent ?? pendingRun?.agent,
        label: pendingRun?.label,
        mode: gentle.mode ?? pendingRun?.mode,
        status: mapGentleStatus(gentle.status),
        startedAt: pendingRun?.startedAt,
      });
      if (gentle.status === "cancelled") this.evict(taskId);
      if (pendingRun !== undefined && pendingRun.toolCallId !== taskId) {
        this.registry.delete(pendingRun.toolCallId); // promote placeholder → real taskId
      }
      if (toolCallId !== undefined) {
        this.pending.delete(toolCallId);
        this.recordCall(toolCallId, kind, taskId);
      }
      return;
    }

    if (kind === "continue") {
      const taskId = this.resolveTaskId(gentle, rec, toolCallId);
      if (taskId !== undefined) {
        this.upsert(taskId, {
          agent: gentle.agent,
          mode: gentle.mode,
          status: continueStatus(gentle.status),
        });
        if (gentle.status === "cancelled") this.evict(taskId);
        this.recordCall(toolCallId, kind, taskId);
      }
      return;
    }

    if (kind === "cancel") {
      const taskId = this.resolveTaskId(gentle, rec, toolCallId);
      this.evict(taskId);
      if (taskId !== undefined) this.recordCall(toolCallId, kind, taskId);
      return;
    }

    // Generic gentleAgents metadata (status/result checks, background completion):
    // update the task it names without a specific tool routing requirement.
    if (gentle.taskId !== undefined) {
      this.upsert(gentle.taskId, {
        agent: gentle.agent,
        mode: gentle.mode,
        status: mapGentleStatus(gentle.status),
      });
      if (gentle.status === "cancelled") this.evict(gentle.taskId);
    }
  }

  /**
   * Joins live worker snapshots to tracked tasks. Exactly one worker and one
   * active task yields the deterministic Regime A enrichment (the raw agent
   * badge becomes the row name; the task label is never copied into the row);
   * every other shape yields honest Regime B fallback rows with identity
   * omitted. The worker's own `thinkingLevel` is a verified runtime fact and is
   * carried in both regimes.
   *
   * Anti-flicker: a `activeTool` or `tps` that vanished during a phase transition
   * within `STABILIZE_MS` is carried forward from the last observation of the same
   * PID, token counts never move backwards, and a `complete` snapshot additionally
   * carries `completedAt` plus the mean rate derived from its own timestamps.
   */
  correlate(workers: WorkerSnapshot[]): CorrelatedWorker[] {
    const active = this.activeTasks();
    const deterministic = workers.length === 1 && active.length === 1;
    const matched = deterministic ? active[0] : undefined;
    const now = this.now();

    const rows = workers.map((snapshot) => {
      const previous = this.smoothed.get(snapshot.pid);
      // A `complete` snapshot is authoritative: nothing about a live phase is carried.
      const finished = snapshot.phase === "complete";
      const inWindow = (at: number | undefined): boolean =>
        !finished && at !== undefined && now - at <= STABILIZE_MS;

      const observedTool = snapshot.activeTool;
      const activeTool =
        observedTool === undefined && inWindow(previous?.activeToolAt)
          ? previous?.activeTool
          : observedTool;

      // A rate only carries when it just dropped to zero out of a live phase: a worker
      // that was already idle must stay idle instead of resurrecting an old rate.
      const livePhase =
        previous?.phase === "streaming" || previous?.phase === "tool";
      const observedTps = Number.isFinite(snapshot.tps) ? snapshot.tps : 0;
      const lastTps = previous?.tps ?? 0;
      const tps =
        observedTps === 0 &&
        livePhase &&
        lastTps > 0 &&
        inWindow(previous?.tpsAt)
          ? lastTps
          : observedTps;

      // A worker's cumulative token count never decreases; a smaller reading is stale.
      const tokens = Math.max(snapshot.totalTokens, previous?.tokens ?? 0);

      this.smoothed.set(snapshot.pid, {
        activeTool,
        activeToolAt:
          observedTool === undefined ? (previous?.activeToolAt ?? 0) : now,
        phase: snapshot.phase,
        tps,
        tpsAt: observedTps > 0 ? now : (previous?.tpsAt ?? 0),
        tokens,
      });

      const row: CorrelatedWorker = {
        pid: snapshot.pid,
        tps,
        phase: snapshot.phase,
        activeTool,
        tokens,
        model: snapshot.model,
      };

      // Completed rows report what the worker achieved instead of a live rate.
      if (finished && snapshot.completedAt !== undefined) {
        row.completedAt = snapshot.completedAt;
        const elapsedSeconds =
          (snapshot.completedAt - snapshot.startTime) / 1000;
        if (elapsedSeconds > 0) row.avgTps = tokens / elapsedSeconds;
      }

      const thinking =
        snapshot.thinkingLevel === undefined
          ? ""
          : sanitizeText(snapshot.thinkingLevel);
      if (thinking !== "") row.thinkingLevel = thinking;

      if (matched !== undefined) {
        const badge = sanitizeText(matched.agent);
        if (badge !== "") row.badge = badge;
        // The tracked task `label` stays in the engine; the render row never
        // carries task text.
        row.taskId = matched.taskId;
      }

      return row;
    });

    // Drop smoothing state for workers that left the panel, so a recycled PID can
    // never inherit another worker's last-known tool, rate, or token count.
    for (const pid of [...this.smoothed.keys()]) {
      if (!workers.some((snapshot) => snapshot.pid === pid)) {
        this.smoothed.delete(pid);
      }
    }

    return rows;
  }

  private reactivate(taskId: string | undefined): void {
    if (taskId === undefined) return;
    const task = this.registry.get(taskId);
    if (task !== undefined) task.status = "running";
  }

  private evict(taskId: string | undefined): void {
    if (taskId === undefined) return;
    this.registry.delete(taskId);
  }

  private upsert(
    taskId: string,
    partial: {
      agent?: string;
      label?: string;
      mode?: TaskMode;
      status?: TaskStatus;
      startedAt?: number;
    },
  ): void {
    const existing = this.registry.get(taskId);
    if (existing !== undefined) {
      if (partial.agent !== undefined) existing.agent = partial.agent;
      if (partial.label !== undefined) existing.label = partial.label;
      if (partial.mode !== undefined) existing.mode = partial.mode;
      if (partial.status !== undefined) existing.status = partial.status;
      return;
    }
    const task: TrackedTask = {
      taskId,
      agent: partial.agent ?? "",
      mode: partial.mode ?? "task",
      status: partial.status ?? "running",
      startedAt: partial.startedAt ?? this.now(),
    };
    if (partial.label !== undefined && partial.label !== "")
      task.label = partial.label;
    this.registry.set(taskId, task);
  }
}
