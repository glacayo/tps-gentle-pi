// Gentle AI live TPS meter — Pi extension entrypoint.
//
// Watches the `session_start` lifecycle event to select one of three roles:
//
//   * `parent-tui`   — the interactive TUI process: track the main agent, create
//     the private session channel directory, aggregate worker snapshots, and
//     render the panel above the editor on an unreferenced 200 ms interval.
//   * `gentle-worker` — a `pi --mode rpc` child spawned by Gentle Agents: track
//     its own throughput, publish throttled snapshots into the inherited channel
//     directory, and strictly avoid every `ctx.ui` call so RPC stdout stays clean.
//   * `headless-noop` — any other session: do nothing and create no files.
//
// This module uses only public Pi APIs (`import type` for the `ExtensionAPI`
// type) and Node builtins. It never imports, patches, or references gentle-pi.
// Node 24 executes this file directly via native type stripping.

import fs from "node:fs";
import os from "node:os";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createSessionDirectory, ThrottledPublisher } from "../src/channel.ts";
import {
  readWorkerSnapshots,
  removeSessionDirectory,
  scavengeStaleDirectories,
} from "../src/channel-guard.ts";
import { CorrelationEngine } from "../src/correlation.ts";
import { renderPanel } from "../src/render.ts";
import type { PanelStats } from "../src/render.ts";
import { EventTracker } from "../src/tracker.ts";
import type { ExtensionRole } from "../src/types.ts";

/** Canonical refresh interval for the panel, in milliseconds. */
export const RENDER_INTERVAL_MS = 200;

/** Widget id shared by the panel and its removal call. */
export const WIDGET_ID = "tps-meter";

/** Widget placement above the editor input. */
const WIDGET_PLACEMENT = "aboveEditor" as const;

/** Pi events that feed the main/worker event tracker. */
const TRACKED_EVENTS = [
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_end",
  "model_select",
  "thinking_level_select",
] as const;

/** Events that flush a worker snapshot immediately (bypassing the throttle). */
const SIGNIFICANT_TRANSITIONS = new Set<string>([
  "tool_execution_start",
  "tool_execution_end",
  "message_end",
]);

/** Minimal structural surface of `ctx.ui` used for meter rendering. */
interface MeterUi {
  setWidget(id: string, lines: string[] | undefined, options?: unknown): void;
}

/**
 * Minimal structural surface of the session model exposed on `ExtensionContext`.
 * Pi supplies a record carrying `provider` and `id`; the tracker's `model_select`
 * parser also accepts a plain string, so both shapes are tolerated here.
 */
type MeterModel = string | { provider?: string; id?: string };

/** Minimal structural surface of `ExtensionContext` consumed by the wiring. */
interface MeterCtx {
  mode: string;
  hasUI: boolean;
  ui: MeterUi;
  /** Model Pi resolved before the session started; absent when unavailable. */
  model?: MeterModel;
  /** Thinking level Pi resolved before the session started; absent when unset. */
  thinkingLevel?: string;
}

/** Signature of a lifecycle/tool event handler registered with `pi.on`. */
type EventHandler = (event: unknown, ctx: MeterCtx) => void;

/** Callback returned by `pi.on` to unsubscribe the handler. */
type Unsubscribe = () => void;

/** Minimal structural surface of `ExtensionAPI` consumed by the wiring. */
interface MeterApi {
  on(event: string, handler: EventHandler): Unsubscribe;
}

/** Handle returned by an injected (or native) interval timer. */
export interface TimerHandle {
  unref?: () => unknown;
}

/** Injectable seams kept minimal so tests can drive lifecycle without Pi. */
export interface WireDeps {
  setInterval?: (fn: () => void, ms: number) => TimerHandle;
  clearInterval?: (handle: TimerHandle | undefined) => void;
  tmpDir?: string;
  onProcessExit?: (handler: () => void) => void;
  /**
   * Injectable clock forwarded to every tracker the wiring constructs. When
   * absent, each tracker keeps its own `Date.now` default (production behavior).
   */
  now?: () => number;
}

/**
 * Selects the extension role from the Pi context mode and the environment, per
 * the design decision matrix. A gentle-pi child with an inherited channel
 * directory is a worker (regardless of mode); a non-child TUI session is the
 * parent; everything else degrades to a silent no-op.
 */
export function detectRole(
  ctx: { mode: string; hasUI: boolean },
  env: Record<string, string | undefined>,
): ExtensionRole {
  const isGentleChild = env.GENTLE_PI_AGENTS_CHILD === "1";
  const hasChannelDir =
    typeof env.PI_TPS_DIR === "string" && env.PI_TPS_DIR.length > 0;

  if (isGentleChild && hasChannelDir) return "gentle-worker";
  if (ctx.mode === "tui" && !isGentleChild) return "parent-tui";
  return "headless-noop";
}

/** True when `value` names an existing directory on disk. */
function isExistingDirectory(value: string | undefined): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function parentPanelStats(tracker: EventTracker): PanelStats {
  const snapshot = tracker.snapshot();
  const stats = tracker.sessionStats();
  return {
    tps: snapshot.tps,
    mean: stats.mean,
    p95: stats.p95,
    sparkline: stats.sparkline,
    model: snapshot.model,
    thinkingLevel: snapshot.thinkingLevel,
    phase: snapshot.phase,
    activeTool: snapshot.activeTool,
    totalTokens: snapshot.totalTokens,
  };
}

/** Registers `TRACKED_EVENTS` against a single event sink (tracker or worker handler). */
function wireTrackedEvents(pi: MeterApi, sink: (event: unknown) => void): void {
  for (const eventName of TRACKED_EVENTS) {
    pi.on(eventName, async (event) => sink(event));
  }
}

function wireParentEvents(
  pi: MeterApi,
  tracker: EventTracker,
  correlation: CorrelationEngine,
): void {
  wireTrackedEvents(pi, (event) => tracker.handle(event));
  pi.on("tool_call", async (event) => correlation.handleToolCall(event));
  pi.on("tool_result", async (event) => correlation.handleToolResult(event));
}

/**
 * Seeds a tracker with the model and thinking level Pi already resolved before the
 * session started. Pi exposes both on `ctx` but emits no initial `model_select` or
 * `thinking_level_select`, so without this seed the tracker stays empty and the
 * first panel row / worker snapshot omits `provider/model:thinking` until the user
 * changes either one. Seeding replays the tracker's own event parsers, so
 * sanitization and clamping match the live event path exactly.
 */
function seedTrackerFromContext(tracker: EventTracker, ctx: MeterCtx): void {
  if (ctx.model !== undefined) {
    tracker.handle({ type: "model_select", model: ctx.model });
  }
  if (ctx.thinkingLevel !== undefined) {
    tracker.handle({ type: "thinking_level_select", level: ctx.thinkingLevel });
  }
}

function wireParent(pi: MeterApi, ctx: MeterCtx, deps: WireDeps): void {
  const setIntervalFn =
    deps.setInterval ??
    ((fn: () => void, ms: number): TimerHandle => {
      const handle = setInterval(fn, ms);
      // SAFETY: Node's setInterval returns a Timeout whose unref() satisfies the
      // TimerHandle shape; the cast only bridges the injected/native handle types.
      return handle as unknown as TimerHandle;
    });
  const clearIntervalFn =
    deps.clearInterval ??
    ((handle: TimerHandle | undefined): void => {
      // SAFETY: clearInterval accepts the same timer object produced by the
      // matching setInterval fallback; the cast informs TypeScript only.
      clearInterval(handle as unknown as NodeJS.Timeout);
    });
  const tmpDir = deps.tmpDir ?? os.tmpdir();

  const tracker = new EventTracker({ now: deps.now });
  // Seed before the first render tick so the initial panel already shows the
  // session's model and thinking level (no model_select event arrives at startup).
  seedTrackerFromContext(tracker, ctx);
  const correlation = new CorrelationEngine();
  const sessionDir = createSessionDirectory({ tmpDir });
  if (sessionDir !== null) process.env.PI_TPS_DIR = sessionDir;
  scavengeStaleDirectories(tmpDir);

  let timer: TimerHandle | undefined;

  const renderTick = (): void => {
    const stats = parentPanelStats(tracker);
    const snapshots =
      sessionDir === null ? [] : readWorkerSnapshots(sessionDir);
    const rows = correlation.correlate(snapshots);
    const width = process.stdout.columns || 80;
    ctx.ui.setWidget(WIDGET_ID, renderPanel(stats, rows, width), {
      placement: WIDGET_PLACEMENT,
    });
  };

  // Render once immediately so the panel is visible before the first tick.
  renderTick();
  timer = setIntervalFn(renderTick, RENDER_INTERVAL_MS);
  timer.unref?.();

  wireParentEvents(pi, tracker, correlation);

  pi.on("session_shutdown", async () => {
    if (timer !== undefined) clearIntervalFn(timer);
    timer = undefined;
    ctx.ui.setWidget(WIDGET_ID, undefined);
    if (sessionDir !== null) removeSessionDirectory(sessionDir);
    delete process.env.PI_TPS_DIR;
  });
}

function wireWorker(pi: MeterApi, ctx: MeterCtx, deps: WireDeps): void {
  const sessionDir = process.env.PI_TPS_DIR;
  // Channel verification: a worker with a missing channel directory must stay
  // silent and create no files, exactly like the headless role.
  if (!isExistingDirectory(sessionDir)) return;

  const tracker = new EventTracker({
    pid: process.pid,
    workerId: `worker-${process.pid}`,
    now: deps.now,
  });
  // Seed before any tracked event can publish, so the first snapshot carries the
  // session's model and thinking level (no model_select event arrives at startup).
  seedTrackerFromContext(tracker, ctx);
  const publisher = new ThrottledPublisher(sessionDir, process.pid);

  let closed = false;
  const shutdownWorker = (): void => {
    if (closed) return;
    closed = true;
    tracker.complete();
    publisher.shutdown();
  };

  const handle = (event: unknown): void => {
    if (closed) return;
    tracker.handle(event);
    const type = (event as { type?: unknown }).type;
    const significant =
      typeof type === "string" && SIGNIFICANT_TRANSITIONS.has(type);
    publisher.publish(tracker.snapshot(), { significant });
  };

  wireTrackedEvents(pi, handle);
  pi.on("agent_end", async () => shutdownWorker());
  pi.on("session_shutdown", async () => shutdownWorker());

  const onExit =
    deps.onProcessExit ??
    ((handler: () => void): void => {
      process.once("exit", handler);
    });
  onExit(shutdownWorker);
}

/**
 * Internal, testable wiring seam. It registers a `session_start` handler that
 * dispatches to the parent, worker, or headless path. The default export wraps
 * this with the real Pi extension API.
 */
export function wireSession(pi: MeterApi, deps: WireDeps = {}): void {
  pi.on("session_start", async (_event, ctx) => {
    const role = detectRole(ctx, process.env);
    if (role === "parent-tui") {
      wireParent(pi, ctx, deps);
    } else if (role === "gentle-worker") {
      wireWorker(pi, ctx, deps);
    }
    // headless-noop: intentionally do nothing.
  });
}

/** Pi extension entrypoint: role detection and lifecycle wiring. */
export default function (pi: ExtensionAPI): void {
  // SAFETY: the real ExtensionAPI is a structural superset of MeterApi's single
  // `on` method, so this cast only narrows the surface actually consumed here.
  wireSession(pi as unknown as MeterApi);
}
