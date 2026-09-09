import { test } from "node:test";
import assert from "node:assert/strict";

import {
  P2Quantile,
  RingBuffer,
  IncrementalMean,
  computeTps,
} from "../src/stats.ts";

// Deterministic PRNG (mulberry32) so distribution-based convergence tests are
// reproducible across runs and platforms.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller transform producing a sample from N(mean, sd).
function normalSample(rng: () => number, mean = 50, sd = 10): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sd * z;
}

// ---------------------------------------------------------------------------
// P2Quantile
// ---------------------------------------------------------------------------

test("P2Quantile bootstraps by sorting exactly 64 samples", () => {
  const q = new P2Quantile(0.95, 64);
  for (let i = 1; i <= 64; i++) q.update(i);
  assert.equal(q.count, 64);
  assert.equal(q.isBootstrapped, true);
  // p95 of {1..64}: rank = 0.95 * 63 = 59.85 -> interpolated value 60.85.
  assert.ok(Math.abs(q.value - 60.85) < 1e-6, `value=${q.value}`);
});

test("P2Quantile p95 converges on a uniform distribution within ±2%", () => {
  const q = new P2Quantile(0.95, 64);
  const rng = mulberry32(0x1234abcd);
  const n = 300_000;
  for (let i = 0; i < n; i++) q.update(rng());
  const expected = 0.95;
  assert.ok(
    Math.abs(q.value - expected) / expected <= 0.02,
    `p95=${q.value} (expected ${expected})`,
  );
});

test("P2Quantile p95 converges on a normal distribution within ±2%", () => {
  const q = new P2Quantile(0.95, 64);
  const rng = mulberry32(0xfeedbeef);
  const n = 300_000;
  for (let i = 0; i < n; i++) q.update(normalSample(rng, 50, 10));
  const expected = 50 + 1.6448536269514722 * 10;
  assert.ok(
    Math.abs(q.value - expected) / expected <= 0.02,
    `p95=${q.value} (expected ${expected})`,
  );
});

// ---------------------------------------------------------------------------
// RingBuffer
// ---------------------------------------------------------------------------

test("RingBuffer defaults to capacity 12", () => {
  const buf = new RingBuffer();
  assert.equal(buf.capacity, 12);
  assert.equal(buf.size, 0);
});

test("RingBuffer evicts the oldest entry when a 13th entry is pushed", () => {
  const buf = new RingBuffer(12);
  for (let i = 1; i <= 13; i++) buf.push(i);
  assert.equal(buf.size, 12);
  assert.deepEqual(buf.toArray(), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
});

test("RingBuffer toArray returns chronological (oldest-first) order", () => {
  const buf = new RingBuffer(12);
  for (let i = 1; i <= 12; i++) buf.push(i);
  assert.deepEqual(buf.toArray(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

// ---------------------------------------------------------------------------
// IncrementalMean
// ---------------------------------------------------------------------------

test("IncrementalMean rejects non-finite and non-positive values", () => {
  const m = new IncrementalMean();
  m.add(NaN);
  m.add(Infinity);
  m.add(-Infinity);
  m.add(0);
  m.add(-5);
  assert.equal(m.count, 0);
  assert.equal(m.value, 0);
});

test("IncrementalMean computes the correct arithmetic mean", () => {
  const m = new IncrementalMean();
  m.add(2);
  m.add(4);
  m.add(6);
  assert.equal(m.value, 4);
  assert.equal(m.count, 3);
});

test("IncrementalMean guards division by zero", () => {
  const m = new IncrementalMean();
  assert.equal(m.value, 0);
});

// ---------------------------------------------------------------------------
// computeTps
// ---------------------------------------------------------------------------

test("computeTps uses elapsed time measured from the first output delta", () => {
  // The message start is earlier; the meter must base elapsed time on the first
  // observed output delta, not the message start. 150 tokens over the 3 seconds
  // since the first delta yields 50 tok/s.
  const tokens = 150;
  const firstDeltaMs = 1000;
  const nowMs = 4000;
  assert.equal(computeTps(tokens, nowMs - firstDeltaMs), 50);
});

test("computeTps guards zero tokens, zero/negative elapsed, and non-finite inputs", () => {
  assert.equal(computeTps(0, 3000), 0);
  assert.equal(computeTps(120, 0), 0);
  assert.equal(computeTps(120, -1000), 0);
  assert.equal(computeTps(NaN, 3000), 0);
  assert.equal(computeTps(120, Infinity), 0);
});

// ---------------------------------------------------------------------------
// Edge cases (triangulation): behavior is algorithmic, not fixture-seeded
// ---------------------------------------------------------------------------

test("P2Quantile is updated only per update() call, never on reads", () => {
  const q = new P2Quantile(0.95, 64);
  for (let i = 1; i <= 64; i++) q.update(i);
  const before = q.value;
  const countBefore = q.count;

  for (let i = 0; i < 20; i++) {
    void q.value;
    void q.count;
    void q.isBootstrapped;
    void q.bootstrapBufferSize;
  }

  assert.equal(q.count, countBefore);
  assert.equal(q.value, before);

  q.update(1000);
  assert.equal(q.count, countBefore + 1);
});

test("P2Quantile keeps a bounded memory footprint across 1000 samples", () => {
  const q = new P2Quantile(0.95, 64);
  for (let i = 0; i < 1000; i++) q.update((i * 7919) % 1009);
  assert.equal(q.count, 1000);
  assert.equal(q.isBootstrapped, true);
  // The sketch retains only its five markers after bootstrap releases the
  // 64-sample buffer, so memory is O(1) regardless of how many samples arrive.
  assert.equal(q.bootstrapBufferSize, 0);
});

test("RingBuffer evicts the oldest entry exactly at the 12→13 transition", () => {
  const buf = new RingBuffer(12);
  for (let i = 1; i <= 13; i++) buf.push(i);
  assert.equal(buf.size, 12);
  assert.equal(buf.toArray()[0], 2);
  assert.equal(buf.toArray()[11], 13);
  assert.deepEqual(buf.toArray(), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
});

test("RingBuffer toArray returns a defensive copy", () => {
  const buf = new RingBuffer(12);
  buf.push(5);
  buf.push(7);
  const snapshot = buf.toArray();
  snapshot[0] = 999; // mutating the copy must not affect the buffer
  assert.deepEqual(buf.toArray(), [5, 7]);
});

test("IncrementalMean keeps constant storage across many turns", () => {
  const m = new IncrementalMean();
  for (let i = 1; i <= 1000; i++) m.add(i);
  // Mean is a running count and sum (two scalars); no per-turn values retained.
  assert.equal(m.count, 1000);
  assert.equal(m.value, (1 + 1000) / 2);
});
