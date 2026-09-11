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
/** Maximum visible length of the correlated task label used as a row name. */
export const ROW_NAME_MAX = 24;
/** Maximum visible length of the raw correlated agent badge. */
export const ROW_BADGE_MAX = 20;

const SEP = "  ";

/** Phase glyphs rendered ahead of the row identity. */
const PHASE_ICONS: Record<string, string> = {
  streaming: "⠴",
  tool: "◇",
  complete: "✓",
};
/** Glyph for `waiting`, an unknown phase, or no phase at all. */
const IDLE_ICON = "·";

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
}

/** One subagent worker row's metrics and (optionally) correlated identity. */
export interface WorkerRow {
  /** Worker PID used for the honest fallback label when no label is correlated. */
  pid?: number;
  /** Raw correlated agent name (e.g. `scout`); drawn as a separate dimmed badge. */
  badge?: string;
  /** Correlated task label; when present it is the row's name. */
  label?: string;
  tps: number;
  phase?: string;
  activeTool?: string;
  tokens: number;
  model?: string;
  /** Reasoning effort drawn beside the model on wide layouts. */
  thinkingLevel?: string;
}

/** Minimal theme: color used to dim model labels. */
export interface PanelTheme {
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
 * Phase glyph shown ahead of a row identity: `⠴` streaming, `◇` tool, `✓`
 * complete, and `·` for waiting, an unknown phase, or no phase at all.
 */
export function phaseIcon(phase?: string): string {
  return PHASE_ICONS[phase ?? ""] ?? IDLE_ICON;
}

/**
 * Row name: the correlated task label when present, otherwise the honest
 * `subagent · <pid>` / `subagent` fallback. The raw agent badge is never used
 * as a name.
 */
function workerName(row: WorkerRow): string {
  if (row.label !== undefined) {
    const label = truncateVisible(sanitizeText(row.label), ROW_NAME_MAX);
    if (label !== "") return label;
  }
  if (Number.isInteger(row.pid) && (row.pid as number) > 0) {
    return `subagent · ${row.pid}`;
  }
  return "subagent";
}

/** Separate dimmed badge segment for the raw correlated agent name. */
function badgeSegment(row: WorkerRow, theme?: PanelTheme): Segment | null {
  if (row.badge === undefined) return null;
  const badge = truncateVisible(sanitizeText(row.badge), ROW_BADGE_MAX);
  if (badge === "") return null;
  return segment(dim(badge, theme));
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
 * Largest live TPS across the main row and every worker row; the relative gauge
 * ceiling. Non-finite and negative rates are ignored, and an all-idle panel
 * yields 0 (an empty gauge for every row).
 */
function maxLiveTps(stats: PanelStats, rows: WorkerRow[]): number {
  let max = Number.isFinite(stats.tps) && stats.tps > 0 ? stats.tps : 0;
  for (const row of rows) {
    if (Number.isFinite(row.tps) && row.tps > max) max = row.tps;
  }
  return max;
}

/**
 * Renders the main-agent meter row. Wide includes the model (and thinking level)
 * and the token total; standard hides the model and keeps μ/p95 and tokens;
 * narrow additionally hides μ/p95/tokens and shrinks the gauge to 8 columns.
 * `gaugeMax` defaults to the absolute scale; `renderPanel` passes the panel's
 * live maximum for a relative fill.
 */
export function renderMainRow(
  stats: PanelStats,
  width: number,
  theme?: PanelTheme,
  gaugeMax = GAUGE_MAX_TPS,
): string {
  const cols = clampWidth(width);
  const bp = breakpointFor(cols);
  const cells = bp === "narrow" ? COMPACT_GAUGE_CELLS : MAIN_GAUGE_CELLS;

  const segments: Segment[] = [
    segment(`${phaseIcon(stats.phase)} ${mainLabel(stats)}`),
  ];
  if (bp === "wide") {
    const model = modelSegment(stats.model, stats.thinkingLevel, theme);
    if (model !== null) segments.push(model);
  }
  segments.push(segment(formatGauge(stats.tps, cells, gaugeMax)));
  segments.push(segment(formatRate(stats.tps)));
  segments.push(segment(formatSparkline(stats.sparkline ?? [])));
  if (bp !== "narrow") {
    segments.push(segment(`μ ${fmt1(stats.mean)}`));
    segments.push(segment(`p95 ${fmt1(stats.p95)}`));
    if (Number.isFinite(stats.totalTokens)) {
      segments.push(segment(`· ${formatTokens(stats.totalTokens as number)}`));
    }
  }

  return compose(segments, cols);
}

/**
 * Renders one subagent row. Wide includes the badge, tokens, and model (with
 * thinking level); standard includes the badge and tokens only; narrow keeps
 * identity + gauge + rate + state with an 8-cell gauge and no badge.
 */
export function renderSubagentRow(
  row: WorkerRow,
  isLast: boolean,
  width: number,
  theme?: PanelTheme,
  gaugeMax = GAUGE_MAX_TPS,
): string {
  const cols = clampWidth(width);
  const bp = breakpointFor(cols);
  const cells = bp === "narrow" ? COMPACT_GAUGE_CELLS : MAIN_GAUGE_CELLS;

  const segments: Segment[] = [
    segment(
      `${isLast ? "└─" : "├─"} ${phaseIcon(row.phase)} ${workerName(row)}`,
    ),
  ];
  if (bp !== "narrow") {
    const badge = badgeSegment(row, theme);
    if (badge !== null) segments.push(badge);
  }
  if (bp === "wide") {
    const model = modelSegment(row.model, row.thinkingLevel, theme);
    if (model !== null) segments.push(model);
  }
  segments.push(segment(formatGauge(row.tps, cells, gaugeMax)));
  segments.push(segment(formatRate(row.tps)));
  segments.push(segment(workerState(row)));
  if (bp !== "narrow") {
    segments.push(segment(`· ${formatTokens(row.tokens)}`));
  }

  return compose(segments, cols);
}

/**
 * Composes the full panel: the main-agent row followed by one row per worker,
 * with `├─` prefixes for intermediate rows and `└─` for the terminal row. The
 * relative gauge ceiling is computed once from every rendered row so each gauge
 * shows its share of the panel's live maximum.
 */
export function renderPanel(
  stats: PanelStats,
  rows: WorkerRow[],
  width: number,
  theme?: PanelTheme,
): string[] {
  const gaugeMax = maxLiveTps(stats, rows);
  const lines = [renderMainRow(stats, width, theme, gaugeMax)];
  for (let i = 0; i < rows.length; i++) {
    lines.push(
      renderSubagentRow(rows[i], i === rows.length - 1, width, theme, gaugeMax),
    );
  }
  return lines;
}
