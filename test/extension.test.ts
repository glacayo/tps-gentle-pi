// Extension wiring tests: role detection, parent/worker/headless lifecycle, UI
// suppression, and the render tick composing the WU-3 panel. These tests use a
// mocked `ExtensionAPI`/`ExtensionContext` (plus injected timers and a fixture
// temp root) so no live Pi runtime is required; the extension entrypoint only
// imports public Pi APIs via `import type` and never references gentle-pi.
//
// Node 24 executes this file directly via native type stripping.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  detectRole,
  RENDER_INTERVAL_MS,
  WIDGET_ID,
  wireSession,
} from "../extensions/index.ts";
import { readWorkerSnapshots } from "../src/channel-guard.ts";
import { CorrelationEngine } from "../src/correlation.ts";
import { formatTokens, stripAnsi } from "../src/format.ts";
import { renderPanel } from "../src/render.ts";
import { EventTracker } from "../src/tracker.ts";

// ---------------------------------------------------------------------------
// Harness: mocked Pi API, extension context, fake timers, env/tmp isolation.
// ---------------------------------------------------------------------------

type Handler = (event: unknown, ctx: unknown) => unknown;

interface MockPi {
  handlers: Map<string, Handler[]>;
  on(event: string, handler: Handler): void;
}

function makePi(): MockPi {
  const handlers = new Map<string, Handler[]>();
  return {
    handlers,
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
  };
}

interface WidgetCall {
  id: string;
  lines: string[] | undefined;
  options: unknown;
}

function makeCtx(mode: string, hasUI = true) {
  const calls = {
    setWidget: [] as WidgetCall[],
    notify: [] as unknown[][],
    confirm: [] as unknown[][],
    setStatus: [] as unknown[][],
  };
  const ctx = {
    mode,
    hasUI,
    ui: {
      setWidget(id: string, lines: string[] | undefined, options?: unknown) {
        calls.setWidget.push({ id, lines, options });
      },
      notify(...args: unknown[]) {
        calls.notify.push(args);
      },
      confirm(...args: unknown[]) {
        calls.confirm.push(args);
        return Promise.resolve(true);
      },
      setStatus(...args: unknown[]) {
        calls.setStatus.push(args);
      },
    },
  };
  return { ctx, calls };
}

interface FakeTimer {
  fn: () => void;
  ms: number;
  unrefCalled: boolean;
  unref(): FakeTimer;
}

function fakeTimers() {
  const created: FakeTimer[] = [];
  const cleared: unknown[] = [];
  const setInterval = (fn: () => void, ms: number): FakeTimer => {
    const handle: FakeTimer = {
      fn,
      ms,
      unrefCalled: false,
      unref() {
        handle.unrefCalled = true;
        return handle;
      },
    };
    created.push(handle);
    return handle;
  };
  const clearInterval = (handle: unknown): void => {
    cleared.push(handle);
  };
  return { created, cleared, setInterval, clearInterval };
}

function mkTmp(t: { after: (fn: () => void) => void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tps-ext-"));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort test cleanup
    }
  });
  return dir;
}

function setEnv(
  t: { after: (fn: () => void) => void },
  values: Record<string, string | undefined>,
): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  t.after(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

async function triggerSessionStart(pi: MockPi, ctx: unknown): Promise<void> {
  const handlers = pi.handlers.get("session_start");
  assert.ok(
    handlers && handlers.length > 0,
    "session_start handler was registered",
  );
  for (const handler of handlers) {
    await handler({ reason: "startup" }, ctx);
  }
}

async function emit(
  pi: MockPi,
  event: string,
  payload: unknown,
  ctx: unknown,
): Promise<void> {
  for (const handler of pi.handlers.get(event) ?? []) {
    await handler(payload, ctx);
  }
}

// ---------------------------------------------------------------------------
// RED (task 8.1): role detection matrix.
// ---------------------------------------------------------------------------

test("detectRole returns the role from the full decision matrix", () => {
  const cases: Array<
    [
      { mode: string; hasUI: boolean },
      Record<string, string | undefined>,
      string,
    ]
  > = [
    [{ mode: "tui", hasUI: true }, {}, "parent-tui"],
    [{ mode: "tui", hasUI: false }, {}, "parent-tui"],
    [
      { mode: "tui", hasUI: true },
      { GENTLE_PI_AGENTS_CHILD: "1", PI_TPS_DIR: "/tmp/ch" },
      "gentle-worker",
    ],
    [
      { mode: "rpc", hasUI: true },
      { GENTLE_PI_AGENTS_CHILD: "1", PI_TPS_DIR: "/tmp/ch" },
      "gentle-worker",
    ],
    [
      { mode: "print", hasUI: false },
      { GENTLE_PI_AGENTS_CHILD: "1", PI_TPS_DIR: "/tmp/ch" },
      "gentle-worker",
    ],
    [
      { mode: "tui", hasUI: true },
      { GENTLE_PI_AGENTS_CHILD: "1" },
      "headless-noop",
    ],
    [
      { mode: "rpc", hasUI: true },
      { GENTLE_PI_AGENTS_CHILD: "1" },
      "headless-noop",
    ],
    [
      { mode: "rpc", hasUI: true },
      { GENTLE_PI_AGENTS_CHILD: "1", PI_TPS_DIR: "" },
      "headless-noop",
    ],
    [{ mode: "rpc", hasUI: true }, {}, "headless-noop"],
    [{ mode: "print", hasUI: false }, {}, "headless-noop"],
    [{ mode: "json", hasUI: false }, {}, "headless-noop"],
  ];

  for (const [ctx, env, expected] of cases) {
    assert.equal(
      detectRole(ctx, env),
      expected,
      `role for ${JSON.stringify(ctx)} + ${JSON.stringify(env)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// RED (task 8.1): parent role initializes tracker/stats, channel dir, timer.
// ---------------------------------------------------------------------------

test("parent role creates the channel dir, exports PI_TPS_DIR and starts an unref'd 200ms interval", (t) => {
  setEnv(t, { GENTLE_PI_AGENTS_CHILD: undefined, PI_TPS_DIR: undefined });
  const tmpDir = mkTmp(t);
  const pi = makePi();
  const { ctx, calls } = makeCtx("tui", true);
  const timers = fakeTimers();

  wireSession(pi, { ...timers, tmpDir });
  void triggerSessionStart(pi, ctx);

  const dir = process.env.PI_TPS_DIR;
  assert.ok(dir, "PI_TPS_DIR is exported");
  assert.ok(
    dir.startsWith(path.join(tmpDir, "pi-tps-")),
    "session directory lives under the fixture temp root",
  );
  assert.ok(fs.existsSync(dir), "session directory exists");
  assert.ok(fs.existsSync(path.join(dir, ".owner")), ".owner marker written");

  assert.equal(timers.created.length, 1, "exactly one render interval started");
  assert.equal(timers.created[0].ms, RENDER_INTERVAL_MS, "interval is 200 ms");
  assert.equal(timers.created[0].unrefCalled, true, "interval is unref'd");

  assert.ok(calls.setWidget.length >= 1, "widget rendered at least once");
  const last = calls.setWidget[calls.setWidget.length - 1];
  assert.equal(last.id, WIDGET_ID);
  assert.ok(
    Array.isArray(last.lines) && last.lines.length === 2,
    "header + main row rendered",
  );
  assert.ok(
    stripAnsi((last.lines as string[])[0]).startsWith("Throughput"),
    "the panel leads with the session header",
  );
  assert.deepEqual(last.options, { placement: "aboveEditor" });
});

// ---------------------------------------------------------------------------
// RED (task 8.1): worker role publishes snapshots and never calls UI.
// ---------------------------------------------------------------------------

test("worker role publishes a throttled snapshot and makes zero UI calls", (t) => {
  const tmpDir = mkTmp(t);
  const channelDir = fs.mkdtempSync(path.join(tmpDir, "channel-"));
  setEnv(t, { GENTLE_PI_AGENTS_CHILD: "1", PI_TPS_DIR: channelDir });
  const pi = makePi();
  const { ctx, calls } = makeCtx("rpc", true);
  const timers = fakeTimers();

  wireSession(pi, { ...timers });
  void triggerSessionStart(pi, ctx);

  assert.equal(timers.created.length, 0, "worker starts no render interval");

  // Significant transition flushes immediately (no waiting for the throttle).
  void emit(
    pi,
    "tool_execution_start",
    { type: "tool_execution_start", toolName: "bash" },
    ctx,
  );

  const snapshotFile = path.join(channelDir, `worker-${process.pid}.json`);
  assert.ok(
    fs.existsSync(snapshotFile),
    "snapshot published to the channel dir",
  );
  const parsed = JSON.parse(fs.readFileSync(snapshotFile, "utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(parsed.pid, process.pid);
  assert.equal(parsed.phase, "tool");
  assert.equal(parsed.activeTool, "bash");

  // agent_end unlinks the worker snapshot.
  void emit(pi, "agent_end", { type: "agent_end" }, ctx);
  assert.equal(
    fs.existsSync(snapshotFile),
    false,
    "snapshot unlinked on agent_end",
  );

  // Strict UI suppression across the entire worker lifecycle.
  assert.deepEqual(calls.setWidget, []);
  assert.deepEqual(calls.notify, []);
  assert.deepEqual(calls.confirm, []);
  assert.deepEqual(calls.setStatus, []);
});

// ---------------------------------------------------------------------------
// RED (task 8.1): headless role is a silent no-op.
// ---------------------------------------------------------------------------

test("headless role is a silent no-op that creates nothing", (t) => {
  const tmpDir = mkTmp(t);
  setEnv(t, { GENTLE_PI_AGENTS_CHILD: "1", PI_TPS_DIR: undefined });
  const pi = makePi();
  const { ctx, calls } = makeCtx("rpc", true);
  const timers = fakeTimers();

  wireSession(pi, { ...timers, tmpDir });
  void triggerSessionStart(pi, ctx);

  assert.equal(
    timers.created.length,
    0,
    "no render interval for headless role",
  );
  assert.deepEqual(calls.setWidget, []);
  assert.deepEqual(calls.notify, []);
  assert.equal(process.env.PI_TPS_DIR, undefined, "no channel dir exported");
  assert.deepEqual(fs.readdirSync(tmpDir), [], "no files created");
});

// ---------------------------------------------------------------------------
// TRIANGULATE (task 8.3): lifecycle and exact-panel composition.
// ---------------------------------------------------------------------------

test("session_shutdown clears the timer, widget, and session directory", async (t) => {
  setEnv(t, { GENTLE_PI_AGENTS_CHILD: undefined, PI_TPS_DIR: undefined });
  const tmpDir = mkTmp(t);
  const pi = makePi();
  const { ctx, calls } = makeCtx("tui", true);
  const timers = fakeTimers();

  wireSession(pi, { ...timers, tmpDir });
  await triggerSessionStart(pi, ctx);

  const dir = process.env.PI_TPS_DIR;
  assert.ok(dir);
  assert.equal(timers.created.length, 1);
  assert.ok(fs.existsSync(dir));

  await emit(pi, "session_shutdown", { reason: "quit" }, ctx);

  assert.equal(timers.cleared.length, 1, "interval cleared once");
  assert.equal(
    timers.cleared[0],
    timers.created[0],
    "the started interval is cleared",
  );
  assert.equal(fs.existsSync(dir), false, "session directory removed");
  assert.equal(process.env.PI_TPS_DIR, undefined, "channel dir unexported");

  const last = calls.setWidget[calls.setWidget.length - 1];
  assert.equal(last.id, WIDGET_ID);
  assert.equal(last.lines, undefined, "widget cleared");
});

test("worker RPC stream stays free of widget or other UI output across every event", async (t) => {
  const tmpDir = mkTmp(t);
  const channelDir = fs.mkdtempSync(path.join(tmpDir, "channel-"));
  setEnv(t, { GENTLE_PI_AGENTS_CHILD: "1", PI_TPS_DIR: channelDir });
  const pi = makePi();
  const { ctx, calls } = makeCtx("rpc", true);

  wireSession(pi, { ...fakeTimers() });
  await triggerSessionStart(pi, ctx);

  const events = [
    { type: "message_start", message: { role: "assistant" } },
    {
      type: "message_update",
      message: { role: "assistant", usage: { output: 1 } },
    },
    {
      type: "message_end",
      message: { role: "assistant", usage: { output: 8 } },
    },
    { type: "tool_execution_start", toolName: "read" },
    { type: "tool_execution_end" },
    { type: "model_select", model: { id: "claude-3-5-haiku" } },
    { type: "thinking_level_select", level: "low" },
  ];
  for (const event of events) {
    await emit(pi, event.type, event, ctx);
  }
  await emit(pi, "agent_end", { type: "agent_end" }, ctx);

  assert.deepEqual(calls.setWidget, []);
  assert.deepEqual(calls.notify, []);
  assert.deepEqual(calls.confirm, []);
  assert.deepEqual(calls.setStatus, []);
});

test("worker with a missing channel directory stays silent and creates no files", async (t) => {
  const tmpDir = mkTmp(t);
  const missingDir = path.join(tmpDir, "does-not-exist");
  setEnv(t, { GENTLE_PI_AGENTS_CHILD: "1", PI_TPS_DIR: missingDir });
  const pi = makePi();
  const { ctx, calls } = makeCtx("rpc", true);
  const timers = fakeTimers();

  wireSession(pi, { ...timers });
  await triggerSessionStart(pi, ctx);

  assert.equal(timers.created.length, 0);
  assert.deepEqual(calls.setWidget, []);
  assert.equal(fs.existsSync(missingDir), false, "missing dir was not created");
  assert.deepEqual(
    fs.readdirSync(tmpDir),
    [],
    "no files created in the temp root",
  );
});

test("render tick composes exactly the panel (header + rows) from tracker and correlation state", async (t) => {
  setEnv(t, { GENTLE_PI_AGENTS_CHILD: undefined, PI_TPS_DIR: undefined });
  const tmpDir = mkTmp(t);
  const width = 160;
  const prevColumns = process.stdout.columns;
  process.stdout.columns = width;
  t.after(() => {
    process.stdout.columns = prevColumns;
  });

  const pi = makePi();
  const { ctx, calls } = makeCtx("tui", true);
  const timers = fakeTimers();

  // One shared, fully controlled clock, advanced only between events. The
  // extension's internal tracker and the parallel expected-value tracker observe
  // identical timestamps, so a completed turn can never straddle a millisecond
  // boundary on one side only (the pre-existing flake this test pins).
  let clockMs = 1_000;
  const clock = (): number => clockMs;

  wireSession(pi, { ...timers, tmpDir, now: clock });
  await triggerSessionStart(pi, ctx);
  const dir = process.env.PI_TPS_DIR;
  assert.ok(dir);

  // Replay the identical events into a parallel tracker to build the expected stats.
  const parallel = new EventTracker({ now: clock });
  const events = [
    { type: "message_start", message: { role: "assistant" } },
    {
      type: "message_update",
      message: { role: "assistant", usage: { output: 4 } },
      assistantMessageEvent: { type: "text_delta", delta: "abcd" },
    },
    {
      type: "message_end",
      message: { role: "assistant", usage: { output: 4 } },
    },
    { type: "tool_execution_start", toolName: "read" },
  ];
  for (const event of events) {
    clockMs += 10;
    await emit(pi, event.type, event, ctx);
    parallel.handle(event);
  }

  // One live (unmatched) worker snapshot, keyed to this process PID so liveness is deterministic.
  const workerFile = path.join(dir, `worker-${process.pid}.json`);
  fs.writeFileSync(
    workerFile,
    JSON.stringify({
      v: 1,
      pid: process.pid,
      workerId: "worker-test",
      startTime: Date.now(),
      updatedAt: Date.now(),
      phase: "streaming",
      model: "claude-3-5-haiku",
      tps: 24.1,
      messageTokens: 12,
      totalTokens: 1400,
    }),
  );

  timers.created[0].fn();

  const snap = parallel.snapshot();
  const stats = parallel.sessionStats();
  const expectedStats = {
    tps: snap.tps,
    mean: stats.mean,
    p95: stats.p95,
    sparkline: stats.sparkline,
    model: snap.model,
    thinkingLevel: snap.thinkingLevel,
    phase: snap.phase,
    activeTool: snap.activeTool,
    totalTokens: snap.totalTokens,
  };
  const expectedRows = new CorrelationEngine().correlate(
    readWorkerSnapshots(dir),
  );
  const expected = renderPanel(expectedStats, expectedRows, width);

  const last = calls.setWidget[calls.setWidget.length - 1];
  assert.equal(last.id, WIDGET_ID);
  assert.deepEqual(last.lines, expected);
  assert.deepEqual(last.options, { placement: "aboveEditor" });

  // The panel leads with the session header, then the main row, then the workers.
  const panel = last.lines as string[];
  const headerLine = stripAnsi(panel[0]);
  assert.ok(headerLine.startsWith("Throughput"), headerLine);
  assert.ok(headerLine.includes("2 active"), "main agent + one worker");
  assert.ok(headerLine.includes("1 streaming"), "the worker is streaming");

  // The wired main row carries the WU-1 anatomy: phase icon plus session tokens.
  const mainLine = stripAnsi(panel[1]);
  assert.ok(mainLine.startsWith("◇ Main [tool: read]"), mainLine);
  assert.ok(
    mainLine.includes(`· ${formatTokens(snap.totalTokens)}`),
    "main row shows the session token total",
  );

  // The uncorrelated worker row stays honest: fallback name, no badge, metrics kept.
  const workerLine = stripAnsi(panel[2]);
  assert.ok(workerLine.startsWith("└─ ⠴ subagent · "), workerLine);
  assert.ok(workerLine.includes("(claude-3-5-haiku)"), "model still shown");
  assert.ok(
    workerLine.includes("· 1.4k tok"),
    "worker token total still shown",
  );
});

// ---------------------------------------------------------------------------
// RED (bugfix): session-start model/thinking seeding.
//
// Pi resolves the model and thinking level before the session begins and exposes
// both on `ctx`, but it emits no initial `model_select`/`thinking_level_select`.
// The tracker therefore started empty, so the first parent render and the first
// worker snapshot omitted `provider/model:thinking` until the user changed one.
// ---------------------------------------------------------------------------

/** Builds a session context carrying the model/thinking Pi already resolved. */
function seededCtx<T extends object>(
  ctx: T,
  model: { provider: string; id: string } | undefined,
  thinkingLevel: string | undefined,
): T & { model?: { provider: string; id: string }; thinkingLevel?: string } {
  return { ...ctx, model, thinkingLevel };
}

test("parent session_start seeds provider/model:thinking into the first rendered row", async (t) => {
  setEnv(t, { GENTLE_PI_AGENTS_CHILD: undefined, PI_TPS_DIR: undefined });
  const tmpDir = mkTmp(t);
  const width = 120;
  const prevColumns = process.stdout.columns;
  process.stdout.columns = width;
  t.after(() => {
    process.stdout.columns = prevColumns;
  });

  const pi = makePi();
  const { ctx, calls } = makeCtx("tui", true);
  const seeded = seededCtx(
    ctx,
    { provider: "anthropic", id: "claude-3-5-haiku" },
    "low",
  );

  // Fully controlled clock: the seed must not depend on event timing.
  const clockMs = 1_000;
  const clock = (): number => clockMs;
  wireSession(pi, { ...fakeTimers(), tmpDir, now: clock });
  await triggerSessionStart(pi, seeded);

  // No model_select / thinking_level_select was emitted before the first render.
  assert.ok(calls.setWidget.length >= 1, "widget rendered on session start");
  const first = calls.setWidget[0];
  assert.equal(first.id, WIDGET_ID);
  const mainLine = stripAnsi((first.lines as string[])[1]);
  assert.ok(
    mainLine.includes("(anthropic/claude-3-5-haiku:low)"),
    `first main row carries the seeded model: ${mainLine}`,
  );
});

test("worker session_start seeds model and thinking into the first published snapshot", async (t) => {
  const tmpDir = mkTmp(t);
  const channelDir = fs.mkdtempSync(path.join(tmpDir, "channel-"));
  setEnv(t, { GENTLE_PI_AGENTS_CHILD: "1", PI_TPS_DIR: channelDir });
  const pi = makePi();
  const { ctx, calls } = makeCtx("rpc", true);
  const seeded = seededCtx(ctx, { provider: "openai", id: "gpt-5" }, "high");

  wireSession(pi, { ...fakeTimers() });
  await triggerSessionStart(pi, seeded);

  // No model_select emitted: the first significant transition publishes the seed.
  await emit(
    pi,
    "tool_execution_start",
    { type: "tool_execution_start", toolName: "bash" },
    seeded,
  );

  const snapshotFile = path.join(channelDir, `worker-${process.pid}.json`);
  assert.ok(fs.existsSync(snapshotFile), "snapshot published");
  const parsed = JSON.parse(fs.readFileSync(snapshotFile, "utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(parsed.model, "openai/gpt-5");
  assert.equal(parsed.thinkingLevel, "high");

  // The RPC worker still writes nothing to the UI.
  assert.deepEqual(calls.setWidget, []);
  assert.deepEqual(calls.notify, []);
  assert.deepEqual(calls.confirm, []);
  assert.deepEqual(calls.setStatus, []);

  await emit(pi, "agent_end", { type: "agent_end" }, seeded);
});

test("later model_select and thinking_level_select override the session-start seed", async (t) => {
  const tmpDir = mkTmp(t);
  const channelDir = fs.mkdtempSync(path.join(tmpDir, "channel-"));
  setEnv(t, { GENTLE_PI_AGENTS_CHILD: "1", PI_TPS_DIR: channelDir });
  const pi = makePi();
  const { ctx } = makeCtx("rpc", true);
  const seeded = seededCtx(
    ctx,
    { provider: "anthropic", id: "claude-3-5-haiku" },
    "low",
  );

  wireSession(pi, { ...fakeTimers() });
  await triggerSessionStart(pi, seeded);

  await emit(
    pi,
    "model_select",
    { type: "model_select", model: { provider: "openai", id: "gpt-5" } },
    seeded,
  );
  await emit(
    pi,
    "thinking_level_select",
    { type: "thinking_level_select", level: "high" },
    seeded,
  );
  await emit(
    pi,
    "tool_execution_start",
    { type: "tool_execution_start", toolName: "read" },
    seeded,
  );

  const snapshotFile = path.join(channelDir, `worker-${process.pid}.json`);
  const parsed = JSON.parse(fs.readFileSync(snapshotFile, "utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(parsed.model, "openai/gpt-5", "later model_select wins");
  assert.equal(
    parsed.thinkingLevel,
    "high",
    "later thinking_level_select wins",
  );

  await emit(pi, "agent_end", { type: "agent_end" }, seeded);
});

test("parent session without ctx model or thinking renders no model segment", async (t) => {
  setEnv(t, { GENTLE_PI_AGENTS_CHILD: undefined, PI_TPS_DIR: undefined });
  const tmpDir = mkTmp(t);
  const prevColumns = process.stdout.columns;
  process.stdout.columns = 120;
  t.after(() => {
    process.stdout.columns = prevColumns;
  });

  const pi = makePi();
  const { ctx, calls } = makeCtx("tui", true);

  wireSession(pi, { ...fakeTimers(), tmpDir });
  await triggerSessionStart(pi, ctx);

  const mainLine = stripAnsi((calls.setWidget[0].lines as string[])[1]);
  assert.ok(mainLine.includes("· Main"), mainLine);
  assert.equal(
    mainLine.includes("("),
    false,
    `no model segment without ctx.model: ${mainLine}`,
  );
});

test("worker session without ctx model or thinking publishes no model keys", async (t) => {
  const tmpDir = mkTmp(t);
  const channelDir = fs.mkdtempSync(path.join(tmpDir, "channel-"));
  setEnv(t, { GENTLE_PI_AGENTS_CHILD: "1", PI_TPS_DIR: channelDir });
  const pi = makePi();
  const { ctx } = makeCtx("rpc", true);

  wireSession(pi, { ...fakeTimers() });
  await triggerSessionStart(pi, ctx);
  await emit(
    pi,
    "tool_execution_start",
    { type: "tool_execution_start", toolName: "bash" },
    ctx,
  );

  const snapshotFile = path.join(channelDir, `worker-${process.pid}.json`);
  const parsed = JSON.parse(fs.readFileSync(snapshotFile, "utf8")) as Record<
    string,
    unknown
  >;
  assert.equal("model" in parsed, false);
  assert.equal("thinkingLevel" in parsed, false);

  await emit(pi, "agent_end", { type: "agent_end" }, ctx);
});
