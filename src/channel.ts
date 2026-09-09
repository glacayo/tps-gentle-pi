// Cross-process IPC channel: private session directory, atomic snapshot
// publication, throttled writes, and worker snapshot cleanup.
//
// Every operation degrades silently — no function in this module throws. All
// failures surface as `null` or a `WriteResult` status so the parent keeps its
// main-agent meter alive while subagent rows degrade to absent. Only Node
// builtins are used; there are no shell subprocess calls. Node 24 executes this
// file directly via native type stripping.

import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { THROTTLE_MS } from "./types.ts";
import type { WorkerSnapshot } from "./types.ts";

/** Name of the ownership marker file inside each session directory. */
export const OWNER_FILENAME = ".owner";

/** Prefix shared by every package-owned session directory and the scavenger. */
export const DIR_PREFIX = "pi-tps-";

/** Ownership marker kept at the session directory root. */
export interface OwnerMarker {
  pid: number;
  created: number;
  v: number;
}

/** Outcome of an atomic publication attempt. */
export type WriteResult = "ok" | "retry" | "failed";

export interface SessionDirOptions {
  /** Temp root; defaults to `os.tmpdir()`. */
  tmpDir?: string;
  /** Platform name used only for test injection; defaults to `process.platform`. */
  platform?: string;
}

export interface WriteOptions {
  platform?: string;
}

export interface ThrottledPublisherOptions {
  platform?: string;
}

export interface PublishOptions {
  /** A significant transition flushes immediately, bypassing and resetting the window. */
  significant?: boolean;
}

function workerFileName(pid: number): string {
  return `worker-${pid}.json`;
}

function isWindows(platform: string): boolean {
  return platform === "win32";
}

function randomSuffix(): string {
  try {
    return randomBytes(4).toString("hex");
  } catch {
    return Math.random().toString(16).slice(2);
  }
}

function writeFilePrivate(
  filePath: string,
  data: string,
  mode: number | undefined,
): void {
  if (mode === undefined) {
    fs.writeFileSync(filePath, data);
  } else {
    fs.writeFileSync(filePath, data, { mode });
  }
}

function tryUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // best-effort; the file may already be gone
  }
}

function isRetryableError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return code === "EBUSY" || code === "EPERM";
  }
  return false;
}

/**
 * Creates a unique, unpredictable package-owned session directory under the
 * temp root and writes the `.owner` marker. Returns the directory path, or
 * `null` when creation fails (never throws).
 */
export function createSessionDirectory(
  options: SessionDirOptions = {},
): string | null {
  let root: string;
  try {
    root = options.tmpDir ?? tmpdir();
  } catch {
    return null;
  }

  const platform = options.platform ?? process.platform;
  const name = `${DIR_PREFIX}${process.pid}-${Date.now()}-${randomSuffix()}`;
  const dir = join(root, name);

  try {
    if (isWindows(platform)) {
      fs.mkdirSync(dir);
    } else {
      fs.mkdirSync(dir, { mode: 0o700 });
    }
  } catch {
    return null;
  }

  const owner: OwnerMarker = { pid: process.pid, created: Date.now(), v: 1 };
  try {
    writeFilePrivate(
      join(dir, OWNER_FILENAME),
      JSON.stringify(owner),
      isWindows(platform) ? undefined : 0o600,
    );
  } catch {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort directory rollback
    }
    return null;
  }

  return dir;
}

/**
 * Serializes `snapshot` and publishes it atomically via a private temp file
 * followed by a rename. On POSIX the temp file uses mode `0o600`. On Windows a
 * rename that fails with `EBUSY`/`EPERM` is reported as `"retry"` after the
 * temp file is unlinked so the caller can retry on the next throttle tick.
 */
export function writeSnapshotAtomic(
  sessionDir: string,
  pid: number,
  snapshot: WorkerSnapshot,
  options: WriteOptions = {},
): WriteResult {
  const platform = options.platform ?? process.platform;
  const finalPath = join(sessionDir, workerFileName(pid));
  const tmpPath = join(
    sessionDir,
    `.worker-${pid}.${Date.now()}-${randomSuffix()}.tmp`,
  );

  let json: string;
  try {
    json = JSON.stringify(snapshot);
  } catch {
    return "failed";
  }

  try {
    writeFilePrivate(tmpPath, json, isWindows(platform) ? undefined : 0o600);
  } catch {
    tryUnlink(tmpPath);
    return "failed";
  }

  try {
    fs.renameSync(tmpPath, finalPath);
    return "ok";
  } catch (error) {
    tryUnlink(tmpPath);
    if (isWindows(platform) && isRetryableError(error)) {
      return "retry";
    }
    return "failed";
  }
}

/** Best-effort removal of a worker's snapshot and any residual temp files. */
export function unlinkWorkerSnapshot(sessionDir: string, pid: number): void {
  tryUnlink(join(sessionDir, workerFileName(pid)));

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(sessionDir);
  } catch {
    return;
  }

  const prefix = `.worker-${pid}.`;
  for (const entry of entries) {
    if (entry.startsWith(prefix) && entry.endsWith(".tmp")) {
      tryUnlink(join(sessionDir, entry));
    }
  }
}

/**
 * Coalesces rapid snapshot updates into at most one disk write per throttle
 * window, while flushing significant transitions immediately. The trailing
 * write always carries the most recent pending snapshot.
 */
export class ThrottledPublisher {
  private readonly dir: string;
  private readonly pid: number;
  private readonly platform: string;

  private pending: WorkerSnapshot | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastWrite = Number.NEGATIVE_INFINITY;
  private closed = false;

  constructor(
    dir: string,
    pid: number,
    options: ThrottledPublisherOptions = {},
  ) {
    this.dir = dir;
    this.pid = pid;
    this.platform = options.platform ?? process.platform;
  }

  publish(snapshot: WorkerSnapshot, options: PublishOptions = {}): void {
    if (this.closed) return;
    this.pending = snapshot;

    if (options.significant) {
      this.attemptWrite(snapshot);
      return;
    }

    const elapsed = Date.now() - this.lastWrite;
    if (elapsed >= THROTTLE_MS) {
      this.attemptWrite(snapshot);
      return;
    }

    this.scheduleTrailing(THROTTLE_MS - elapsed);
  }

  /** Forces any pending trailing write immediately (used for deterministic shutdown and tests). */
  flush(): void {
    if (this.closed) return;
    this.clearTimer();
    if (this.pending) {
      const latest = this.pending;
      this.attemptWrite(latest);
    }
  }

  /** Cancels pending timers and unlinks the worker snapshot on normal shutdown. */
  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    this.pending = null;
    unlinkWorkerSnapshot(this.dir, this.pid);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private attemptWrite(snapshot: WorkerSnapshot): void {
    this.lastWrite = Date.now();
    this.clearTimer();

    const result = writeSnapshotAtomic(this.dir, this.pid, snapshot, {
      platform: this.platform,
    });

    if (result === "retry") {
      // Keep the pending snapshot and retry on the next throttle tick.
      this.scheduleTrailing(THROTTLE_MS);
      return;
    }

    this.pending = null;
  }

  private scheduleTrailing(ms: number): void {
    if (this.closed || this.timer) return;
    const delay = Math.max(0, ms);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pending) {
        const latest = this.pending;
        this.attemptWrite(latest);
      }
    }, delay);
    this.timer.unref?.();
  }
}
