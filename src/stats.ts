// Pure, side-effect-free statistics primitives for the TPS meter.
//
// These helpers keep no ambient mutable global state and perform no I/O, so
// they are unit-testable without a Pi runtime. Node 24 executes this file
// directly via native type stripping.

/** Number of samples buffered during the P² bootstrap phase. */
export const P2_BOOTSTRAP_SAMPLES = 64;

/** Default quantile tracked by the P² sketch. */
export const DEFAULT_P2_QUANTILE = 0.95;

/** Default capacity of the bounded sparkline ring buffer. */
export const SPARKLINE_CAPACITY = 12;

/** Target quantile fractions for the five P² markers (indexes 0..4). */
function markerFractions(p: number): number[] {
  return [0, p / 2, p, (1 + p) / 2, 1];
}

/**
 * Jain & Chlamtac's P² streaming quantile sketch.
 *
 * Estimates a single quantile (default p = 0.95) using exactly five markers, in
 * O(1) memory and O(1) update time. The first `bootstrapSize` samples are
 * buffered; upon the final bootstrap sample the buffer is sorted and marker
 * heights are seeded at the exact sample quantiles (0, p/2, p, (1+p)/2, 1)
 * before the buffer is released. Streaming updates use the algorithm's linear
 * fallback in both directions: it converges stably (the parabolic variant
 * overshoots for high quantiles of heavy-tailed distributions).
 */
export class P2Quantile {
  readonly quantile: number;
  readonly bootstrapSize: number;

  private readonly markers: number[] = [NaN, NaN, NaN, NaN, NaN];
  private readonly positions: number[] = [1, 2, 3, 4, 5];
  private readonly fractions: number[];
  private bootstrap: number[] = [];
  private sampleCount = 0;

  constructor(
    quantile = DEFAULT_P2_QUANTILE,
    bootstrapSize = P2_BOOTSTRAP_SAMPLES,
  ) {
    this.quantile = quantile;
    this.bootstrapSize = bootstrapSize;
    this.fractions = markerFractions(quantile);
  }

  /** Number of finite samples accepted so far. */
  get count(): number {
    return this.sampleCount;
  }

  /** Whether the bootstrap phase has completed and the sketch is streaming. */
  get isBootstrapped(): boolean {
    return this.sampleCount >= this.bootstrapSize;
  }

  /** Number of individual samples still retained in the bootstrap buffer. */
  get bootstrapBufferSize(): number {
    return this.bootstrap.length;
  }

  /** Current estimate of the tracked quantile (NaN before bootstrap completes). */
  get value(): number {
    return this.markers[2];
  }

  update(sample: number): void {
    if (!Number.isFinite(sample)) return;

    this.sampleCount += 1;

    if (this.sampleCount < this.bootstrapSize) {
      this.bootstrap.push(sample);
      return;
    }

    if (this.sampleCount === this.bootstrapSize) {
      this.bootstrap.push(sample);
      this.seedMarkers();
      return;
    }

    this.ingest(sample);
  }

  private seedMarkers(): void {
    const sorted = [...this.bootstrap].sort((a, b) => a - b);
    const last = this.bootstrapSize - 1;
    for (let i = 0; i < 5; i++) {
      const rank = this.fractions[i] * last;
      const lo = Math.floor(rank);
      const hi = Math.ceil(rank);
      const w = rank - lo;
      this.markers[i] = sorted[lo] * (1 - w) + sorted[hi] * w;
      this.positions[i] = 1 + rank;
    }
    this.bootstrap = [];
  }

  private desiredPosition(i: number): number {
    return 1 + (this.sampleCount - 1) * this.fractions[i];
  }

  private ingest(x: number): void {
    const q = this.markers;
    const n = this.positions;

    let k: number;
    if (x < q[0]) {
      q[0] = x;
      k = 0;
    } else if (x < q[1]) {
      k = 0;
    } else if (x < q[2]) {
      k = 1;
    } else if (x < q[3]) {
      k = 2;
    } else if (x < q[4]) {
      k = 3;
    } else {
      q[4] = x;
      k = 3;
    }

    // Shift the position of every marker at or to the right of the cell.
    for (let i = k + 1; i < 5; i++) n[i] += 1;

    // Adjust heights of the three interior markers via linear interpolation.
    for (let i = 1; i <= 3; i++) {
      const d = this.desiredPosition(i) - n[i];
      if (d >= 1 && n[i + 1] - n[i] > 1) {
        q[i] = q[i] + (q[i + 1] - q[i]) / (n[i + 1] - n[i]);
      } else if (d <= -1 && n[i - 1] - n[i] < -1) {
        q[i] = q[i] - (q[i] - q[i - 1]) / (n[i] - n[i - 1]);
      }
    }
  }
}

/** Fixed-capacity FIFO buffer used for the bounded 12-turn sparkline. */
export class RingBuffer {
  readonly capacity: number;

  private readonly buf: number[] = [];

  constructor(capacity = SPARKLINE_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("RingBuffer capacity must be a positive integer");
    }
    this.capacity = capacity;
  }

  get size(): number {
    return this.buf.length;
  }

  push(value: number): void {
    if (this.buf.length === this.capacity) {
      this.buf.shift();
    }
    this.buf.push(value);
  }

  /** Returns a copy of the buffer in chronological (oldest-first) order. */
  toArray(): number[] {
    return [...this.buf];
  }
}

/** Incremental arithmetic mean with O(1) storage (a running sum and count). */
export class IncrementalMean {
  private samples = 0;
  private sum = 0;

  get count(): number {
    return this.samples;
  }

  add(value: number): void {
    if (!Number.isFinite(value) || value <= 0) return;
    this.samples += 1;
    this.sum += value;
  }

  get value(): number {
    return this.samples > 0 ? this.sum / this.samples : 0;
  }
}

/**
 * Computes tokens per second from an accumulated token count and elapsed time.
 *
 * Elapsed time is measured in milliseconds from the first observed output
 * delta, not from the message start. Non-finite, zero, or negative inputs
 * yield 0 rather than NaN or Infinity.
 */
export function computeTps(tokens: number, elapsedMs: number): number {
  if (!Number.isFinite(tokens) || !Number.isFinite(elapsedMs)) return 0;
  if (tokens <= 0 || elapsedMs <= 0) return 0;
  return tokens / (elapsedMs / 1000);
}
