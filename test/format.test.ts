import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ANSI_GREEN,
  ANSI_MUTED,
  ANSI_RED,
  ANSI_YELLOW,
  formatRate,
  formatTokens,
  measureWidth,
  rateColor,
  sanitizeText,
  stripAnsi,
} from "../src/format.ts";

// ---------------------------------------------------------------------------
// stripAnsi / measureWidth
// ---------------------------------------------------------------------------

test("stripAnsi removes ANSI SGR color sequences", () => {
  assert.equal(stripAnsi("\u001b[32mabc\u001b[0m"), "abc");
});

test("measureWidth ignores ANSI escapes and counts code points", () => {
  assert.equal(measureWidth("\u001b[2mab"), 2);
  // "🎉" is a single code point even though its UTF-16 form is a surrogate pair.
  assert.equal(measureWidth("ab\uD83C\uDF89"), 3);
});

// ---------------------------------------------------------------------------
// sanitizeText
// ---------------------------------------------------------------------------

test("sanitizeText strips newlines and control characters", () => {
  assert.equal(sanitizeText("foo\nbar\tbaz"), "foobarbaz");
});

test("sanitizeText strips ANSI escapes without leaking CSI parameters", () => {
  assert.equal(sanitizeText("x\u001b[31mred\u001b[0m"), "xred");
});

test("sanitizeText clamps long input to 64 code points by default", () => {
  assert.equal(sanitizeText("a".repeat(100)), "a".repeat(64));
  assert.equal(sanitizeText("abc", 2), "ab");
});

test("sanitizeText coerces non-strings and handles empty input", () => {
  assert.equal(sanitizeText(null), "");
  assert.equal(sanitizeText(undefined), "");
  assert.equal(sanitizeText(123), "123");
});

// ---------------------------------------------------------------------------
// rateColor / formatRate
// ---------------------------------------------------------------------------

test("rateColor applies green/yellow/red/muted thresholds", () => {
  assert.equal(rateColor(60), ANSI_GREEN);
  assert.equal(rateColor(21), ANSI_YELLOW);
  assert.equal(rateColor(10), ANSI_RED);
  assert.equal(rateColor(0), ANSI_MUTED);
  assert.equal(rateColor(-4), ANSI_MUTED);
});

test("formatRate wraps a one-decimal rate in the correct color code", () => {
  assert.equal(formatRate(42.5), "\u001b[33m42.5 tok/s\u001b[0m");
  assert.equal(formatRate(0), "\u001b[2m0.0 tok/s\u001b[0m");
});

// ---------------------------------------------------------------------------
// formatTokens
// ---------------------------------------------------------------------------

test("formatTokens renders human-readable cumulative tokens", () => {
  assert.equal(formatTokens(128), "128 tok");
  assert.equal(formatTokens(1400), "1.4k tok");
  assert.equal(formatTokens(3200), "3.2k tok");
  assert.equal(formatTokens(1_500_000), "1.5M tok");
});

// ---------------------------------------------------------------------------
// Triangulation: adversarial input, reproducibility, exact thresholds
// ---------------------------------------------------------------------------

test("sanitizeText never leaks ANSI or control characters from hostile names", () => {
  const hostile = "na\u001b[31mme\u0007\u0000\u001b[2J\n🎉\t";
  assert.equal(sanitizeText(hostile), "name🎉");
});

test("sanitizeText preserves surrogate pairs when clamping", () => {
  // 80 emoji = 80 code points but 160 UTF-16 units; clamping must not split them.
  assert.equal(sanitizeText("🎉".repeat(80)), "🎉".repeat(64));
});

test("formatting helpers are byte-identical across repeated invocations", () => {
  assert.equal(formatRate(42.5), formatRate(42.5));
  assert.equal(formatTokens(1400), formatTokens(1400));
  assert.equal(sanitizeText("x\n🎉"), sanitizeText("x\n🎉"));
  assert.equal(
    stripAnsi("\u001b[1mhi\u001b[0m"),
    stripAnsi("\u001b[1mhi\u001b[0m"),
  );
});

test("rate color boundaries are exact at 20 and 50 tok/s", () => {
  assert.equal(rateColor(50), ANSI_GREEN);
  assert.equal(rateColor(49.999), ANSI_YELLOW);
  assert.equal(rateColor(20), ANSI_YELLOW);
  assert.equal(rateColor(19.999), ANSI_RED);
  assert.equal(rateColor(0), ANSI_MUTED);
});
