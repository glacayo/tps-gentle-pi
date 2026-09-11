import { test } from "node:test";
import assert from "node:assert/strict";

import {
  breakpointFor,
  phaseIcon,
  renderHeader,
  renderMainRow,
  renderPanel,
  renderSubagentRow,
} from "../src/render.ts";
import { formatGauge, formatSparkline } from "../src/graphics.ts";
import { ANSI_MUTED, ANSI_RESET, stripAnsi } from "../src/format.ts";

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

/** The removed render-contract field, kept to prove task text is never drawn. */
type StaleLabelRow = Parameters<typeof renderSubagentRow>[0] & {
  label?: string;
};

const TRACK = "·";

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
// Session header line
// ---------------------------------------------------------------------------

test("header renders identity, last, mean, p95, active, and the panel rate total", () => {
  const line = vis(renderHeader(MAIN, [], 160));
  assert.equal(
    line,
    `Throughput ${formatSparkline(MAIN.sparkline)}  12.0 tok/s  μ 38.2  p95 51.0  1 active  42.5 tok/s total`,
  );
});

test("header drops every history-derived aggregate when the sparkline is empty", () => {
  const line = vis(
    renderHeader({ ...MAIN, sparkline: [], totalTokens: 500 }, [], 160),
  );
  assert.equal(line, "Throughput  1 active  42.5 tok/s total  500 tok");
  assert.ok(!line.includes("μ"), "no mean without history");
  assert.ok(!line.includes("p95"), "no p95 without history");
  assert.ok(!line.includes("▁"), "no sparkline without history");
});

test("header counts active participants as the main agent plus every worker row", () => {
  assert.ok(vis(renderHeader(MAIN, [], 160)).includes("1 active"));

  const rows = [
    { tps: 1, phase: "waiting", tokens: 0 },
    { tps: 2, phase: "waiting", tokens: 0 },
  ];
  assert.ok(vis(renderHeader(MAIN, rows, 160)).includes("3 active"));
});

test("header shows streaming only when a participant is streaming", () => {
  const idle = vis(renderHeader(MAIN, [], 160));
  assert.ok(!idle.includes("streaming"), "idle panel has no streaming segment");

  const mainOnly = vis(renderHeader({ ...MAIN, phase: "streaming" }, [], 160));
  assert.ok(mainOnly.includes("1 streaming"), "main agent streams alone");

  const rows = [
    { tps: 1, phase: "streaming", tokens: 0 },
    { tps: 2, phase: "waiting", tokens: 0 },
  ];
  const workersOnly = vis(renderHeader(MAIN, rows, 160));
  assert.ok(workersOnly.includes("3 active"));
  assert.ok(
    workersOnly.includes("1 streaming"),
    "only the streaming row counts",
  );

  const both = vis(renderHeader({ ...MAIN, phase: "streaming" }, rows, 160));
  assert.ok(both.includes("2 streaming"), "main plus streaming rows");
});

test("header aggregates the panel-wide rate and token totals from stats and rows", () => {
  const rows = [
    { tps: 10.5, phase: "streaming", tokens: 400 },
    { tps: 20, phase: "waiting", tokens: 600 },
  ];
  const line = vis(renderHeader({ ...MAIN, totalTokens: 1000 }, rows, 160));
  assert.ok(line.includes("73.0 tok/s total"), "42.5 + 10.5 + 20");
  assert.ok(line.includes("2.0k tok"), "1000 + 400 + 600");
  assert.ok(!line.includes("tok tok"), "the tok unit is never duplicated");
});

test("header reports the token total only when something has been counted", () => {
  const none = vis(
    renderHeader(MAIN, [{ tps: 0, phase: "waiting", tokens: 0 }], 160),
  );
  assert.ok(!/ tok$/.test(none), `no token segment: ${none}`);
  assert.ok(none.endsWith("42.5 tok/s total"), none);
});

test("header aggregates stay finite for non-finite inputs and fabricate nothing", () => {
  const line = vis(
    renderHeader(
      { ...MAIN, tps: NaN, totalTokens: NaN },
      [{ tps: Number.POSITIVE_INFINITY, phase: "streaming", tokens: NaN }],
      160,
    ),
  );
  assert.ok(line.includes("0.0 tok/s total"), line);
  assert.ok(!/ tok$/.test(line), "no token total was fabricated");
});

test("header drops trailing segments instead of overflowing at each breakpoint", () => {
  const spark = formatSparkline(MAIN.sparkline);

  assert.equal(
    vis(renderHeader(MAIN, [], 120)),
    `Throughput ${spark}  12.0 tok/s  μ 38.2  p95 51.0  1 active  42.5 tok/s total`,
  );
  assert.equal(
    vis(renderHeader(MAIN, [], 80)),
    `Throughput ${spark}  12.0 tok/s  μ 38.2  p95 51.0  1 active`,
  );
  assert.equal(
    vis(renderHeader(MAIN, [], 60)),
    `Throughput ${spark}  12.0 tok/s  μ 38.2  p95 51.0`,
  );

  const rows = [
    { badge: "x".repeat(60), tps: 58, phase: "streaming", tokens: 3200 },
  ];
  for (const cols of [60, 80, 120, 160]) {
    const header = renderHeader(MAIN, rows, cols);
    assert.ok(
      stripAnsi(header).length <= cols,
      `header exceeds ${cols} cols: ${vis(header)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Per-row anatomy: phase icon, name, badge, model
// ---------------------------------------------------------------------------

test("phase icons mark streaming, tool, complete, and idle phases", () => {
  assert.equal(phaseIcon("streaming"), "⠴");
  assert.equal(phaseIcon("tool"), "◇");
  assert.equal(phaseIcon("complete"), "✓");
  assert.equal(phaseIcon("waiting"), "·");
  assert.equal(phaseIcon(undefined), "·");
  assert.equal(phaseIcon("bogus"), "·");
});

test("each phase renders its icon ahead of the row identity", () => {
  const base = { tps: 5, tokens: 0 };
  assert.ok(
    renderSubagentRow({ ...base, phase: "streaming" }, true, 160).startsWith(
      "└─ ⠴ subagent",
    ),
  );
  assert.ok(
    renderSubagentRow({ ...base, phase: "complete" }, true, 160).startsWith(
      "└─ ✓ subagent",
    ),
  );
  assert.ok(
    renderSubagentRow({ ...base, phase: "waiting" }, true, 160).startsWith(
      "└─ · subagent",
    ),
  );
  assert.ok(
    renderSubagentRow(base, true, 160).startsWith("└─ · subagent"),
    "absent phase renders the idle icon",
  );
  assert.ok(
    renderMainRow({ ...MAIN, phase: "streaming" }, 160).startsWith("⠴ Main"),
  );
});

test("the correlated agent badge is the row name, truncated to 20 visible chars", () => {
  const long = renderSubagentRow(
    { ...SCOUT, badge: "x".repeat(40) },
    false,
    200,
  );
  assert.ok(vis(long).includes(`◇ ${"x".repeat(20)}`), "20-char name kept");
  assert.ok(!vis(long).includes("x".repeat(21)), "21st char truncated");
});

test("the agent badge is the row identity, never a separate segment", () => {
  const line = renderSubagentRow({ ...SCOUT }, false, 160);
  assert.ok(vis(line).startsWith("├─ ◇ scout"), "badge is the name");
  assert.ok(
    !line.includes(`${ANSI_MUTED}scout${ANSI_RESET}`),
    "no separate dimmed badge segment",
  );
});

test("a task label never reaches the rendered row at 60/80/120/160", () => {
  const stale: StaleLabelRow = { ...SCOUT, label: "explore auth" };
  for (const cols of [60, 80, 120, 160]) {
    const line = renderSubagentRow(stale, false, cols);
    assert.ok(
      !vis(line).includes("explore auth"),
      `task label leaked at ${cols}: ${vis(line)}`,
    );
  }
});

test("a row without a correlated badge falls back to the honest name", () => {
  const line = renderSubagentRow(
    { tps: 5, phase: "streaming", tokens: 0 },
    false,
    160,
  );
  assert.ok(vis(line).startsWith("├─ ⠴ subagent"), "no fabricated identity");
  assert.ok(!line.includes(ANSI_MUTED), "no dimmed identity segment");
});

test("the badge identity renders at every breakpoint and is absent without correlation", () => {
  assert.ok(
    vis(renderSubagentRow({ ...SCOUT }, false, 60)).startsWith("├─ ◇ scout"),
    "badge identity survives the narrow layout",
  );

  const uncorrelated = renderSubagentRow(
    { tps: 5, phase: "streaming", tokens: 0, pid: 4242 },
    false,
    160,
  );
  assert.ok(
    vis(uncorrelated).startsWith("├─ ⠴ subagent · 4242"),
    "honest fallback identity",
  );
  assert.ok(!vis(uncorrelated).includes("scout"), "no fabricated badge");
});

test("standard and wide rows render model:thinking and plain model", () => {
  const main = renderMainRow({ ...MAIN, thinkingLevel: "high" }, 160);
  assert.ok(vis(main).includes("(claude-3-7-sonnet:high)"));
  assert.ok(
    vis(renderMainRow({ ...MAIN }, 160)).includes("(claude-3-7-sonnet)"),
  );

  const sub = renderSubagentRow({ ...SCOUT, thinkingLevel: "low" }, false, 160);
  assert.ok(vis(sub).includes("(claude-3-5-haiku:low)"));
  assert.ok(
    vis(renderSubagentRow({ ...SCOUT }, false, 160)).includes(
      "(claude-3-5-haiku)",
    ),
  );

  const standard = renderMainRow({ ...MAIN, thinkingLevel: "high" }, 100);
  assert.ok(vis(standard).includes("(claude-3-7-sonnet:high)"));
});

test("the model segment is visible at 80/120/160 and hidden at 60", () => {
  for (const cols of [80, 120, 160]) {
    assert.ok(
      vis(renderMainRow(MAIN, cols)).includes("(claude-3-7-sonnet)"),
      `main model hidden at ${cols}`,
    );
    assert.ok(
      vis(renderSubagentRow({ ...SCOUT }, false, cols)).includes(
        "(claude-3-5-haiku)",
      ),
      `worker model hidden at ${cols}`,
    );
  }
  assert.ok(
    !vis(renderMainRow(MAIN, 60)).includes("claude-3-7-sonnet"),
    "main model hidden at 60",
  );
  assert.ok(
    !vis(renderSubagentRow({ ...SCOUT }, false, 60)).includes(
      "claude-3-5-haiku",
    ),
    "worker model hidden at 60",
  );
});

test("the model:thinking segment is wrapped in ANSI muted", () => {
  const main = renderMainRow({ ...MAIN, thinkingLevel: "high" }, 160);
  assert.ok(
    main.includes(`${ANSI_MUTED}(claude-3-7-sonnet:high)${ANSI_RESET}`),
    "main model:thinking is dimmed",
  );

  const plain = renderMainRow({ ...MAIN }, 160);
  assert.ok(
    plain.includes(`${ANSI_MUTED}(claude-3-7-sonnet)${ANSI_RESET}`),
    "a model without a thinking level is dimmed too",
  );

  const standard = renderMainRow(MAIN, 80);
  assert.ok(
    standard.includes(`${ANSI_MUTED}(claude-3-7-sonnet)${ANSI_RESET}`),
    "the standard-width model segment is dimmed too",
  );

  const sub = renderSubagentRow({ ...SCOUT, thinkingLevel: "low" }, false, 160);
  assert.ok(
    sub.includes(`${ANSI_MUTED}(claude-3-5-haiku:low)${ANSI_RESET}`),
    "subagent model:thinking is dimmed",
  );
});

// ---------------------------------------------------------------------------
// Per-row anatomy: token totals
// ---------------------------------------------------------------------------

test("main row shows the session token total on standard and wide only", () => {
  const wide = vis(renderMainRow({ ...MAIN, totalTokens: 12345 }, 160));
  assert.ok(wide.includes("· 12.3k tok"));
  const standard = vis(renderMainRow({ ...MAIN, totalTokens: 12345 }, 100));
  assert.ok(standard.includes("· 12.3k tok"));
  const narrow = vis(renderMainRow({ ...MAIN, totalTokens: 12345 }, 60));
  assert.ok(!narrow.includes("12.3k tok"));
});

test("main row omits the token segment when the tracker has no total", () => {
  assert.ok(!vis(renderMainRow({ ...MAIN }, 160)).includes("  · "));
  assert.ok(
    vis(renderMainRow({ ...MAIN, totalTokens: 0 }, 160)).includes("  · 0 tok"),
  );
});

test("subagent row shows its token total on standard and wide only", () => {
  assert.ok(
    vis(renderSubagentRow({ ...SCOUT }, false, 160)).includes("· 1.4k tok"),
  );
  assert.ok(
    vis(renderSubagentRow({ ...SCOUT }, false, 100)).includes("· 1.4k tok"),
  );
  assert.ok(
    !vis(renderSubagentRow({ ...SCOUT }, false, 60)).includes("1.4k tok"),
  );
});

// ---------------------------------------------------------------------------
// Relative gauge fill
// ---------------------------------------------------------------------------

test("relative gauge scales every row against the panel's live maximum", () => {
  const stats = { ...MAIN, tps: 40, sparkline: [] };
  const rows = [
    { tps: 80, phase: "streaming", tokens: 0 },
    { tps: 40, phase: "streaming", tokens: 0 },
  ];
  const lines = renderPanel(stats, rows, 160);

  // lines[0] is the header; the gauges live on the main row and the worker rows.
  assert.ok(lines[1].includes("█".repeat(8) + TRACK.repeat(8)), "main 40/80");
  assert.ok(lines[2].includes("█".repeat(16)), "worker 80/80 is full");
  assert.ok(lines[3].includes("█".repeat(8) + TRACK.repeat(8)), "worker 40/80");
});

test("an all-idle panel renders empty gauges instead of dividing by zero", () => {
  const stats = { ...MAIN, tps: 0, sparkline: [] };
  const rows = [{ tps: 0, phase: "waiting", tokens: 0 }];
  const lines = renderPanel(stats, rows, 160);
  assert.ok(lines[1].includes(TRACK.repeat(16)));
  assert.ok(lines[2].includes(TRACK.repeat(16)));
});

test("non-finite rates never produce a non-empty gauge", () => {
  const lines = renderPanel(
    { ...MAIN, tps: NaN, sparkline: [] },
    [{ tps: Number.POSITIVE_INFINITY, phase: "streaming", tokens: 0 }],
    160,
  );
  assert.ok(lines[1].includes(TRACK.repeat(16)));
  assert.ok(lines[2].includes(TRACK.repeat(16)));
});

test("direct row renders keep the absolute gauge scale by default", () => {
  const line = renderMainRow({ ...MAIN, tps: 75, sparkline: [] }, 160);
  assert.ok(
    line.includes(formatGauge(75, 16)),
    "75/150 is half on the default scale",
  );
});

// ---------------------------------------------------------------------------
// Main-agent row
// ---------------------------------------------------------------------------

test("wide main row renders identity + model + gauge + rate, without the header aggregates", () => {
  const line = renderMainRow(MAIN, 160);
  assert.ok(line.startsWith("· Main"), "idle main identity");
  assert.ok(line.includes(formatGauge(42.5, 16)), "16-cell gauge");
  assert.ok(vis(line).includes("42.5 tok/s"), "live rate");
  assert.ok(vis(line).includes("(claude-3-7-sonnet)"), "model label");
});

test("main row never carries the session aggregates, which live on the header", () => {
  const spark = formatSparkline(MAIN.sparkline);
  for (const cols of [60, 80, 120, 160]) {
    const line = vis(renderMainRow({ ...MAIN, totalTokens: 12345 }, cols));
    assert.ok(
      !line.includes(spark),
      `sparkline leaked into the row at ${cols}`,
    );
    assert.ok(!line.includes("▁"), `sparkline glyph leaked at ${cols}`);
    assert.ok(!line.includes("μ"), `mean leaked into the row at ${cols}`);
    assert.ok(!line.includes("p95"), `p95 leaked into the row at ${cols}`);
  }
});

test("tool-phase main row renders the Main [tool: <name>] variant", () => {
  const line = renderMainRow(
    { ...MAIN, phase: "tool", activeTool: "bash" },
    160,
  );
  assert.ok(line.startsWith("◇ Main [tool: bash]"));
});

// ---------------------------------------------------------------------------
// Subagent rows
// ---------------------------------------------------------------------------

test("correlated subagent row uses the tree prefix and shows phase/tool, tokens, model", () => {
  const intermediate = renderSubagentRow({ ...SCOUT }, false, 160);
  assert.ok(intermediate.startsWith("├─ ◇ scout"));
  assert.ok(vis(intermediate).includes("tool: read"));
  assert.ok(vis(intermediate).includes("· 1.4k tok"));
  assert.ok(vis(intermediate).includes("(claude-3-5-haiku)"));

  const terminal = renderSubagentRow({ ...SCOUT }, true, 160);
  assert.ok(terminal.startsWith("└─ ◇ scout"));
});

test("honest fallback yields subagent · <pid> and bare subagent", () => {
  const withPid = renderSubagentRow(
    { tps: 10, phase: "streaming", tokens: 500, pid: 4242 },
    false,
    160,
  );
  assert.ok(withPid.startsWith("├─ ⠴ subagent · 4242"));
  assert.ok(vis(withPid).includes("streaming"));

  const noPid = renderSubagentRow(
    { tps: 1, phase: "waiting", tokens: 0 },
    true,
    160,
  );
  assert.ok(noPid.startsWith("└─ · subagent"));
});

// ---------------------------------------------------------------------------
// Documented field hiding per breakpoint
// ---------------------------------------------------------------------------

test("standard main row shows the model and keeps the session token total", () => {
  const line = renderMainRow({ ...MAIN, totalTokens: 12345 }, 100);
  assert.ok(vis(line).includes("· 12.3k tok"));
  assert.ok(vis(line).includes("(claude-3-7-sonnet)"));
});

test("narrow main row hides the model and tokens and uses an 8-cell gauge", () => {
  const line = renderMainRow({ ...MAIN, totalTokens: 12345 }, 60);
  assert.ok(!vis(line).includes("claude-3-7-sonnet"));
  assert.ok(!vis(line).includes("12.3k tok"));
  assert.ok(line.includes(formatGauge(42.5, 8)));
});

test("standard subagent row shows the model and keeps tokens", () => {
  const line = renderSubagentRow({ ...SCOUT }, false, 100);
  assert.ok(vis(line).includes("1.4k tok"));
  assert.ok(vis(line).includes("(claude-3-5-haiku)"));
});

test("narrow subagent row hides tokens/model and keeps tool state", () => {
  const line = renderSubagentRow({ ...SCOUT }, false, 60);
  assert.ok(vis(line).includes("tool: read"));
  assert.ok(!vis(line).includes("1.4k tok"));
  assert.ok(!vis(line).includes("claude-3-5-haiku"));
});

// ---------------------------------------------------------------------------
// Panel composition: header + main row + worker rows
// ---------------------------------------------------------------------------

test("panel lines are the header, the main row, then one row per worker", () => {
  const rows = [{ tps: 10, phase: "streaming", tokens: 0 }];
  const lines = renderPanel(MAIN, rows, 120);
  assert.equal(lines.length, 3, "header + main row + one worker row");
  assert.ok(vis(lines[0]).startsWith("Throughput"), vis(lines[0]));
  assert.ok(vis(lines[1]).startsWith("· Main"), vis(lines[1]));
  assert.ok(vis(lines[2]).startsWith("└─ ⠴ subagent"), vis(lines[2]));
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
    assert.equal(lines.length, 4, "header + main row + two worker rows");
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

test("maximally long sanitized identity still clamps within 60 columns", () => {
  const hostileBadge = renderSubagentRow(
    { badge: "x".repeat(100), tps: 5, phase: "streaming", tokens: 0 },
    false,
    60,
  );
  assert.ok(stripAnsi(hostileBadge).length <= 60);

  const hostileLongerBadge = renderSubagentRow(
    { badge: "z".repeat(100), tps: 5, phase: "streaming", tokens: 0 },
    false,
    60,
  );
  assert.ok(stripAnsi(hostileLongerBadge).length <= 60);

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

test("zero workers render exactly two lines; many workers add one line each", () => {
  const zero = renderPanel(MAIN, [], 80);
  assert.equal(zero.length, 2, "header + main row");
  assert.ok(stripAnsi(zero[0]).startsWith("Throughput"), "header first");
  assert.ok(stripAnsi(zero[1]).startsWith("· Main"), "main row second");
  for (const line of zero) {
    assert.ok(stripAnsi(line).length <= 80);
  }

  const many = Array.from({ length: 12 }, (_, i) => ({
    tps: 20 + i,
    phase: "waiting",
    tokens: i * 100,
  }));
  const lines = renderPanel(MAIN, many, 80);
  assert.equal(lines.length, 14, "header + main row + 12 worker rows");
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
