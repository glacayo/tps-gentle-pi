// Pure, side-effect-free text formatting and sanitization helpers.
//
// These functions keep no ambient mutable global state and perform no I/O, so
// they are unit-testable without a Pi runtime. They are shared by the panel
// renderer (WU-3) to guarantee terminal-safe output.

/** ANSI SGR color codes used for rate presentation. */
export const ANSI_RESET = "\u001b[0m";
export const ANSI_GREEN = "\u001b[32m";
export const ANSI_YELLOW = "\u001b[33m";
export const ANSI_RED = "\u001b[31m";
export const ANSI_MUTED = "\u001b[2m";

/** Default maximum length (code points) for sanitized label strings. */
export const DEFAULT_LABEL_MAX_LENGTH = 64;

/** Matches OSC sequences (ESC ] ... BEL/ST) and CSI sequences (ESC [ ... final byte). */
const ANSI_ESCAPE =
 /(?:\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\))|(?:\u001b\[[0-9;?]*[ -/]*[@-~])/g;

/** C0 control characters, DEL, and C1 control characters. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Removes ANSI escape sequences (SGR colors, cursor movement, OSC links, etc.)
 * while leaving the visible text intact.
 */
export function stripAnsi(text: string): string {
 return String(text).replace(ANSI_ESCAPE, "");
}

/**
 * Measures the visible display width of `text` in code points, ignoring ANSI
 * escape sequences. Surrogate pairs and emoji count as a single column.
 */
export function measureWidth(text: string): number {
 return Array.from(stripAnsi(text)).length;
}

/**
 * Sanitizes an untrusted label (agent or tool name) for terminal display:
 * ANSI escapes, newlines, tabs, and control characters are stripped, then the
 * result is clamped to at most `maxLength` code points without splitting
 * surrogate pairs.
 */
export function sanitizeText(
 text: unknown,
 maxLength = DEFAULT_LABEL_MAX_LENGTH,
): string {
 const source = stripAnsi(typeof text === "string" ? text : String(text ?? ""));
 const cleaned = source.replace(CONTROL_CHARS, "");
 const limit = Number.isFinite(maxLength)
  ? Math.max(0, Math.floor(maxLength))
  : DEFAULT_LABEL_MAX_LENGTH;
 return Array.from(cleaned).slice(0, limit).join("");
}

/** ANSI color code for a live TPS rate: muted idle, red/yellow/green ladder. */
export function rateColor(tps: number): string {
 if (!Number.isFinite(tps) || tps <= 0) return ANSI_MUTED;
 if (tps < 20) return ANSI_RED;
 if (tps < 50) return ANSI_YELLOW;
 return ANSI_GREEN;
}

/** Coerces a value to a finite, non-negative number (non-positive/NaN → 0). */
function nonNegative(value: number): number {
 return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Formats a live rate (one decimal) wrapped in its threshold color code. */
export function formatRate(tps: number): string {
 const rate = nonNegative(tps);
 return `${rateColor(rate)}${rate.toFixed(1)} tok/s${ANSI_RESET}`;
}

/** Formats a cumulative token count in a compact human-readable form. */
export function formatTokens(tokens: number): string {
 const value = nonNegative(tokens);
 if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B tok`;
 if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M tok`;
 if (value >= 1000) return `${(value / 1000).toFixed(1)}k tok`;
 return `${Math.round(value)} tok`;
}
