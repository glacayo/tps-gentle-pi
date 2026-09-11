// Vanilla Pi fallback and degradation integration tests for the TPS meter.
//
// These tests exercise the fully-wired extension through a mocked Pi API and a
// fixture temp root, confirming the contracts that matter when gentle-pi is
// absent or its children never load the extension: the main-agent meter stays
// fully functional, no subagent rows are fabricated, channel/aggregation
// failures degrade silently, and no gentle-pi module is referenced at runtime.
// They also assert the package's documentation and MIT license artifacts.
//
// Node 24 executes this file directly via native type stripping.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { stripAnsi } from "../src/format.ts";
import { WIDGET_ID, wireSession } from "../extensions/index.ts";

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
}

function makeCtx(mode: string) {
  const calls: WidgetCall[] = [];
  const ctx = {
    mode,
    hasUI: mode === "tui",
    ui: {
      setWidget(id: string, lines: string[] | undefined) {
        calls.push({ id, lines });
      },
    },
  };
  return { ctx, calls };
}

interface FakeTimer {
  fn: () => void;
  unref(): FakeTimer;
}

function fakeTimers() {
  const created: FakeTimer[] = [];
  const setInterval = (fn: () => void): FakeTimer => {
    const handle: FakeTimer = {
      fn,
      unref() {
        return handle;
      },
    };
    created.push(handle);
    return handle;
  };
  return { created, setInterval, clearInterval: () => {} };
}

function mkTmp(t: { after: (fn: () => void) => void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tps-fallback-"));
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

function setColumns(
  t: { after: (fn: () => void) => void },
  width: number,
): void {
  const prev = process.stdout.columns;
  process.stdout.columns = width;
  t.after(() => {
    process.stdout.columns = prev;
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

/** A short real-clock delay so streaming deltas span a measurable, positive time. */
function delay(ms = 5): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Emits a complete assistant streaming turn that finalizes authoritative usage. */
async function emitStreamingTurn(pi: MockPi, ctx: unknown): Promise<void> {
  await emit(
    pi,
    "message_start",
    { type: "message_start", message: { role: "assistant" } },
    ctx,
  );
  await delay();
  await emit(
    pi,
    "message_update",
    {
      type: "message_update",
      message: { role: "assistant", usage: { output: 4 } },
      assistantMessageEvent: { type: "text_delta", delta: "abcd" },
    },
    ctx,
  );
  await delay();
  await emit(
    pi,
    "message_update",
    {
      type: "message_update",
      message: { role: "assistant", usage: { output: 8 } },
      assistantMessageEvent: { type: "text_delta", delta: "efgh" },
    },
    ctx,
  );
  await delay();
  await emit(
    pi,
    "message_end",
    {
      type: "message_end",
      message: { role: "assistant", usage: { output: 8 } },
    },
    ctx,
  );
}

interface ParentFixture {
  pi: MockPi;
  ctx: unknown;
  calls: WidgetCall[];
  timers: ReturnType<typeof fakeTimers>;
}

async function startParent(
  t: { after: (fn: () => void) => void },
  tmpDir: string,
): Promise<ParentFixture> {
  setEnv(t, { GENTLE_PI_AGENTS_CHILD: undefined, PI_TPS_DIR: undefined });
  const pi = makePi();
  const { ctx, calls } = makeCtx("tui");
  const timers = fakeTimers();
  wireSession(pi, { ...timers, tmpDir });
  await triggerSessionStart(pi, ctx);
  return { pi, ctx, calls, timers };
}

function lastPanel(fixture: ParentFixture): string[] {
  const last = fixture.calls[fixture.calls.length - 1];
  assert.equal(last.id, WIDGET_ID);
  assert.ok(Array.isArray(last.lines), "panel lines are an array");
  return last.lines as string[];
}

// ---------------------------------------------------------------------------
// 9.1 RED: vanilla fallback and degradation integration tests.
// ---------------------------------------------------------------------------

test("vanilla Pi parent renders zero subagent rows while the main meter works", async (t) => {
  const tmpDir = mkTmp(t);
  setColumns(t, 120);
  const fixture = await startParent(t, tmpDir);

  const baseline = lastPanel(fixture);
  assert.equal(baseline.length, 2, "header + main row, no subagent rows");
  assert.ok(
    stripAnsi(baseline[0]).startsWith("Throughput"),
    "the session header is always present",
  );
  assert.ok(stripAnsi(baseline[1]).startsWith("· Main"), "main row present");

  await emitStreamingTurn(fixture.pi, fixture.ctx);
  fixture.timers.created[0].fn();

  const lines = lastPanel(fixture);
  assert.equal(lines.length, 2, "still zero subagent rows after streaming");
  const header = stripAnsi(lines[0]);
  const main = stripAnsi(lines[1]);
  assert.ok(header.startsWith("Throughput"), "session header present");
  assert.ok(header.includes("μ"), "session mean present");
  assert.ok(header.includes("p95"), "p95 present");
  assert.ok(main.startsWith("· Main"), "main-agent label present");
  assert.ok(main.includes("tok/s"), "live rate present");
  assert.ok(
    stripAnsi(baseline[1]) !== main,
    "the main row updates after streaming",
  );
});

test("one-off pi -e parent does not fabricate subagent rows", async (t) => {
  const tmpDir = mkTmp(t);
  setColumns(t, 120);
  const fixture = await startParent(t, tmpDir);

  const channelDir = process.env.PI_TPS_DIR;
  assert.ok(channelDir, "parent still creates its channel directory");

  // Workers never loaded the extension (pi -e is not propagated to children),
  // so no worker snapshot is ever written into the channel directory.
  assert.deepEqual(
    fs.readdirSync(channelDir).filter((entry) => entry.startsWith("worker-")),
    [],
    "no worker snapshots were published by children",
  );

  await emitStreamingTurn(fixture.pi, fixture.ctx);
  fixture.timers.created[0].fn();

  const lines = lastPanel(fixture);
  assert.equal(lines.length, 2, "header + main row; no subagent rows appear");
  assert.ok(
    stripAnsi(lines[0]).startsWith("Throughput"),
    "the session header still renders",
  );
  assert.ok(stripAnsi(lines[1]).includes("Main"), "main panel still works");
});

test("failed channel directory creation still initializes the main widget", async (t) => {
  const tmpDir = mkTmp(t);
  // A temp path that is a regular file makes directory creation fail (ENOTDIR).
  const fileRoot = path.join(tmpDir, "not-a-dir");
  fs.writeFileSync(fileRoot, "file");
  setColumns(t, 120);

  const fixture = await startParent(t, fileRoot);

  assert.equal(
    process.env.PI_TPS_DIR,
    undefined,
    "no channel dir was exported",
  );
  assert.equal(
    fixture.timers.created.length,
    1,
    "render interval still started",
  );

  fixture.timers.created[0].fn();
  const lines = lastPanel(fixture);
  assert.equal(lines.length, 2, "header + main row; subagent rows absent");
  assert.ok(stripAnsi(lines[0]).includes("Throughput"), "header present");
  assert.ok(stripAnsi(lines[1]).includes("Main"), "main widget initialized");
});

test("aggregation failure during a refresh keeps the main panel updating", async (t) => {
  const tmpDir = mkTmp(t);
  setColumns(t, 120);
  const fixture = await startParent(t, tmpDir);

  const channelDir = process.env.PI_TPS_DIR;
  assert.ok(channelDir);

  await emitStreamingTurn(fixture.pi, fixture.ctx);
  fixture.timers.created[0].fn();
  const before = lastPanel(fixture)[1];

  // Remove the channel directory so the next aggregation read fails (ENOENT).
  fs.rmSync(channelDir, { recursive: true, force: true });

  await emitStreamingTurn(fixture.pi, fixture.ctx);
  fixture.timers.created[0].fn();

  const lines = lastPanel(fixture);
  assert.equal(lines.length, 2, "subagent rows degrade to absent");
  assert.ok(
    stripAnsi(lines[0]).startsWith("Throughput"),
    "header still renders",
  );
  assert.ok(stripAnsi(lines[1]).includes("Main"), "main panel still renders");
  assert.ok(
    stripAnsi(lines[1]) !== stripAnsi(before),
    "main panel keeps updating despite the aggregation failure",
  );
});

test("no gentle-pi module is imported or referenced at runtime anywhere in the package", () => {
  const repoRoot = process.cwd();
  const sourceFiles = ["src", "extensions"].flatMap((dir) =>
    fs
      .readdirSync(path.join(repoRoot, dir))
      .filter((entry) => entry.endsWith(".ts"))
      .map((entry) => path.join(dir, entry)),
  );

  const runtimeReference = /["']gentle-pi["']/;
  for (const file of sourceFiles) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    assert.ok(
      !runtimeReference.test(source),
      `${file} must not reference the gentle-pi module`,
    );
  }

  const pkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  const depKeys = [
    ...Object.keys((pkg.dependencies as Record<string, unknown>) ?? {}),
    ...Object.keys((pkg.devDependencies as Record<string, unknown>) ?? {}),
    ...Object.keys((pkg.peerDependencies as Record<string, unknown>) ?? {}),
  ];
  assert.ok(
    !depKeys.some((key) => /gentle-pi/i.test(key)),
    "no gentle-pi dependency is declared",
  );
});

// ---------------------------------------------------------------------------
// 9.2 GREEN: documentation and license artifacts (fail until authored).
// ---------------------------------------------------------------------------

function readRepoFile(relPath: string): string | null {
  const abs = path.join(process.cwd(), relPath);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

test("README.md documents installation, vanilla fallback, privacy, platforms, and troubleshooting", () => {
  const readme = readRepoFile("README.md");
  assert.ok(readme !== null, "README.md exists");
  assert.ok(readme.length > 0, "README.md is not empty");

  const topics = [
    "npm:tps-gentle-pi",
    "vanilla",
    "fallback",
    "temporary",
    "privacy",
    "Linux",
    "macOS",
    "Windows",
    "troubleshoot",
    "telemetry",
  ];
  for (const topic of topics) {
    assert.ok(
      readme.toLocaleLowerCase().includes(topic.toLocaleLowerCase()),
      `README covers "${topic}"`,
    );
  }
});

test("LICENSE is the MIT license", () => {
  const license = readRepoFile("LICENSE");
  assert.ok(license !== null, "LICENSE exists");
  assert.ok(/MIT/i.test(license), "LICENSE identifies the MIT license");
});

test("README install instructions match actual package.json metadata", () => {
  const readme = readRepoFile("README.md");
  assert.ok(readme !== null, "README.md exists");
  const pkg = JSON.parse(readRepoFile("package.json") ?? "{}") as {
    name?: string;
    pi?: { extensions?: string[] };
    keywords?: unknown;
  };

  assert.ok(pkg.name, "package.json declares a name");
  assert.ok(readme.includes(pkg.name as string), `README names ${pkg.name}`);
  assert.ok(
    readme.includes(`npm:${pkg.name}`),
    "README install command uses the actual package name",
  );

  assert.deepEqual(
    pkg.pi?.extensions,
    ["./extensions"],
    'pi.extensions must be the array ["./extensions"] so Pi discovers and loads it',
  );

  assert.ok(
    readme.includes("./extensions"),
    "README documents the pi manifest target ./extensions",
  );

  const keywords = Array.isArray(pkg.keywords) ? pkg.keywords : [];
  assert.ok(
    keywords.includes("pi-package"),
    "package.json declares the pi-package keyword",
  );
  assert.ok(
    readme.toLocaleLowerCase().includes("pi-package"),
    "README mentions the pi-package discovery keyword",
  );
});

test("package.json files allowlist ships only runtime/public artifacts", () => {
  const pkg = JSON.parse(readRepoFile("package.json") ?? "{}") as {
    files?: unknown;
  };

  assert.ok(
    Array.isArray(pkg.files),
    "package.json declares a files allowlist",
  );

  const allowlist = (pkg.files as string[]).slice().sort();
  const expected = [
    "LICENSE",
    "README.md",
    "docs/images/",
    "extensions/",
    "src/",
  ].sort();

  assert.deepEqual(
    allowlist,
    expected,
    "public package allowlist contains only runtime/public artifacts",
  );

  for (const excluded of ["openspec/", "test/", ".pi/"]) {
    assert.ok(
      !allowlist.includes(excluded),
      `allowlist must not ship ${excluded}`,
    );
  }
});

// --------------------------------------------------------------------------
// 9.3 TRIANGULATE: residual degradation under evicted and repeated failures.
// --------------------------------------------------------------------------

function writeWorkerSnapshot(
  dir: string,
  snapshot: Record<string, unknown>,
): void {
  const pid = snapshot.pid as number;
  fs.writeFileSync(
    path.join(dir, `worker-${pid}.json`),
    JSON.stringify(snapshot),
  );
}

function baseSnapshot(
  pid: number,
  phase: string,
  updatedAt = Date.now(),
): Record<string, unknown> {
  return {
    v: 1,
    pid,
    workerId: `worker-${pid}`,
    startTime: updatedAt - 1000,
    updatedAt,
    phase,
    tps: 42.5,
    messageTokens: 12,
    totalTokens: 120,
  };
}

test("stale/dead worker snapshots evicted by the parent disappear from the panel on the next tick", async (t) => {
  const tmpDir = mkTmp(t);
  setColumns(t, 120);
  const fixture = await startParent(t, tmpDir);
  const channelDir = process.env.PI_TPS_DIR;
  assert.ok(channelDir);

  // A completed worker and a dead (bogus PID) worker must both be evicted.
  writeWorkerSnapshot(channelDir, baseSnapshot(process.pid, "complete"));
  const deadPid = 999_999;
  writeWorkerSnapshot(channelDir, baseSnapshot(deadPid, "streaming"));

  fixture.timers.created[0].fn();

  const lines = lastPanel(fixture);
  assert.equal(
    lines.length,
    2,
    "header + main; no row for either evicted worker",
  );
  assert.ok(stripAnsi(lines[1]).includes("Main"), "main panel still renders");
  assert.ok(
    !stripAnsi(lines[1]).includes("subagent"),
    "no fabricated worker row",
  );
  assert.ok(
    !fs.existsSync(path.join(channelDir, `worker-${process.pid}.json`)),
    "completed worker snapshot was removed",
  );
  assert.ok(
    !fs.existsSync(path.join(channelDir, `worker-${deadPid}.json`)),
    "dead worker snapshot was removed",
  );
});

test("repeated failed aggregation attempts across many ticks never degrade the main panel", async (t) => {
  const tmpDir = mkTmp(t);
  setColumns(t, 120);
  const fixture = await startParent(t, tmpDir);
  const channelDir = process.env.PI_TPS_DIR;
  assert.ok(channelDir);

  const tickCountBefore = fixture.calls.length;
  fs.rmSync(channelDir, { recursive: true, force: true });

  for (let i = 0; i < 5; i++) {
    await emitStreamingTurn(fixture.pi, fixture.ctx);
    fixture.timers.created[0].fn();
    const lines = lastPanel(fixture);
    assert.equal(
      lines.length,
      2,
      `tick ${i}: header + main; subagent rows stay absent`,
    );
    assert.ok(
      stripAnsi(lines[0]).startsWith("Throughput"),
      `tick ${i}: header keeps rendering`,
    );
    assert.ok(
      stripAnsi(lines[1]).includes("Main"),
      `tick ${i}: main panel keeps rendering`,
    );
  }

  assert.equal(
    fixture.calls.length,
    tickCountBefore + 5,
    "every failed-aggregation tick still refreshed the widget",
  );
});
