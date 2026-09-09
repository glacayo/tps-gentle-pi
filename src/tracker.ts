// Event-driven TPS tracker. Consumes Pi message/tool/model events and maintains
// per-message streaming counters plus session statistics (a bounded sparkline, an
// incremental mean, and a P² streaming p95). The same class serves the parent
// (main) agent and each gentle-pi worker child: `snapshot()` returns a
// `WorkerSnapshot`-shaped packet and `sessionStats()` returns the panel-facing
// statistics. State is mutated only by `handle()` / `complete()`; reading
// `snapshot()` or `sessionStats()` never changes statistics.
//
// Provider usage is preferred when reported. When a provider defers usage during
// streaming, a documented character-based estimate (`ceil(chars / 4)`) keeps the
// meter moving; the estimate is replaced by authoritative usage at `message_end`.
// Only Node builtins (via `./stats.ts` / `./types.ts`) are used.

import {
  computeTps,
  IncrementalMean,
  P2Quantile,
  RingBuffer,
} from "./stats.ts";
import { SNAPSHOT_STRING_MAX_LENGTH, SNAPSHOT_VERSION } from "./types.ts";
import type { WorkerPhase, WorkerSnapshot } from "./types.ts";

/** Divisor for the documented character-based token estimate (`ceil(chars / 4)`). */
export const CHAR_ESTIMATE_DIVISOR = 4;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Navigates a property path to a parsed string, returning `undefined` when absent. */
function readStringAt(
  root: unknown,
  path: readonly string[],
): string | undefined {
  let cur: unknown = root;
  for (const key of path) cur = asRecord(cur)?.[key];
  return readString(cur);
}

/** Navigates a property path to a parsed finite number, returning `undefined` when absent. */
function readNumberAt(
  root: unknown,
  path: readonly string[],
): number | undefined {
  let cur: unknown = root;
  for (const key of path) cur = asRecord(cur)?.[key];
  return readFiniteNumber(cur);
}

/** Navigates a property path to a parsed record, returning `null` when absent/non-object. */
function readRecordAt(
  root: unknown,
  path: readonly string[],
): UnknownRecord | null {
  let cur: unknown = root;
  for (const key of path) cur = asRecord(cur)?.[key];
  return asRecord(cur);
}

/** Documented heuristic: `ceil(chars / 4)` tokens for providers that defer usage. */
function estimateTokens(chars: number): number {
  return Math.ceil(chars / CHAR_ESTIMATE_DIVISOR);
}

/** Clamps an optional label to the snapshot schema's maximum length. */
function clampLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.slice(0, SNAPSHOT_STRING_MAX_LENGTH);
}

/**
 * Reads provider output usage from either surface shape: the RPC worker emits a
 * top-level `usage.output`, while the in-process parent emits `message.usage.output`.
 * A positive value wins; a zero from one source never shadows a positive value from
 * the other.
 */
function readOutputUsage(event: UnknownRecord): number | undefined {
  const top = readNumberAt(event, ["usage", "output"]);
  const viaMessage = readNumberAt(event, ["message", "usage", "output"]);
  if (top !== undefined && top > 0) return top;
  if (viaMessage !== undefined && viaMessage > 0) return viaMessage;
  return top ?? viaMessage;
}

/**
 * Characters contributed by a text/thinking streaming delta. `text_start`/`text_end`,
 * `thinking_start`/`thinking_end`, and toolcall deltas contribute nothing.
 */
function readDeltaLength(event: UnknownRecord): number {
  const assistantEvent = readRecordAt(event, ["assistantMessageEvent"]);
  if (assistantEvent === null) return 0;
  const type = assistantEvent.type;
  if (type !== "text_delta" && type !== "thinking_delta") return 0;
  const delta = assistantEvent.delta;
  return typeof delta === "string" ? delta.length : 0;
}

/**
 * `message_start` / `message_end` fire for user, assistant, and toolResult messages;
 * only assistant turns contribute throughput. A missing role is tolerated as an
 * assistant turn so stripped-down event streams keep the meter moving.
 */
function isAssistantTurn(event: UnknownRecord): boolean {
  const role = readStringAt(event, ["message", "role"]);
  return role === undefined || role === "assistant";
}

/** Reads the model label, preferring the compact model `id` (design §5 example). */
function readModelLabel(event: UnknownRecord): string | undefined {
  const model = event.model;
  if (typeof model === "string" && model.length > 0) return model;
  const modelRecord = asRecord(model);
  if (modelRecord !== null) {
    const id = readString(modelRecord.id);
    if (id !== undefined) return id;
  }
  return readString(event.modelName) ?? readString(event.modelId);
}

/** Reads the thinking-level label across the known payload key variants. */
function readThinkingLevel(event: UnknownRecord): string | undefined {
  return (
    readString(event.level) ??
    readString(event.thinkingLevel) ??
    readString(event.thinking_level)
  );
}

export interface TrackerOptions {
  /** Worker process ID (defaults to `process.pid`). */
  pid?: number;
  /** Worker session identifier (defaults to `worker-<pid>`). */
  workerId?: string;
  /** Process start timestamp in epoch milliseconds (defaults to construction time). */
  startTime?: number;
  /** Injectable clock (defaults to `Date.now`). */
  now?: () => number;
}

/** Session statistics consumed by the panel renderer. */
export interface TrackerSessionStats {
  /** Recent completed-turn TPS history, oldest first (bounded to 12). */
  sparkline: number[];
  /** Incremental mean of completed-turn TPS values. */
  mean: number;
  /** P² streaming p95 estimate (NaN until the sketch bootstraps at 64 samples). */
  p95: number;
  /** Number of finalized turns sampled into the p95 sketch. */
  p95SampleCount: number;
}

function defaultNow(): number {
  return Date.now();
}

/**
 * Streaming TPS state machine for one agent (main or worker). Counter and statistic
 * updates happen only on `handle()` (message/tool/model events) and `complete()`;
 * render ticks only read `snapshot()` / `sessionStats()` and cannot mutate state.
 */
export class EventTracker {
  private readonly pid: number;
  private readonly workerId: string;
  private readonly startTime: number;
  private readonly now: () => number;

  private readonly sparkline: RingBuffer;
  private readonly mean: IncrementalMean;
  private readonly p95: P2Quantile;

  private phase: WorkerPhase = "waiting";
  private model?: string;
  private thinkingLevel?: string;
  private activeTool?: string;
  private completedAt?: number;

  private messageOpen = false;
  private messageStartedAt = 0;
  private firstDeltaAt?: number;
  private messageTokens = 0;
  private messageChars = 0;
  private reportedTokens = 0;
  private liveTps = 0;
  private completedTokens = 0;

  constructor(options: TrackerOptions = {}) {
    const now = options.now ?? defaultNow;
    this.now = now;
    this.pid = options.pid ?? process.pid;
    this.workerId = options.workerId ?? `worker-${this.pid}`;
    this.startTime = options.startTime ?? now();
    this.sparkline = new RingBuffer();
    this.mean = new IncrementalMean();
    this.p95 = new P2Quantile();
  }

  /**
   * Consumes one Pi event-like object. Unknown `type` values and missing fields are
   * ignored safely; this method never throws.
   */
  handle(event: unknown): void {
    const rec = asRecord(event);
    if (rec === null) return;
    switch (rec.type) {
      case "message_start":
        this.onMessageStart(rec);
        break;
      case "message_update":
        this.onMessageUpdate(rec);
        break;
      case "message_end":
        this.onMessageEnd(rec);
        break;
      case "tool_execution_start":
        this.onToolStart(rec);
        break;
      case "tool_execution_end":
        this.onToolEnd();
        break;
      case "model_select":
        this.onModelSelect(rec);
        break;
      case "thinking_level_select":
        this.onThinkingLevelSelect(rec);
        break;
      default:
        // Ignore unrecognized events; no error surfaces.
        break;
    }
  }

  /** Returns a fresh, `WorkerSnapshot`-shaped view of the current state. */
  snapshot(): WorkerSnapshot {
    const snapshot: WorkerSnapshot = {
      v: SNAPSHOT_VERSION,
      pid: this.pid,
      workerId: this.workerId,
      startTime: this.startTime,
      updatedAt: this.now(),
      phase: this.phase,
      tps: this.liveTps,
      messageTokens: this.messageTokens,
      totalTokens: this.totalTokens(),
    };
    if (this.model !== undefined) snapshot.model = this.model;
    if (this.thinkingLevel !== undefined)
      snapshot.thinkingLevel = this.thinkingLevel;
    if (this.activeTool !== undefined) snapshot.activeTool = this.activeTool;
    if (this.completedAt !== undefined) snapshot.completedAt = this.completedAt;
    return snapshot;
  }

  /** Returns session statistics as fresh values (never mutates internal state). */
  sessionStats(): TrackerSessionStats {
    return {
      sparkline: this.sparkline.toArray(),
      mean: this.mean.value,
      p95: this.p95.value,
      p95SampleCount: this.p95.count,
    };
  }

  /**
   * Marks the agent/worker complete (used by the wiring on `agent_end`). Any still
   * open message is finalized first so its turn is not lost.
   */
  complete(): void {
    if (this.messageOpen) this.finalizeTurn(undefined);
    this.phase = "complete";
    this.completedAt = this.now();
    this.liveTps = 0;
    this.activeTool = undefined;
  }

  private totalTokens(): number {
    return this.completedTokens + (this.messageOpen ? this.messageTokens : 0);
  }

  private onMessageStart(event: UnknownRecord): void {
    if (!isAssistantTurn(event)) return;
    this.messageOpen = true;
    this.messageStartedAt = this.now();
    this.firstDeltaAt = undefined;
    this.messageTokens = 0;
    this.messageChars = 0;
    this.reportedTokens = 0;
    this.liveTps = 0;
    this.phase = "streaming";
  }

  private onMessageUpdate(event: UnknownRecord): void {
    if (!this.messageOpen) return;

    const output = readOutputUsage(event);
    const deltaLength = readDeltaLength(event);

    if (deltaLength > 0) {
      this.messageChars += deltaLength;
      if (this.firstDeltaAt === undefined) this.firstDeltaAt = this.now();
    }

    if (output !== undefined && output > 0) {
      // Reported usage is cumulative and authoritative; remember it so a later
      // usage-less chunk cannot regress the token count.
      this.reportedTokens = output;
      this.messageTokens = output;
      if (this.firstDeltaAt === undefined) this.firstDeltaAt = this.now();
    } else {
      this.messageTokens = Math.max(
        this.reportedTokens,
        estimateTokens(this.messageChars),
      );
    }

    this.liveTps = this.computeLiveTps();
    this.phase = "streaming";
  }

  private onMessageEnd(event: UnknownRecord): void {
    if (!this.messageOpen || !isAssistantTurn(event)) return;
    this.finalizeTurn(readOutputUsage(event));
  }

  /** Records one completed turn against the authoritative (or estimated) tokens. */
  private finalizeTurn(authoritativeOutput: number | undefined): void {
    const authoritative =
      authoritativeOutput !== undefined && authoritativeOutput > 0
        ? authoritativeOutput
        : estimateTokens(this.messageChars);

    this.messageTokens = authoritative;
    this.completedTokens += authoritative;

    const base = this.firstDeltaAt ?? this.messageStartedAt ?? this.now();
    const finalTps = computeTps(authoritative, this.now() - base);

    if (finalTps > 0) {
      this.sparkline.push(finalTps);
      this.mean.add(finalTps);
      this.p95.update(finalTps);
    }

    this.messageOpen = false;
    this.phase = "waiting";
    this.liveTps = 0;
  }

  private computeLiveTps(): number {
    if (this.firstDeltaAt === undefined) return 0;
    return computeTps(this.messageTokens, this.now() - this.firstDeltaAt);
  }

  private onModelSelect(event: UnknownRecord): void {
    this.model = clampLabel(readModelLabel(event));
  }

  private onThinkingLevelSelect(event: UnknownRecord): void {
    this.thinkingLevel = clampLabel(readThinkingLevel(event));
  }

  private onToolStart(event: UnknownRecord): void {
    this.phase = "tool";
    this.activeTool = clampLabel(
      readString(event.toolName) ?? readString(event.tool),
    );
    this.liveTps = 0; // nothing streams while a tool executes
  }

  private onToolEnd(): void {
    this.activeTool = undefined;
    this.phase = this.messageOpen ? "streaming" : "waiting";
  }
}
