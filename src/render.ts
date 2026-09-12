// Pure, side-effect-free panel layout composer. Consumes WU-2 `format.ts` /
// `graphics.ts` primitives and returns width-safe string lines for
// `ctx.ui.setWidget`. Output depends only on explicit inputs (stats, rows,
// theme, width); no ambient state, no I/O.

import { formatGauge, formatSparkline, GAUGE_MAX_TPS } from "./graphics.ts";
import {
 ANSI_MUTED,
 ANSI_RESET,
 formatRate,
 formatTokens,
 sanitizeText,
 stripAnsi,
} from "./format.ts";

/** Terminals at or above this width get the full layout. */
export const WIDE_MIN_COLS = 120;
/** Terminals in [STANDARD_MIN_COLS, WIDE_MIN_COLS) get the standard layout. */
export const STANDARD_MIN_COLS = 80;
/** Renderers never emit a panel wider than this floor, even for narrower inputs. */
export const NARROW_MIN_COLS = 60;

/** Gauge columns used in wide and standard layouts. */
export const MAIN_GAUGE_CELLS = 16;
/** Gauge columns used in the narrow (compact) layout. */
export const COMPACT_GAUGE_CELLS = 8;
/** Maximum visible length of the correlated agent badge used as the row name. */
export const ROW_BADGE_MAX = 20;

const SEP = "  ";

/** Braille frames cycled by the animated (`streaming`, `tool`) phases. */
export const SPINNER_FRAMES = [
 "⠋",
 "⠙",
 "⠹",
 "⠸",
 "⠼",
 "⠴",
 "⠦",
 "⠧",
 "⠇",
 "⠏",
];
/** Wall-clock milliseconds each spinner frame stays on screen. */
export const SPINNER_FRAME_MS = 80;
/** Glyph for `waiting`, an unknown phase, or no phase at all. */
const IDLE_ICON = "·";
/** Glyph for a finished (`complete`) phase. */
const COMPLETE_ICON = "✓";

export type PanelBreakpoint = "wide" | "standard" | "narrow";

/** Main-agent telemetry and session statistics fed into the panel. */
export interface PanelStats {
 tps: number;
 mean: number;
 p95: number;
 /** Recent completed-turn TPS history, oldest first. */
 sparkline: number[];
 model?: string;
 /** Reasoning effort drawn beside the model on wide layouts. */
 thinkingLevel?: string;
 /** `"tool"` activates the tool-variant prefix. */
 phase?: string;
 activeTool?: string;
 /** Session cumulative output tokens; drawn as `· N tok` on standard and wide. */
 totalTokens?: number;
 /** Completion timestamp; present when the main agent reached `complete`. */
 completedAt?: number;
 /** Mean tokens/second over the session; drawn in place of the gauge when complete. */
 avgTps?: number;
}

/** One subagent worker row's metrics and (optionally) correlated identity. */
export interface WorkerRow {
 /** Worker PID used for the honest fallback name when no badge is correlated. */
 pid?: number;
 /**
  * Correlated raw agent name (e.g. `scout`); sanitized and truncated to 20
  * visible chars, it is the row's name. A task label is never rendered.
  */
 badge?: string;
 tps: number;
 phase?: string;
 activeTool?: string;
 tokens: number;
 model?: string;
 /** Reasoning effort drawn beside the model on wide layouts. */
 thinkingLevel?: string;
 /** Completion timestamp of the worker; present when `phase` is `complete`. */
 completedAt?: number;
 /** Mean tokens/second over the worker's lifetime; drawn when `phase` is `complete`. */
 avgTps?: number;
}

/** Optional ANSI prefixes from the active Pi theme: accent=gauge fill + sparkline,
 * foreground=text/rates/counts, muted=gauge track + tokens, dim=model. */
export interface PanelTheme {
 accent?: string;
 foreground?: string;
 muted?: string;
 dim?: string;
}

/** Visible width in UTF-16 code units (matches the spec's `stripAnsi().length`). */
function visibleLength(text: string): number {
 return stripAnsi(text).length;
}

/** Clamps a terminal width into the supported [60, +∞) range. */
function clampWidth(width: number): number {
 if (!Number.isFinite(width)) return STANDARD_MIN_COLS;
 return Math.max(NARROW_MIN_COLS, Math.floor(width));
}

/** Classifies a (already clamped) width into a layout breakpoint. */
export function breakpointFor(width: number): PanelBreakpoint {
 const cols = clampWidth(width);
 if (cols >= WIDE_MIN_COLS) return "wide";
 if (cols >= STANDARD_MIN_COLS) return "standard";
 return "narrow";
}

function dim(text: string, theme?: PanelTheme): string {
 return `${theme?.dim ?? ANSI_MUTED}${text}${ANSI_RESET}`;
}

/** Applies a theme prefix to `text`, dropping any color it already carries. */
function recolor(text: string, prefix?: string): string {
 if (prefix === undefined || prefix === "") return text;
 return `${prefix}${stripAnsi(text)}${ANSI_RESET}`;
}

/** Formats a number to one decimal place (non-finite → 0.0). */
function fmt1(value: number): string {
 return (Number.isFinite(value) ? value : 0).toFixed(1);
}

/** Truncates a plain string to `budget` UTF-16 units without splitting a surrogate. */
function truncateVisible(text: string, budget: number): string {
 const target = Math.max(0, Math.floor(budget));
 if (visibleLength(text) <= target) return text;
 let out = text.slice(0, target);
 const last = out.charCodeAt(out.length - 1);
 if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
 return out;
}

interface Segment {
 text: string;
 width: number;
}

function segment(text: string): Segment {
 return { text, width: visibleLength(text) };
}

/**
 * Composes segments left to right (highest priority first) with SEP gaps. The
 * leading identity segment is always present and is truncated to fit; later
 * segments are skipped when they would overflow, guaranteeing width safety.
 */
function compose(segments: Segment[], budget: number): string {
 const [first, ...rest] = segments;
 let line = truncateVisible(first.text, budget);
 let used = visibleLength(line);
 for (const seg of rest) {
  const add = SEP.length + seg.width;
  if (used + add <= budget) {
   line += SEP + seg.text;
   used += add;
  }
 }
 return line;
}

/** Main-agent identity label, including the tool-phase variant. */
function mainLabel(stats: PanelStats): string {
 if (stats.phase === "tool" && stats.activeTool) {
  return `Main [tool: ${sanitizeText(stats.activeTool)}]`;
 }
 return "Main";
}

/**
 * Phase glyph shown ahead of a row identity. `streaming` and `tool` cycle through
 * `SPINNER_FRAMES` by `frame`; `complete` and every idle phase stay static.
 */
export function phaseIcon(phase?: string, frame = 0): string {
 if (phase === "streaming" || phase === "tool") {
  return SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
 }
 return phase === "complete" ? COMPLETE_ICON : IDLE_ICON;
}

/**
 * Row name: the correlated raw agent badge (sanitized, truncated to 20 visible
 * chars) when present, otherwise the honest `subagent · <pid>` / `subagent`
 * fallback. Task labels are never rendered.
 */
function workerName(row: WorkerRow): string {
 if (row.badge !== undefined) {
  const badge = truncateVisible(sanitizeText(row.badge), ROW_BADGE_MAX);
  if (badge !== "") return badge;
 }
 if (Number.isInteger(row.pid) && (row.pid as number) > 0) {
  return `subagent · ${row.pid}`;
 }
 return "subagent";
}

/** Dimmed `model` / `model:thinking` segment; absent when no model is known. */
function modelSegment(
 model: string | undefined,
 thinkingLevel: string | undefined,
 theme?: PanelTheme,
): Segment | null {
 const name = model === undefined ? "" : sanitizeText(model);
 if (name === "") return null;
 const thinking =
  thinkingLevel === undefined ? "" : sanitizeText(thinkingLevel);
 const text = thinking === "" ? name : `${name}:${thinking}`;
 return segment(dim(`(${text})`, theme));
}

/** Phase/tool state text for a worker row. */
function workerState(row: WorkerRow): string {
 if (row.phase === "tool" && row.activeTool) {
  return `tool: ${sanitizeText(row.activeTool)}`;
 }
 if (typeof row.phase === "string" && row.phase.length > 0) {
  return sanitizeText(row.phase);
 }
 return "waiting";
}

/**
 * Completed-row metric segments shared by the main and worker rows: the average rate
 * (`avg N tok/s`) followed by the token total, replacing the gauge and phase/tool state a
 * live row shows. `rate` falls back to the last live rate when no average was correlated.
 */
function completedMetrics(
 rate: number,
 tokens: number,
 theme?: PanelTheme,
): Segment[] {
 return [
  segment(recolor(`avg ${formatRate(rate)}`, theme?.foreground)),
  segment(recolor(`· ${formatTokens(tokens)}`, theme?.muted)),
 ];
}

/**
 * Largest live TPS across the main row and every worker row. Non-finite and
 * negative rates are ignored, and an all-idle panel yields 0. `renderPanel`
 * raises this to at least `GAUGE_MAX_TPS` to form the hybrid gauge ceiling.
 */
function maxLiveTps(stats: PanelStats, rows: WorkerRow[]): number {
 let max = Number.isFinite(stats.tps) && stats.tps > 0 ? stats.tps : 0;
 for (const row of rows) {
  if (Number.isFinite(row.tps) && row.tps > max) max = row.tps;
 }
 return max;
}

/** Sums a numeric projection over worker rows, ignoring non-finite values. */
function sumRows(rows: WorkerRow[], pick: (row: WorkerRow) => number): number {
 let total = 0;
 for (const row of rows) {
  const value = pick(row);
  if (Number.isFinite(value)) total += value;
 }
 return total;
}

/** Streaming participants: the main agent when streaming, plus streaming rows. */
function streamingCount(stats: PanelStats, rows: WorkerRow[]): number {
 let count = stats.phase === "streaming" ? 1 : 0;
 for (const row of rows) {
  if (row.phase === "streaming") count++;
 }
 return count;
}

/**
 * Renders the session header line, the panel's first line. Segments compose in
 * visual order: the `Throughput` identity with the turn sparkline, the last/
 * mean/p95 history aggregates, the live participant counts, and the panel-wide
 * rate and token totals.
 *
 * History-derived segments appear only when `stats.sparkline` is non-empty, the
 * streaming segment only when something is streaming, and the token total only
 * when something has been counted. Every aggregate derives only from `stats` and
 * `rows`; a narrow terminal drops trailing segments instead of overflowing.
 *
 * `theme` colors the header text, rates, and counts (foreground), the sparkline
 * (accent), and the token total (muted).
 */
export function renderHeader(
 stats: PanelStats,
 rows: WorkerRow[],
 width: number,
 theme?: PanelTheme,
): string {
 const cols = clampWidth(width);
 const history = stats.sparkline ?? [];
 const hasHistory = history.length > 0;
 const fg = (text: string): Segment =>
  segment(recolor(text, theme?.foreground));

 const title = recolor("Throughput", theme?.foreground);
 const segments: Segment[] = [
  segment(
   hasHistory ? `${title} ${formatSparkline(history, theme?.accent)}` : title,
  ),
 ];
 if (hasHistory) {
  segments.push(fg(`${fmt1(history[history.length - 1])} tok/s`));
  segments.push(fg(`μ ${fmt1(stats.mean)}`));
  segments.push(fg(`p95 ${fmt1(stats.p95)}`));
 }

 segments.push(fg(`${1 + rows.length} active`));
 const streaming = streamingCount(stats, rows);
 if (streaming > 0) segments.push(fg(`${streaming} streaming`));

 const liveTps = Number.isFinite(stats.tps) ? stats.tps : 0;
 segments.push(
  fg(`${fmt1(liveTps + sumRows(rows, (row) => row.tps))} tok/s total`),
 );

 const sessionTokens = Number.isFinite(stats.totalTokens)
  ? (stats.totalTokens as number)
  : 0;
 const totalTokens = sessionTokens + sumRows(rows, (row) => row.tokens);
 if (totalTokens > 0) {
  // `formatTokens` already carries the `tok` unit, so the segment is its output
  // verbatim: the header reads `2.0k tok`, never `2.0k tok tok`.
  segments.push(segment(recolor(formatTokens(totalTokens), theme?.muted)));
 }

 return compose(segments, cols);
}

/**
 * Renders the main-agent meter row. Standard and wide include the model (and
 * thinking level) and the token total; narrow shrinks the gauge to 8 columns and
 * hides both. The session aggregates (sparkline, μ, p95) live on the header line,
 * not here.
 *
 * `gaugeMax` defaults to the absolute scale; `renderPanel` passes the hybrid
 * ceiling (the larger of the panel's live maximum and the absolute scale).
 *
 * A `complete` phase switches to the completed path above: identity and model are
 * kept, the gauge and live rate are replaced by `avg N tok/s` and the token total.
 */
export function renderMainRow(
 stats: PanelStats,
 width: number,
 theme?: PanelTheme,
 gaugeMax = GAUGE_MAX_TPS,
 frame = 0,
): string {
 const cols = clampWidth(width);
 const bp = breakpointFor(cols);
 const cells = bp === "narrow" ? COMPACT_GAUGE_CELLS : MAIN_GAUGE_CELLS;

 const segments: Segment[] = [
  segment(`${phaseIcon(stats.phase, frame)} ${mainLabel(stats)}`),
 ];
 if (bp !== "narrow") {
  const model = modelSegment(stats.model, stats.thinkingLevel, theme);
  if (model !== null) segments.push(model);
 }
 if (stats.phase === "complete") {
  // Completed main row: average rate + session tokens, no gauge. The main agent does
  // not complete in the current wiring, so this path only has to degrade gracefully.
  const tokens = Number.isFinite(stats.totalTokens)
   ? (stats.totalTokens as number)
   : 0;
  return compose(
   [...segments, ...completedMetrics(stats.avgTps ?? stats.tps, tokens, theme)],
   cols,
  );
 }
 segments.push(
  segment(formatGauge(stats.tps, cells, gaugeMax, theme?.accent, theme?.muted)),
 );
 segments.push(segment(recolor(formatRate(stats.tps), theme?.foreground)));
 if (bp !== "narrow") {
  if (Number.isFinite(stats.totalTokens)) {
   segments.push(
    segment(
     recolor(`· ${formatTokens(stats.totalTokens as number)}`, theme?.muted),
    ),
   );
  }
 }

 return compose(segments, cols);
}

/**
 * Renders one subagent row. The row name is the correlated agent badge, or the
 * honest `subagent` fallback. Standard and wide also include the model (with
 * thinking level) and the token total; narrow keeps identity + gauge + rate +
 * state with an 8-cell gauge and no model or tokens. `frame` animates the icon.
 *
 * A `complete` phase switches to the completed path above: the icon is `✓`, the
 * identity and dimmed model are kept, the gauge and phase/tool state are dropped,
 * and the row closes with `avg N tok/s` plus the token total at every breakpoint.
 */
export function renderSubagentRow(
 row: WorkerRow,
 isLast: boolean,
 width: number,
 theme?: PanelTheme,
 gaugeMax = GAUGE_MAX_TPS,
 frame = 0,
): string {
 const cols = clampWidth(width);
 const bp = breakpointFor(cols);
 const cells = bp === "narrow" ? COMPACT_GAUGE_CELLS : MAIN_GAUGE_CELLS;

 const segments: Segment[] = [
  segment(
   `${isLast ? "└─" : "├─"} ${phaseIcon(row.phase, frame)} ${workerName(row)}`,
  ),
 ];
 if (bp !== "narrow") {
  const model = modelSegment(row.model, row.thinkingLevel, theme);
  if (model !== null) segments.push(model);
 }
 if (row.phase === "complete") {
  // Completed worker row: identity, dimmed model, average rate, and the token total.
  // No gauge and no phase/tool state text: a finished worker has no live reading.
  return compose(
   [...segments, ...completedMetrics(row.avgTps ?? row.tps, row.tokens, theme)],
   cols,
  );
 }
 segments.push(
  segment(formatGauge(row.tps, cells, gaugeMax, theme?.accent, theme?.muted)),
 );
 segments.push(segment(recolor(formatRate(row.tps), theme?.foreground)));
 segments.push(segment(workerState(row)));
 if (bp !== "narrow") {
  segments.push(
   segment(recolor(`· ${formatTokens(row.tokens)}`, theme?.muted)),
  );
 }

 return compose(segments, cols);
}

/**
 * Composes the full panel: the session header line, the main-agent row, then one
 * row per worker, with `├─` prefixes for intermediate rows and `└─` for the
 * terminal row. The gauge ceiling is hybrid and computed once from every rendered
 * row: `max(fastest live row, GAUGE_MAX_TPS)`. Below 150 tok/s every bar is an
 * absolute magnitude reading on the fixed scale; once one participant exceeds it,
 * the fastest row fills and the rest compare against that live maximum.
 */
export function renderPanel(
 stats: PanelStats,
 rows: WorkerRow[],
 width: number,
 theme?: PanelTheme,
 frame = 0,
): string[] {
 const gaugeMax = Math.max(maxLiveTps(stats, rows), GAUGE_MAX_TPS);
 const lines = [
  renderHeader(stats, rows, width, theme),
  renderMainRow(stats, width, theme, gaugeMax, frame),
 ];
 for (let i = 0; i < rows.length; i++) {
  lines.push(
   renderSubagentRow(
    rows[i],
    i === rows.length - 1,
    width,
    theme,
    gaugeMax,
    frame,
   ),
  );
 }
 return lines;
}
