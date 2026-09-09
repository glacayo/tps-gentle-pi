// IPC guard: snapshot schema validation, validated aggregation, dead/stale/
// completed worker eviction, ownership-safe cleanup, and the startup scavenger.
//
// Every operation degrades silently — no function in this module throws. Invalid
// or unreadable snapshots are skipped before they can influence aggregation, and
// cleanup/scavenging refuse to touch anything outside a package-owned `pi-tps-*`
// directory. Only Node builtins are used; there are no shell subprocess calls.

import fs from "node:fs";
import { basename, join } from "node:path";

import { DIR_PREFIX, OWNER_FILENAME } from "./channel.ts";
import type { OwnerMarker } from "./channel.ts";
import { sanitizeText } from "./format.ts";
import {
  SNAPSHOT_STRING_MAX_LENGTH,
  SNAPSHOT_VERSION,
  STALENESS_MS,
  WORKER_ID_MAX_LENGTH,
  WORKER_PHASES,
} from "./types.ts";
import type { WorkerPhase, WorkerSnapshot } from "./types.ts";

/** A package-owned directory must be older than this to be scavenged. */
export const SCAVENGE_AGE_MS = 60 * 60 * 1000;

/** Matches only well-formed worker snapshot filenames (`worker-<pid>.json`). */
const WORKER_FILE = /^worker-\d+\.json$/;

/** Sentinel returned by `parseOptionalText` for a present-but-wrong-typed field. */
const INVALID = Symbol("invalid");

export interface GuardOptions {
  /** PID liveness probe; defaults to `process.kill(pid, 0)`. */
  kill?: (pid: number, signal: number) => void;
  /** Clock; defaults to `Date.now`. */
  now?: () => number;
}

function defaultNow(): number {
  return Date.now();
}

function defaultKill(pid: number, signal: number): void {
  process.kill(pid, signal);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isWorkerPhase(value: unknown): value is WorkerPhase {
  return (
    typeof value === "string" &&
    (WORKER_PHASES as readonly string[]).includes(value)
  );
}

type OptionalText = string | undefined | typeof INVALID;

/**
 * Validates one optional string field. `undefined` means absent (fine), a
 * non-string means invalid, and a string is sanitized/clamped per design §3.
 */
function parseOptionalText(value: unknown): OptionalText {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return INVALID;
  return sanitizeText(value, SNAPSHOT_STRING_MAX_LENGTH);
}

/**
 * Validates an untrusted snapshot payload against design §3 and returns a fresh
 * object containing only the whitelisted fields. Returns `null` on any schema
 * violation and never throws. Unknown/extra fields (prompt, task, output) are
 * dropped, so the result provably carries no content text.
 */
export function validateWorkerSnapshot(data: unknown): WorkerSnapshot | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const d = data as Record<string, unknown>;

  if (d.v !== SNAPSHOT_VERSION) return null;
  if (!isPositiveInteger(d.pid)) return null;
  if (
    typeof d.workerId !== "string" ||
    d.workerId.length === 0 ||
    d.workerId.length > WORKER_ID_MAX_LENGTH
  ) {
    return null;
  }
  if (!isPositiveNumber(d.startTime)) return null;
  if (!isPositiveNumber(d.updatedAt)) return null;
  if (!isWorkerPhase(d.phase)) return null;
  if (!isNonNegativeNumber(d.tps)) return null;
  if (!isNonNegativeNumber(d.messageTokens)) return null;
  if (!isNonNegativeNumber(d.totalTokens)) return null;

  const snapshot: WorkerSnapshot = {
    v: SNAPSHOT_VERSION,
    pid: d.pid,
    workerId: d.workerId,
    startTime: d.startTime,
    updatedAt: d.updatedAt,
    phase: d.phase,
    tps: d.tps,
    messageTokens: d.messageTokens,
    totalTokens: d.totalTokens,
  };

  const model = parseOptionalText(d.model);
  if (model === INVALID) return null;
  if (model !== undefined) snapshot.model = model;

  const thinkingLevel = parseOptionalText(d.thinkingLevel);
  if (thinkingLevel === INVALID) return null;
  if (thinkingLevel !== undefined) snapshot.thinkingLevel = thinkingLevel;

  const activeTool = parseOptionalText(d.activeTool);
  if (activeTool === INVALID) return null;
  if (activeTool !== undefined) snapshot.activeTool = activeTool;

  if (d.completedAt !== undefined) {
    if (!isPositiveNumber(d.completedAt)) return null;
    snapshot.completedAt = d.completedAt;
  }

  return snapshot;
}

/**
 * Probes whether a PID is still alive. Only `ESRCH` is treated as death; `EPERM`
 * and other errors are treated as alive so a merely unreadable process is never
 * wrongly evicted.
 */
export function isPidAlive(pid: number, options: GuardOptions = {}): boolean {
  const kill = options.kill ?? defaultKill;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "ESRCH"
    ) {
      return false;
    }
    return true;
  }
}

type EvictionReason = "dead" | "stale" | "complete";

function evictionReason(
  snapshot: WorkerSnapshot,
  options: GuardOptions,
): EvictionReason | null {
  if (snapshot.phase === "complete") return "complete";
  const now = (options.now ?? defaultNow)();
  if (now - snapshot.updatedAt > STALENESS_MS) return "stale";
  if (!isPidAlive(snapshot.pid, options)) return "dead";
  return null;
}

function tryUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // best-effort; the file may already be gone
  }
}

type FileRead =
  | { outcome: "skip" }
  | { outcome: "evict" }
  | { outcome: "keep"; snapshot: WorkerSnapshot };

/** Reads one snapshot file into a skip/evict/keep decision (no side effects). */
function readWorkerFile(filePath: string, options: GuardOptions): FileRead {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return { outcome: "skip" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { outcome: "skip" }; // truncated or unreadable JSON is skipped
  }

  const snapshot = validateWorkerSnapshot(parsed);
  if (snapshot === null) return { outcome: "skip" }; // validation before aggregation
  if (evictionReason(snapshot, options) !== null) return { outcome: "evict" };
  return { outcome: "keep", snapshot };
}

/**
 * Reads and validates every `worker-<pid>.json` snapshot in the session
 * directory, evicting dead, stale, or completed workers and skipping malformed or
 * wrongly-shaped files. Returns live snapshots sorted by pid (ascending).
 */
export function readWorkerSnapshots(
  sessionDir: string,
  options: GuardOptions = {},
): WorkerSnapshot[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(sessionDir);
  } catch {
    return [];
  }

  const snapshots: WorkerSnapshot[] = [];
  for (const entry of entries) {
    if (!WORKER_FILE.test(entry)) continue;
    const filePath = join(sessionDir, entry);
    const result = readWorkerFile(filePath, options);
    if (result.outcome === "skip") continue;
    if (result.outcome === "evict") {
      tryUnlink(filePath);
      continue;
    }
    snapshots.push(result.snapshot);
  }

  snapshots.sort((a, b) => a.pid - b.pid);
  return snapshots;
}

/** Reads and validates the `.owner` marker, returning `null` when absent/invalid. */
function readOwner(dir: string): OwnerMarker | null {
  let raw: string;
  try {
    raw = fs.readFileSync(join(dir, OWNER_FILENAME), "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const owner = parsed as Record<string, unknown>;
  if (owner.v !== SNAPSHOT_VERSION) return null;
  if (!isPositiveInteger(owner.pid)) return null;
  if (!isPositiveNumber(owner.created)) return null;
  return parsed as OwnerMarker;
}

/**
 * Scans the temp root for `pi-tps-*` directories and removes only those that are
 * positively package-owned (valid `.owner` marker), whose owner PID is dead, and
 * that are older than `SCAVENGE_AGE_MS`. Returns the paths actually removed.
 * Foreign or markerless directories are always left untouched.
 */
export function scavengeStaleDirectories(
  tmpDir: string,
  options: GuardOptions = {},
): string[] {
  const now = (options.now ?? defaultNow)();
  let entries: string[];
  try {
    entries = fs.readdirSync(tmpDir);
  } catch {
    return [];
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(DIR_PREFIX)) continue;
    const dir = join(tmpDir, entry);

    const owner = readOwner(dir);
    if (owner === null) continue; // foreign or markerless — leave untouched
    if (isPidAlive(owner.pid, options)) continue; // owner still running
    if (now - owner.created <= SCAVENGE_AGE_MS) continue; // not old enough

    try {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch {
      // best-effort; a failure here must never crash the session
    }
  }
  return removed;
}

/**
 * Recursively removes a package-owned session directory. Refuses anything whose
 * basename is not `pi-tps-*` so an accidental foreign path can never be deleted.
 * Returns whether the directory was removed.
 */
export function removeSessionDirectory(sessionDir: unknown): boolean {
  if (typeof sessionDir !== "string" || sessionDir.length === 0) return false;
  if (!basename(sessionDir).startsWith(DIR_PREFIX)) return false;
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
