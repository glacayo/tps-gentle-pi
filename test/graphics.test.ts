import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GAUGE_MAX_TPS,
  GAUGE_SUBBLOCKS,
  SPARKLINE_BLOCKS,
  formatGauge,
  formatSparkline,
} from "../src/graphics.ts";

const TRACK = "·";

// ---------------------------------------------------------------------------
// Mandated block alphabet
// ---------------------------------------------------------------------------

test("graphics exposes the mandated sub-block arrays", () => {
  assert.deepEqual(GAUGE_SUBBLOCKS, [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]);
  assert.deepEqual(SPARKLINE_BLOCKS, ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]);
});

// ---------------------------------------------------------------------------
// formatGauge
// ---------------------------------------------------------------------------

test("formatGauge renders an empty 16-cell gauge at 0 tok/s", () => {
  assert.equal(formatGauge(0), TRACK.repeat(16));
});

test("formatGauge renders a full 16-cell gauge at 150 tok/s", () => {
  assert.equal(formatGauge(GAUGE_MAX_TPS), "█".repeat(16));
});

test("formatGauge renders a half-filled gauge at 75 tok/s", () => {
  assert.equal(formatGauge(75), "█".repeat(8) + TRACK.repeat(8));
});

test("formatGauge renders fractional sub-blocks at 15 and 35 tok/s", () => {
  assert.equal(formatGauge(15), "█▋" + TRACK.repeat(14));
  assert.equal(formatGauge(35), "███▊" + TRACK.repeat(12));
});

test("formatGauge tracks the unfilled remainder with '·'", () => {
  assert.equal(formatGauge(20), "██▏" + TRACK.repeat(13));
});

test("formatGauge clamps out-of-range and non-finite rates", () => {
  assert.equal(formatGauge(-10), TRACK.repeat(16));
  assert.equal(formatGauge(1000), "█".repeat(16));
  assert.equal(formatGauge(NaN), TRACK.repeat(16));
});

test("formatGauge renders a narrow 8-cell gauge", () => {
  assert.equal(formatGauge(75, 8), "████" + TRACK.repeat(4));
  assert.equal(formatGauge(0, 8), TRACK.repeat(8));
});

// ---------------------------------------------------------------------------
// formatSparkline
// ---------------------------------------------------------------------------

test("formatSparkline renders the eight ascending block levels", () => {
  assert.equal(formatSparkline([0, 1, 2, 3, 4, 5, 6, 7]), "▁▂▃▄▅▆▇█");
});

test("formatSparkline keeps oldest-first chronological order", () => {
  assert.equal(formatSparkline([7, 1, 4]), "█▂▅");
});

test("formatSparkline handles empty and all-zero histories", () => {
  assert.equal(formatSparkline([]), "");
  assert.equal(formatSparkline([0, 0, 0]), "▁▁▁");
});

// ---------------------------------------------------------------------------
// Triangulation: determinism and exact boundary behavior
// ---------------------------------------------------------------------------

test("gauge and sparkline are byte-identical across repeated renders", () => {
  assert.equal(formatGauge(15), formatGauge(15));
  assert.equal(formatGauge(75), formatGauge(75));
  assert.equal(formatSparkline([1, 2, 3]), formatSparkline([1, 2, 3]));
});

test("formatGauge boundaries are exact at empty and full", () => {
  assert.equal(formatGauge(0), TRACK.repeat(16));
  assert.equal(formatGauge(GAUGE_MAX_TPS), "█".repeat(16));
  assert.equal(formatGauge(GAUGE_MAX_TPS + 1), "█".repeat(16));
  assert.equal(formatGauge(-0.0001), TRACK.repeat(16));
});

test("formatSparkline normalizes the history maximum to the top block", () => {
  // max = 9 → █; 6 → ▆; 3 → ▃; 0 → ▁.
  assert.equal(formatSparkline([0, 3, 6, 9]), "▁▃▆█");
});
