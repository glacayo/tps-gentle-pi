// Pure, side-effect-free panel layout composer. Consumes WU-2 `format.ts` /
// `graphics.ts` primitives and returns width-safe string lines for
// `ctx.ui.setWidget`. Output depends only on explicit inputs (stats, rows,
// theme, width); no ambient state, no I/O.

import { formatGauge, formatSparkline } from "./graphics.ts";
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

const SEP = "  ";

export type PanelBreakpoint = "wide" | "standard" | "narrow";

/** Main-agent telemetry and session statistics fed into the panel. */
export interface PanelStats {
  tps: number;
  mean: number;
  p95: number;
  /** Recent completed-turn TPS history, oldest first. */
  sparkline: number[];
  model?: string;
  /** Reserved for the tracker; not drawn in the panel. */
  thinkingLevel?: string;
  /** `"tool"` activates the tool-variant prefix. */
  phase?: string;
  activeTool?: string;
}

/** One subagent worker row's metrics and (optionally) correlated identity. */
export interface WorkerRow {
  /** Worker PID used for the honest fallback label when no badge is correlated. */
  pid?: number;
  /** Correlated agent badge (e.g. "scout"); absent means honest fallback. */
  badge?: string;
  tps: number;
  phase?: string;
  activeTool?: string;
  tokens: number;
  model?: string;
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

/** Correlated badge, or the honest `subagent` / `subagent · <pid>` fallback. */
function workerName(row: WorkerRow): string {
  const badge = sanitizeText(row.badge);
  if (badge !== "") return badge;
  if (Number.isInteger(row.pid) && (row.pid as number) > 0) {
    return `subagent · ${row.pid}`;
  }
  return "subagent";
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
 * Renders the main-agent meter row. Wide includes the model; standard hides the
 * model; narrow additionally hides μ/p95 and shrinks the gauge to 8 columns.
 */
export function renderMainRow(
  stats: PanelStats,
  width: number,
  theme?: PanelTheme,
): string {
  const cols = clampWidth(width);
  const bp = breakpointFor(cols);
  const cells = bp === "narrow" ? COMPACT_GAUGE_CELLS : MAIN_GAUGE_CELLS;

  const segments = [
    segment(mainLabel(stats)),
    segment(formatGauge(stats.tps, cells)),
    segment(formatRate(stats.tps)),
    segment(formatSparkline(stats.sparkline ?? [])),
  ];
  if (bp !== "narrow") {
    segments.push(segment(`μ ${fmt1(stats.mean)}`));
    segments.push(segment(`p95 ${fmt1(stats.p95)}`));
  }
  if (bp === "wide" && stats.model) {
    segments.push(segment(dim(`(${sanitizeText(stats.model)})`, theme)));
  }

  return compose(segments, cols);
}

/**
 * Renders one subagent row. Wide includes tokens and model; standard includes
 * tokens only; narrow keeps identity + gauge + rate + state with an 8-cell gauge.
 */
export function renderSubagentRow(
  row: WorkerRow,
  isLast: boolean,
  width: number,
  theme?: PanelTheme,
): string {
  const cols = clampWidth(width);
  const bp = breakpointFor(cols);
  const cells = bp === "narrow" ? COMPACT_GAUGE_CELLS : MAIN_GAUGE_CELLS;

  const segments = [
    segment(`${isLast ? "└─" : "├─"} ${workerName(row)}`),
    segment(formatGauge(row.tps, cells)),
    segment(formatRate(row.tps)),
    segment(workerState(row)),
  ];
  if (bp !== "narrow") {
    segments.push(segment(`(${formatTokens(row.tokens)})`));
  }
  if (bp === "wide" && row.model) {
    segments.push(segment(dim(`(${sanitizeText(row.model)})`, theme)));
  }

  return compose(segments, cols);
}

/**
 * Composes the full panel: the main-agent row followed by one row per worker,
 * with `├─` prefixes for intermediate rows and `└─` for the terminal row.
 */
export function renderPanel(
  stats: PanelStats,
  rows: WorkerRow[],
  width: number,
  theme?: PanelTheme,
): string[] {
  const lines = [renderMainRow(stats, width, theme)];
  for (let i = 0; i < rows.length; i++) {
    lines.push(renderSubagentRow(rows[i], i === rows.length - 1, width, theme));
  }
  return lines;
}
