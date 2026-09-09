import { test } from "node:test";
import assert from "node:assert/strict";

import {
  breakpointFor,
  renderMainRow,
  renderPanel,
  renderSubagentRow,
} from "../src/render.ts";
import { formatGauge, formatSparkline } from "../src/graphics.ts";
import { stripAnsi } from "../src/format.ts";

/** Visible (ANSI-stripped) text for presence/absence assertions. */
const vis = (line: string): string => stripAnsi(line);

const MAIN = {
  tps: 42.5,
  mean: 38.2,
  p95: 51.0,
  sparkline: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  model: "claude-3-7-sonnet",
};

const SCOUT = {
  badge: "scout",
  tps: 24.1,
  phase: "tool",
  activeTool: "read",
  tokens: 1400,
  model: "claude-3-5-haiku",
};

// ---------------------------------------------------------------------------
// Responsive breakpoint classification
// ---------------------------------------------------------------------------

test("breakpointFor classifies wide / standard / narrow at exact boundaries", () => {
  assert.equal(breakpointFor(160), "wide");
  assert.equal(breakpointFor(120), "wide");
  assert.equal(breakpointFor(119), "standard");
  assert.equal(breakpointFor(80), "standard");
  assert.equal(breakpointFor(79), "narrow");
  assert.equal(breakpointFor(60), "narrow");
});

test("breakpointFor clamps sub-minimum widths to the 60-column floor", () => {
  assert.equal(breakpointFor(40), "narrow");
});

// ---------------------------------------------------------------------------
// Main-agent row
// ---------------------------------------------------------------------------

test("wide main row renders gauge + rate + sparkline + μ + p95 + model", () => {
  const line = renderMainRow(MAIN, 160);
  assert.ok(line.includes(formatGauge(42.5, 16)), "16-cell gauge");
  assert.ok(line.includes(formatSparkline(MAIN.sparkline)), "sparkline");
  assert.ok(vis(line).includes("42.5 tok/s"), "live rate");
  assert.ok(vis(line).includes("μ 38.2"), "session mean");
  assert.ok(vis(line).includes("p95 51.0"), "streaming p95");
  assert.ok(vis(line).includes("(claude-3-7-sonnet)"), "model label");
});

test("tool-phase main row renders the Main [tool: <name>] variant", () => {
  const line = renderMainRow(
    { ...MAIN, phase: "tool", activeTool: "bash" },
    160,
  );
  assert.ok(line.startsWith("Main [tool: bash]"));
});

// ---------------------------------------------------------------------------
// Subagent rows
// ---------------------------------------------------------------------------

test("badge bearer uses the tree prefix and shows phase/tool, tokens, model", () => {
  const intermediate = renderSubagentRow({ ...SCOUT }, false, 160);
  assert.ok(intermediate.startsWith("├─ scout"));
  assert.ok(vis(intermediate).includes("tool: read"));
  assert.ok(vis(intermediate).includes("1.4k tok"));
  assert.ok(vis(intermediate).includes("(claude-3-5-haiku)"));

  const terminal = renderSubagentRow({ ...SCOUT }, true, 160);
  assert.ok(terminal.startsWith("└─ scout"));
});

test("honest fallback yields subagent · <pid> and bare subagent", () => {
  const withPid = renderSubagentRow(
    { tps: 10, phase: "streaming", tokens: 500, pid: 4242 },
    false,
    160,
  );
  assert.ok(withPid.startsWith("├─ subagent · 4242"));
  assert.ok(vis(withPid).includes("streaming"));

  const noPid = renderSubagentRow(
    { tps: 1, phase: "waiting", tokens: 0 },
    true,
    160,
  );
  assert.ok(noPid.startsWith("└─ subagent"));
});

// ---------------------------------------------------------------------------
// Documented field hiding per breakpoint
// ---------------------------------------------------------------------------

test("standard main row hides the model and keeps mean + p95", () => {
  const line = renderMainRow(MAIN, 100);
  assert.ok(vis(line).includes("μ 38.2"));
  assert.ok(vis(line).includes("p95 51.0"));
  assert.ok(!vis(line).includes("claude-3-7-sonnet"));
});

test("narrow main row hides mean/p95/model and uses an 8-cell gauge", () => {
  const line = renderMainRow(MAIN, 60);
  assert.ok(!vis(line).includes("μ 38.2"));
  assert.ok(!vis(line).includes("p95 51.0"));
  assert.ok(!vis(line).includes("claude-3-7-sonnet"));
  assert.ok(line.includes(formatGauge(42.5, 8)));
});

test("standard subagent row hides the model and keeps tokens", () => {
  const line = renderSubagentRow({ ...SCOUT }, false, 100);
  assert.ok(vis(line).includes("1.4k tok"));
  assert.ok(!vis(line).includes("claude-3-5-haiku"));
});

test("narrow subagent row hides tokens/model and keeps tool state", () => {
  const line = renderSubagentRow({ ...SCOUT }, false, 60);
  assert.ok(vis(line).includes("tool: read"));
  assert.ok(!vis(line).includes("1.4k tok"));
  assert.ok(!vis(line).includes("claude-3-5-haiku"));
});

// ---------------------------------------------------------------------------
// Width safety: every emitted line fits the terminal
// ---------------------------------------------------------------------------

test("every panel line satisfies stripAnsi(line).length <= cols at 60/80/120/160", () => {
  const rows = [
    { ...SCOUT },
    { tps: 58, phase: "streaming", tokens: 3200, model: "claude-3-7-sonnet" },
  ];
  for (const cols of [60, 80, 120, 160]) {
    const lines = renderPanel(MAIN, rows, cols);
    assert.equal(lines.length, 3, "one main row + two worker rows");
    for (const line of lines) {
      assert.ok(
        stripAnsi(line).length <= cols,
        `line exceeds ${cols} cols: ${vis(line)}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Triangulation: determinism and width-adversarial inputs
// ---------------------------------------------------------------------------

test("panel output is byte-identical across repeated renders at each breakpoint", () => {
  const rows = [{ ...SCOUT }, { tps: 58, phase: "streaming", tokens: 3200 }];
  for (const cols of [60, 80, 120, 160]) {
    const first = renderPanel(MAIN, rows, cols).join("\n");
    const second = renderPanel(MAIN, rows, cols).join("\n");
    assert.equal(first, second, `layout unstable at ${cols} cols`);
  }
});

test("maximally long sanitized labels still clamp within 60 columns", () => {
  const hostileBadge = renderSubagentRow(
    { badge: "x".repeat(100), tps: 5, phase: "streaming", tokens: 0 },
    false,
    60,
  );
  assert.ok(stripAnsi(hostileBadge).length <= 60);

  const hostileTool = renderMainRow(
    { ...MAIN, phase: "tool", activeTool: "bash".repeat(40) },
    60,
  );
  assert.ok(stripAnsi(hostileTool).length <= 60);

  const fallen = renderSubagentRow(
    {
      badge: "y".repeat(100),
      tps: 5,
      phase: "tool",
      activeTool: "read",
      tokens: 0,
    },
    false,
    60,
  );
  assert.ok(stripAnsi(fallen).length <= 60);
});

test("zero-worker renders exactly one line; many-worker renders fit", () => {
  const zero = renderPanel(MAIN, [], 80);
  assert.equal(zero.length, 1);
  assert.ok(stripAnsi(zero[0]).length <= 80);

  const many = Array.from({ length: 12 }, (_, i) => ({
    tps: 20 + i,
    phase: "waiting",
    tokens: i * 100,
  }));
  const lines = renderPanel(MAIN, many, 80);
  assert.equal(lines.length, 13);
  for (const line of lines) {
    assert.ok(stripAnsi(line).length <= 80);
  }
});

test("layout decisions stay stable across repeats of the same inputs", () => {
  const row = { tps: 5, phase: "tool", activeTool: "read", tokens: 0 };
  assert.equal(
    renderSubagentRow(row, true, 60),
    renderSubagentRow(row, true, 60),
  );
  assert.equal(
    renderSubagentRow(row, true, 160),
    renderSubagentRow(row, true, 160),
  );
});
