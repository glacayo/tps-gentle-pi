// IPC guard tests: snapshot schema validation, validated aggregation, dead/stale/
// completed worker eviction, ownership-safe cleanup, and the startup scavenger.
//
// Node 24 executes this file directly via native type stripping. Like the WU-4
// channel tests, these exercise real filesystem behavior confined to temp dirs
// under `os.tmpdir()` and never shell out.

import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SCAVENGE_AGE_MS,
  isPidAlive,
  readWorkerSnapshots,
  removeSessionDirectory,
  scavengeStaleDirectories,
  validateWorkerSnapshot,
} from "../src/channel-guard.ts";
import {
  DIR_PREFIX,
  OWNER_FILENAME,
  createSessionDirectory,
  writeSnapshotAtomic,
} from "../src/channel.ts";
import { COMPLETED_PERSIST_MS, STALENESS_MS } from "../src/types.ts";
import type { WorkerSnapshot } from "../src/types.ts";

/** Fixed clock base so staleness/scavenge assertions never race the wall clock. */
const NOW = 1_700_000_000_000;

const fixedNow = (): number => NOW;

function makeBase(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tps-guard-"));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort fixture cleanup
    }
  });
  return dir;
}

function makeSnapshot(overrides: Partial<WorkerSnapshot> = {}): WorkerSnapshot {
  return {
    v: 1,
    pid: 4242,
    workerId: "worker-4242",
    startTime: NOW - 1000,
    updatedAt: NOW,
    phase: "streaming",
    tps: 42.5,
    messageTokens: 100,
    totalTokens: 1000,
    ...overrides,
  };
}

function writeWorker(dir: string, snapshot: WorkerSnapshot): string {
  const file = path.join(dir, `worker-${snapshot.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot));
  return file;
}

function aliveKill(): (pid: number, signal: number) => unknown {
  return () => undefined;
}

function deadKill(): (pid: number, signal: number) => unknown {
  return () => {
    const err = new Error("ESRCH: no such process");
    (err as NodeJS.ErrnoException).code = "ESRCH";
    throw err;
  };
}

function killMap(
  alive: Record<number, boolean>,
): (pid: number, signal: number) => unknown {
  return (pid) => {
    if (alive[pid]) return undefined;
    const err = new Error("ESRCH: no such process");
    (err as NodeJS.ErrnoException).code = "ESRCH";
    throw err;
  };
}

// ---------------------------------------------------------------------------
// validateWorkerSnapshot
// ---------------------------------------------------------------------------

test("validateWorkerSnapshot rejects null, arrays, and non-object primitives", () => {
  assert.strictEqual(validateWorkerSnapshot(null), null);
  assert.strictEqual(validateWorkerSnapshot([]), null);
  assert.strictEqual(validateWorkerSnapshot([1, 2]), null);
  assert.strictEqual(validateWorkerSnapshot("streaming"), null);
  assert.strictEqual(validateWorkerSnapshot(42), null);
  assert.strictEqual(validateWorkerSnapshot(true), null);
  assert.strictEqual(validateWorkerSnapshot(undefined), null);
});

test("validateWorkerSnapshot rejects a wrong schema version", () => {
  assert.strictEqual(validateWorkerSnapshot(makeSnapshot({ v: 2 })), null);
  assert.strictEqual(validateWorkerSnapshot(makeSnapshot({ v: 0 })), null);
  const { v: _v, ...missing } = makeSnapshot();
  assert.strictEqual(validateWorkerSnapshot(missing), null);
});

test("validateWorkerSnapshot rejects an invalid pid", () => {
  assert.strictEqual(validateWorkerSnapshot(makeSnapshot({ pid: 0 })), null);
  assert.strictEqual(validateWorkerSnapshot(makeSnapshot({ pid: -5 })), null);
  assert.strictEqual(validateWorkerSnapshot(makeSnapshot({ pid: 1.5 })), null);
  const withStringPid = { ...makeSnapshot(), pid: "42" } as unknown;
  assert.strictEqual(validateWorkerSnapshot(withStringPid), null);
});

test("validateWorkerSnapshot rejects an invalid workerId", () => {
  assert.strictEqual(
    validateWorkerSnapshot(makeSnapshot({ workerId: "" })),
    null,
  );
  assert.strictEqual(
    validateWorkerSnapshot(makeSnapshot({ workerId: "w".repeat(129) })),
    null,
  );
  assert.ok(
    validateWorkerSnapshot(makeSnapshot({ workerId: "w".repeat(128) })),
  );
  const { workerId: _w, ...missing } = makeSnapshot();
  assert.strictEqual(validateWorkerSnapshot(missing), null);
});

test("validateWorkerSnapshot rejects invalid startTime and updatedAt", () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
    assert.strictEqual(
      validateWorkerSnapshot(makeSnapshot({ startTime: bad } as never)),
      null,
      `startTime ${String(bad)} rejected`,
    );
    assert.strictEqual(
      validateWorkerSnapshot(makeSnapshot({ updatedAt: bad } as never)),
      null,
      `updatedAt ${String(bad)} rejected`,
    );
  }
  const { startTime: _s, ...missingStart } = makeSnapshot();
  assert.strictEqual(validateWorkerSnapshot(missingStart), null);
});

test("validateWorkerSnapshot rejects an invalid phase", () => {
  for (const bad of ["idle", "", "STREAMING", 7, "tool "]) {
    assert.strictEqual(
      validateWorkerSnapshot(makeSnapshot({ phase: bad } as never)),
      null,
      `phase ${String(bad)} rejected`,
    );
  }
});

test("validateWorkerSnapshot rejects out-of-bounds counters but accepts zero", () => {
  assert.strictEqual(validateWorkerSnapshot(makeSnapshot({ tps: -1 })), null);
  assert.strictEqual(
    validateWorkerSnapshot(makeSnapshot({ tps: Number.NaN })),
    null,
  );
  assert.strictEqual(
    validateWorkerSnapshot(makeSnapshot({ tps: Number.POSITIVE_INFINITY })),
    null,
  );
  assert.strictEqual(
    validateWorkerSnapshot(makeSnapshot({ messageTokens: -1 })),
    null,
  );
  assert.strictEqual(
    validateWorkerSnapshot(makeSnapshot({ totalTokens: -1 })),
    null,
  );

  assert.ok(
    validateWorkerSnapshot(
      makeSnapshot({ tps: 0, messageTokens: 0, totalTokens: 0 }),
    ),
  );
});

test("validateWorkerSnapshot clamps and sanitizes optional strings and rejects non-strings", () => {
  const clamped = validateWorkerSnapshot(
    makeSnapshot({ model: "m".repeat(100) }),
  );
  assert.strictEqual(clamped?.model, "m".repeat(64));

  const sanitized = validateWorkerSnapshot(
    makeSnapshot({ model: "clo\r\nde\u0007", activeTool: "re\nad" }),
  );
  assert.strictEqual(sanitized?.model, "clode");
  assert.strictEqual(sanitized?.activeTool, "read");

  assert.strictEqual(
    validateWorkerSnapshot(makeSnapshot({ model: 42 } as never)),
    null,
  );
});

test("validateWorkerSnapshot returns a complete snapshot for valid input and never throws", () => {
  const input = makeSnapshot({
    model: "claude-3-7-sonnet",
    thinkingLevel: "high",
    activeTool: "bash",
    completedAt: NOW,
    phase: "complete",
  });
  const out = validateWorkerSnapshot(input);
  assert.deepEqual(out, input);

  const hostile = [
    Object.create(null),
    () => undefined,
    Symbol("x"),
    3n,
    { v: 1 },
  ];
  for (const value of hostile) {
    assert.strictEqual(
      validateWorkerSnapshot(value),
      null,
      "hostile input never throws",
    );
  }
});

// ---------------------------------------------------------------------------
// Validated aggregation
// ---------------------------------------------------------------------------

test("readWorkerSnapshots reads only worker-<pid>.json files and sorts by pid", (t) => {
  const base = makeBase(t);
  const dir = path.join(base, "session");
  fs.mkdirSync(dir);

  writeWorker(dir, makeSnapshot({ pid: 222, workerId: "worker-222" }));
  writeWorker(dir, makeSnapshot({ pid: 111, workerId: "worker-111" }));
  fs.writeFileSync(path.join(dir, OWNER_FILENAME), "{}");
  fs.writeFileSync(path.join(dir, "worker-abc.json"), "{}");
  fs.writeFileSync(path.join(dir, ".worker-333.123-abcd.tmp"), "{}");
  fs.writeFileSync(path.join(dir, "notes.txt"), "{}");

  const snapshots = readWorkerSnapshots(dir, {
    now: fixedNow,
    kill: aliveKill(),
  });
  assert.deepEqual(
    snapshots.map((s) => s.pid),
    [111, 222],
    "only well-formed worker snapshot files survive, oldest pid first",
  );
});

test("readWorkerSnapshots skips malformed JSON without deleting it", (t) => {
  const base = makeBase(t);
  const dir = path.join(base, "session");
  fs.mkdirSync(dir);
  const file = path.join(dir, "worker-555.json");
  fs.writeFileSync(file, "not json");

  assert.deepEqual(
    readWorkerSnapshots(dir, { now: fixedNow, kill: aliveKill() }),
    [],
  );
  assert.ok(fs.existsSync(file), "malformed snapshot is skipped, not unlinked");
});

test("readWorkerSnapshots skips wrongly-shaped JSON without deleting it", (t) => {
  const base = makeBase(t);
  const dir = path.join(base, "session");
  fs.mkdirSync(dir);
  const file = path.join(dir, "worker-666.json");
  fs.writeFileSync(file, JSON.stringify({ v: 1 }));

  assert.deepEqual(
    readWorkerSnapshots(dir, { now: fixedNow, kill: aliveKill() }),
    [],
  );
  assert.ok(
    fs.existsSync(file),
    "wrongly-shaped snapshot is skipped, not unlinked",
  );
});

// ---------------------------------------------------------------------------
// Eviction
// ---------------------------------------------------------------------------

test("readWorkerSnapshots evicts dead-PID workers", (t) => {
  const base = makeBase(t);
  const dir = path.join(base, "session");
  fs.mkdirSync(dir);
  const file = writeWorker(dir, makeSnapshot({ pid: 9001, updatedAt: NOW }));

  assert.deepEqual(
    readWorkerSnapshots(dir, { now: fixedNow, kill: deadKill() }),
    [],
  );
  assert.strictEqual(
    fs.existsSync(file),
    false,
    "dead worker snapshot is unlinked",
  );
});

test("readWorkerSnapshots evicts stale workers past the 5000 ms window", (t) => {
  const base = makeBase(t);
  const dir = path.join(base, "session");
  fs.mkdirSync(dir);
  const file = writeWorker(
    dir,
    makeSnapshot({ pid: 9002, updatedAt: NOW - STALENESS_MS - 1000 }),
  );

  assert.deepEqual(
    readWorkerSnapshots(dir, { now: fixedNow, kill: aliveKill() }),
    [],
  );
  assert.strictEqual(
    fs.existsSync(file),
    false,
    "stale worker snapshot is unlinked",
  );
});

test("readWorkerSnapshots keeps a completed worker for the persistence window", (t: TestContext) => {
  const base = makeBase(t);
  const dir = path.join(base, "session");
  fs.mkdirSync(dir);
  const file = writeWorker(
    dir,
    makeSnapshot({ pid: 9003, phase: "complete", completedAt: NOW, tps: 0 }),
  );

  const [kept] = readWorkerSnapshots(dir, {
    now: () => NOW + COMPLETED_PERSIST_MS - 1,
    kill: aliveKill(),
  });
  assert.equal(kept?.pid, 9003, "the completed row stays visible");
  assert.equal(kept?.phase, "complete");
  assert.equal(kept?.completedAt, NOW);
  assert.ok(fs.existsSync(file), "snapshot is not unlinked inside the window");
});

test("readWorkerSnapshots evicts a completed worker after the persistence window", (t: TestContext) => {
  const base = makeBase(t);
  const dir = path.join(base, "session");
  fs.mkdirSync(dir);
  const file = writeWorker(
    dir,
    makeSnapshot({ pid: 9004, phase: "complete", completedAt: NOW, tps: 0 }),
  );

  assert.deepEqual(
    readWorkerSnapshots(dir, {
      now: () => NOW + COMPLETED_PERSIST_MS,
      kill: aliveKill(),
    }),
    [],
  );
  assert.strictEqual(fs.existsSync(file), false, "expired row unlinked");
});

test("readWorkerSnapshots evicts a completed snapshot with no completedAt", (t: TestContext) => {
  const base = makeBase(t);
  const dir = path.join(base, "session");
  fs.mkdirSync(dir);
  const file = writeWorker(
    dir,
    makeSnapshot({ pid: 9005, phase: "complete", tps: 0 }),
  );

  assert.deepEqual(
    readWorkerSnapshots(dir, { now: fixedNow, kill: aliveKill() }),
    [],
  );
  assert.strictEqual(fs.existsSync(file), false, "no window without a stamp");
});

test("isPidAlive treats only ESRCH as death", () => {
  assert.strictEqual(isPidAlive(1, { kill: aliveKill() }), true);
  assert.strictEqual(isPidAlive(1, { kill: deadKill() }), false);
  assert.strictEqual(
    isPidAlive(1, {
      kill: () => {
        const err = new Error("EPERM: operation not permitted");
        (err as NodeJS.ErrnoException).code = "EPERM";
        throw err;
      },
    }),
    true,
    "EPERM means the process may still exist",
  );
});

// ---------------------------------------------------------------------------
// Startup scavenger
// ---------------------------------------------------------------------------

test("scavengeStaleDirectories removes only verified stale owned dead dirs", (t) => {
  const base = makeBase(t);
  const ALIVE_PID = 1001;
  const DEAD_PID = 1002;

  const mk = (name: string): string => {
    const dir = path.join(base, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const owner = (pid: number, age: number, v = 1): string =>
    JSON.stringify({ v, pid, created: NOW - age });

  const staleDead = mk("pi-tps-stale-dead");
  fs.writeFileSync(
    path.join(staleDead, OWNER_FILENAME),
    owner(DEAD_PID, SCAVENGE_AGE_MS + 1000),
  );

  const freshDead = mk("pi-tps-fresh-dead");
  fs.writeFileSync(
    path.join(freshDead, OWNER_FILENAME),
    owner(DEAD_PID, SCAVENGE_AGE_MS - 60_000),
  );

  const aliveOld = mk("pi-tps-alive-old");
  fs.writeFileSync(
    path.join(aliveOld, OWNER_FILENAME),
    owner(ALIVE_PID, SCAVENGE_AGE_MS * 2),
  );

  const markerless = mk("pi-tps-markerless");

  const badOwner = mk("pi-tps-bad-owner");
  fs.writeFileSync(path.join(badOwner, OWNER_FILENAME), "not json");

  const wrongSchema = mk("pi-tps-wrong-schema");
  fs.writeFileSync(
    path.join(wrongSchema, OWNER_FILENAME),
    owner(DEAD_PID, SCAVENGE_AGE_MS * 2, 2),
  );

  const foreign = mk("unrelated-cache-dir");
  fs.writeFileSync(path.join(foreign, "index"), "keep");

  const removed = scavengeStaleDirectories(base, {
    now: fixedNow,
    kill: killMap({ [ALIVE_PID]: true, [DEAD_PID]: false }),
  });

  assert.deepEqual(
    removed,
    [staleDead],
    "only the verified stale owned dir is removed",
  );
  for (const kept of [
    freshDead,
    aliveOld,
    markerless,
    badOwner,
    wrongSchema,
    foreign,
  ]) {
    assert.ok(fs.existsSync(kept), `${path.basename(kept)} is preserved`);
  }
});

// ---------------------------------------------------------------------------
// Parent cleanup
// ---------------------------------------------------------------------------

test("removeSessionDirectory removes only its own package-owned directory", (t) => {
  const base = makeBase(t);
  const own = createSessionDirectory({ tmpDir: base });
  assert.ok(own);

  const foreignA = path.join(base, "keep-me");
  const foreignB = path.join(base, "pi-tps-sibling");
  fs.mkdirSync(foreignA);
  fs.mkdirSync(foreignB);
  fs.writeFileSync(path.join(foreignB, "keep.md"), "x");

  assert.strictEqual(removeSessionDirectory(own), true);
  assert.strictEqual(
    fs.existsSync(own),
    false,
    "own session directory removed",
  );
  assert.ok(fs.existsSync(foreignA), "non-package sibling preserved");
  assert.ok(fs.existsSync(foreignB), "different pi-tps directory preserved");

  assert.strictEqual(
    removeSessionDirectory(base),
    false,
    "refuses a non-package path",
  );
  assert.ok(fs.existsSync(base), "fixture root untouched");
});

// ---------------------------------------------------------------------------
// Privacy, torn writes, concurrent reads, and realistic foreign dirs
// ---------------------------------------------------------------------------

test("snapshot packets provably contain no prompt, task, or generated text", (t) => {
  const SECRET = "TOP-SECRET-PROMPT-9f3a";
  const base = makeBase(t);
  const dir = path.join(base, "session");
  fs.mkdirSync(dir);

  const direct = validateWorkerSnapshot({
    ...makeSnapshot(),
    prompt: SECRET,
    task: "describe the secret",
    output: "generated answer text",
    message: { text: SECRET },
  });
  assert.ok(direct);
  for (const key of ["prompt", "task", "output", "message", "text"]) {
    assert.ok(!(key in direct), `field ${key} is dropped`);
  }
  assert.ok(
    !JSON.stringify(direct).includes(SECRET),
    "secret never serialized",
  );

  const contaminated = JSON.stringify({
    ...makeSnapshot({ pid: 111 }),
    prompt: SECRET,
    task: "describe the secret",
    output: "generated answer text",
  });
  fs.writeFileSync(path.join(dir, "worker-111.json"), contaminated);

  const [read] = readWorkerSnapshots(dir, { now: fixedNow, kill: aliveKill() });
  assert.ok(read);
  assert.ok(!JSON.stringify(read).includes(SECRET), "secret never aggregated");
});

test("truncated JSON mid-write is never aggregated as valid", (t) => {
  const base = makeBase(t);
  const dir = path.join(base, "session");
  fs.mkdirSync(dir);
  const file = path.join(dir, "worker-777.json");
  fs.writeFileSync(
    file,
    '{"v":1,"pid":777,"workerId":"worker-777","startTime":1700000000000,' +
      '"updatedAt":1700000000000,"phase":"str',
  );

  assert.deepEqual(
    readWorkerSnapshots(dir, { now: fixedNow, kill: aliveKill() }),
    [],
  );
  assert.ok(fs.existsSync(file), "torn file is skipped, not deleted");
});

test("concurrent read during replace yields a complete old or new snapshot", (t) => {
  const base = makeBase(t);
  const dir = path.join(base, "session");
  fs.mkdirSync(dir);
  const pid = 2000;
  const make = (tps: number): WorkerSnapshot =>
    makeSnapshot({ pid, tps, updatedAt: NOW, phase: "streaming" });

  assert.strictEqual(writeSnapshotAtomic(dir, pid, make(1)), "ok");

  for (let i = 0; i < 25; i += 1) {
    const tps = i % 2 === 0 ? 99 : 1;
    writeSnapshotAtomic(dir, pid, make(tps));
    const [read] = readWorkerSnapshots(dir, {
      now: fixedNow,
      kill: aliveKill(),
    });
    assert.ok(read, "a complete snapshot is always observable");
    assert.ok(
      read.tps === 1 || read.tps === 99,
      "read sees a complete payload, never a torn mix",
    );
    assert.strictEqual(
      read.tps,
      tps,
      "the just-published payload is readable whole",
    );
  }
});

test("scavenger preserves every realistic foreign temp directory", (t) => {
  const base = makeBase(t);
  const DEAD_PID = 3002;

  const foreignNames = [
    "systemd-private-abc",
    "npm-cache-123",
    "chrome-session",
    ".config",
    "pi-tps-notes",
    "pi-tps-legacy",
  ];
  for (const name of foreignNames) {
    const dir = path.join(base, name);
    fs.mkdirSync(dir, { recursive: true });
    if (name === "pi-tps-legacy") {
      fs.writeFileSync(
        path.join(dir, OWNER_FILENAME),
        JSON.stringify({
          app: "other-tool",
          pid: DEAD_PID,
          created: NOW - SCAVENGE_AGE_MS * 2,
        }),
      );
    }
  }

  const removed = scavengeStaleDirectories(base, {
    now: fixedNow,
    kill: killMap({ [DEAD_PID]: false }),
  });
  assert.deepEqual(removed, [], "no foreign directory is touched");
  for (const name of foreignNames) {
    assert.ok(fs.existsSync(path.join(base, name)), `${name} preserved`);
  }
});
