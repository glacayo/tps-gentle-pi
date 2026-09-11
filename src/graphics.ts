// Pure gauge and sparkline renderers for the TPS meter panel.
//
// No I/O and no ambient mutable global state; every function returns a string
// derived only from its explicit arguments.

/** TPS value at which the gauge is considered full. */
export const GAUGE_MAX_TPS = 150;

/** Default gauge width in columns. */
export const DEFAULT_GAUGE_CELLS = 16;

/** Fractional fill sub-blocks (0/8..7/8 of a cell). */
export const GAUGE_SUBBLOCKS = [
 " ",
 "▏",
 "▎",
 "▍",
 "▌",
 "▋",
 "▊",
 "▉",
] as const;

/** Eight-level sparkline blocks, ascending by fill amount. */
export const SPARKLINE_BLOCKS = [
 "▁",
 "▂",
 "▃",
 "▄",
 "▅",
 "▆",
 "▇",
 "█",
] as const;

const FULL_BLOCK = "█";
const GAUGE_TRACK = "·";

/** Clamps a finite value between `lo` and `hi`. */
function clamp(value: number, lo: number, hi: number): number {
 return Math.max(lo, Math.min(value, hi));
}

/**
 * Renders a gauge of `cells` columns for a live TPS rate. The fill is the full
 * block `█`, the final fractional column uses one of the eighth sub-blocks, and
 * the unfilled remainder is the track `·`. Rate 0 renders all track; the ceiling
 * renders all full blocks. Out-of-range and non-finite rates clamp to the
 * empty/full boundaries.
 *
 * `maxTps` is the fill ceiling. It defaults to the absolute GAUGE_MAX_TPS scale;
 * passing a live maximum (the largest TPS among the rendered rows) switches the
 * gauge to a relative fill. A non-finite or non-positive ceiling renders an
 * empty gauge, because no meaningful ratio exists.
 */
export function formatGauge(
 tps: number,
 cells = DEFAULT_GAUGE_CELLS,
 maxTps = GAUGE_MAX_TPS,
): string {
 const cellCount = Math.max(1, Math.floor(cells));
 const ceiling = Number.isFinite(maxTps) && maxTps > 0 ? maxTps : 0;
 const rate = ceiling > 0 && Number.isFinite(tps) ? clamp(tps, 0, ceiling) : 0;

 const eighths = ceiling > 0 ? Math.round((rate / ceiling) * cellCount * 8) : 0;
 const fullCells = Math.floor(eighths / 8);
 const remainder = eighths - fullCells * 8;

 let bar = FULL_BLOCK.repeat(fullCells);
 if (remainder > 0 && fullCells < cellCount) {
  bar += GAUGE_SUBBLOCKS[remainder];
 }
 bar += GAUGE_TRACK.repeat(cellCount - fullCells - (remainder > 0 ? 1 : 0));
 return bar;
}

/**
 * Renders a sparkline of turn TPS rates using the eight-level blocks, oldest
 * first (input order preserved). Values normalize against the history's own
 * maximum so relative turn shape is visible; empty or all-zero histories render
 * the floor block `▁`.
 */
export function formatSparkline(history: number[]): string {
 if (history.length === 0) return "";
 const values = history.map((value) =>
  Number.isFinite(value) && value >= 0 ? value : 0,
 );
 const max = Math.max(...values);
 if (max <= 0) return "▁".repeat(values.length);

 return values
  .map((value) => {
   const level = clamp(Math.round((value / max) * 7), 0, 7);
   return SPARKLINE_BLOCKS[level];
  })
  .join("");
}
