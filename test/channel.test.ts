// IPC channel core tests: private session directory, owner marker, atomic
// write-replace, throttled publication, and worker unlink on shutdown.
//
// Node 24 executes this file directly via native type stripping. The channel
// module always writes inside its package-owned session directory and never
// shells out; these tests exercise real filesystem behavior against temp dirs
// under `os.tmpdir()`.

import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  OWNER_FILENAME,
  DIR_PREFIX,
  TERMINAL_RETRY_ATTEMPTS,
  TERMINAL_RETRY_DELAY_MS,
  createSessionDirectory,
  writeSnapshotAtomic,
  ThrottledPublisher,
} from "../src/channel.ts";
import { THROTTLE_MS } from "../src/types.ts";
import type { WorkerSnapshot, WorkerPhase } from "../src/types.ts";

function makeBase(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tps-channel-"));
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
    startTime: Date.now(),
    updatedAt: Date.now(),
    phase: "streaming",
    model: "claude-3-7-sonnet",
    tps: 42.5,
    messageTokens: 100,
    totalTokens: 1000,
    ...overrides,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("createSessionDirectory builds a private, unpredictable pi-tps-<pid>-<ts> directory with a valid owner marker", (t) => {
  const base = makeBase(t);
  const a = createSessionDirectory({ tmpDir: base });
  const b = createSessionDirectory({ tmpDir: base });

  assert.ok(a, "first session directory was created");
  assert.ok(b, "second session directory was created");
  assert.notEqual(a, b, "two sessions never share a directory");

  for (const dir of [a, b]) {
    assert.strictEqual(path.dirname(dir), base);
    const name = path.basename(dir);
    assert.ok(name.startsWith(DIR_PREFIX), `name starts with ${DIR_PREFIX}`);
    assert.ok(
      name.includes(String(process.pid)),
      "name encodes the owning pid",
    );

    if (process.platform !== "win32") {
      assert.strictEqual(
        fs.statSync(dir).mode & 0o777,
        0o700,
        "POSIX directory is 0700",
      );
    }

    const owner = JSON.parse(
      fs.readFileSync(path.join(dir, OWNER_FILENAME), "utf8"),
    );
    assert.strictEqual(owner.pid, process.pid);
    assert.strictEqual(owner.v, 1);
    assert.strictEqual(typeof owner.created, "number");
  }
});

test("Windows path skips POSIX permission modes and still writes the owner marker", (t) => {
  const base = makeBase(t);
  const originalMkdir = fs.mkdirSync.bind(fs);
  const seen: Array<{ mode?: number } | undefined> = [];
  t.mock.method(fs, "mkdirSync", (p: string, opts?: { mode?: number }) => {
    seen.push(opts);
    return opts === undefined ? originalMkdir(p) : originalMkdir(p, opts);
  });

  const winDir = createSessionDirectory({ tmpDir: base, platform: "win32" });
  const posixDir = createSessionDirectory({ tmpDir: base, platform: "linux" });

  assert.ok(winDir && posixDir);
  assert.ok(
    seen.some((o) => o === undefined || o.mode === undefined),
    "win32 mkdir applies no POSIX mode",
  );
  assert.ok(
    seen.some((o) => o && o.mode === 0o700),
    "posix mkdir applies 0700",
  );

  const owner = JSON.parse(
    fs.readFileSync(path.join(winDir, OWNER_FILENAME), "utf8"),
  );
  assert.strictEqual(owner.v, 1);
});

test("atomic write replaces the snapshot with 0o600 mode and leaves no residual tmp files", (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 4242;
  const finalPath = path.join(dir, `worker-${pid}.json`);

  assert.strictEqual(
    writeSnapshotAtomic(dir, pid, makeSnapshot({ tps: 1 })),
    "ok",
  );
  assert.strictEqual(
    writeSnapshotAtomic(dir, pid, makeSnapshot({ tps: 99 })),
    "ok",
  );

  const read = JSON.parse(fs.readFileSync(finalPath, "utf8"));
  assert.strictEqual(read.tps, 99, "replace leaves the complete new snapshot");

  if (process.platform !== "win32") {
    assert.strictEqual(
      fs.statSync(finalPath).mode & 0o777,
      0o600,
      "POSIX snapshot is 0600",
    );
  }

  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")),
    [],
  );
  assert.deepEqual(
    fs.readdirSync(base),
    [path.basename(dir)],
    "nothing outside the session directory",
  );
});

test("20 streaming updates within 50 ms produce exactly one immediate and one trailing write", (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 1234;
  const originalRename = fs.renameSync.bind(fs);
  let renames = 0;
  t.mock.method(fs, "renameSync", (src: string, dst: string) => {
    renames += 1;
    return originalRename(src, dst);
  });

  const publisher = new ThrottledPublisher(dir, pid);
  for (let i = 0; i < 20; i += 1) {
    publisher.publish(makeSnapshot({ pid, tps: i }));
  }

  assert.strictEqual(renames, 1, "only the first update writes immediately");
  publisher.flush();
  assert.strictEqual(
    renames,
    2,
    "one trailing write carries the latest snapshot",
  );

  const final = JSON.parse(
    fs.readFileSync(path.join(dir, `worker-${pid}.json`), "utf8"),
  );
  assert.strictEqual(
    final.tps,
    19,
    "trailing write coalesces to the most recent snapshot",
  );
});

test("ThrottledPublisher writes no more than once per window during streaming", (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 5678;
  const originalRename = fs.renameSync.bind(fs);
  let renames = 0;
  t.mock.method(fs, "renameSync", (src: string, dst: string) => {
    renames += 1;
    return originalRename(src, dst);
  });

  const publisher = new ThrottledPublisher(dir, pid);
  publisher.publish(makeSnapshot({ pid, tps: 1 }));
  publisher.publish(makeSnapshot({ pid, tps: 2 }));
  publisher.publish(makeSnapshot({ pid, tps: 3 }));

  assert.strictEqual(
    renames,
    1,
    "writes within the throttle window are coalesced",
  );
});

test("significant transitions flush immediately and reset the throttle window", (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 9999;
  const originalRename = fs.renameSync.bind(fs);
  let renames = 0;
  t.mock.method(fs, "renameSync", (src: string, dst: string) => {
    renames += 1;
    return originalRename(src, dst);
  });

  const publisher = new ThrottledPublisher(dir, pid);

  publisher.publish(makeSnapshot({ pid, phase: "streaming" }));
  assert.strictEqual(renames, 1, "initial streaming update writes immediately");

  publisher.publish(makeSnapshot({ pid, phase: "tool", activeTool: "bash" }), {
    significant: true,
  });
  assert.strictEqual(renames, 2, "tool start bypasses the throttle window");

  publisher.publish(
    makeSnapshot({ pid, phase: "tool", activeTool: "bash", tps: 7 }),
  );
  assert.strictEqual(
    renames,
    2,
    "post-flush update is throttled under the reset window",
  );

  publisher.flush();
  assert.strictEqual(
    renames,
    3,
    "trailing write lands for the throttled update",
  );
});

test("shutdown is destructive and synchronous, cancelling pending trailing writes", async (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 1111;
  const finalPath = path.join(dir, `worker-${pid}.json`);
  const originalRename = fs.renameSync.bind(fs);
  let renames = 0;
  t.mock.method(fs, "renameSync", (src: string, dst: string) => {
    renames += 1;
    return originalRename(src, dst);
  });

  const publisher = new ThrottledPublisher(dir, pid);
  publisher.publish(makeSnapshot({ pid }));
  publisher.publish(makeSnapshot({ pid, tps: 2 })); // pending trailing write
  assert.strictEqual(renames, 1);

  publisher.shutdown();
  const renamesAfterShutdown = renames;

  await delay(THROTTLE_MS + 50);
  assert.strictEqual(
    renames,
    renamesAfterShutdown,
    "no trailing write fires after shutdown",
  );
  assert.strictEqual(
    fs.existsSync(finalPath),
    false,
    "snapshot is unlinked on shutdown",
  );
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")),
    [],
  );
});

test("finalizeTerminal writes the terminal snapshot and stops publication", async (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 4444;
  const finalPath = path.join(dir, `worker-${pid}.json`);

  const publisher = new ThrottledPublisher(dir, pid);
  // Queue a throttled trailing write; finalization must cancel it.
  publisher.publish(makeSnapshot({ pid, tps: 5 }));
  publisher.publish(makeSnapshot({ pid, tps: 6 }));

  const ok: unknown = publisher.finalizeTerminal(
    makeSnapshot({ pid, phase: "complete", completedAt: Date.now(), tps: 0 }),
  );

  assert.strictEqual(
    typeof ok,
    "boolean",
    "finalizeTerminal returns synchronously, not a promise",
  );
  assert.strictEqual(ok, true, "finalization reports success");
  const parsed = JSON.parse(fs.readFileSync(finalPath, "utf8"));
  assert.strictEqual(parsed.phase, "complete");
  assert.strictEqual(parsed.tps, 0);
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")),
    [],
    "no residual temp file",
  );

  // Publication is closed: no later publish or finalize can rewrite the row.
  const before = fs.readFileSync(finalPath, "utf8");
  publisher.publish(makeSnapshot({ pid, tps: 999 }));
  await delay(THROTTLE_MS + 50);
  assert.strictEqual(
    fs.readFileSync(finalPath, "utf8"),
    before,
    "closed publisher cannot rewrite the terminal snapshot",
  );
  assert.strictEqual(
    publisher.finalizeTerminal(makeSnapshot({ pid, tps: 1000 })),
    false,
    "a second finalization is a no-op",
  );
});

test("finalizeTerminal is synchronous: the terminal row exists when the call returns", (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 4445;
  const finalPath = path.join(dir, `worker-${pid}.json`);

  const publisher = new ThrottledPublisher(dir, pid);
  // Queue a throttled trailing write; finalization cancels it.
  publisher.publish(makeSnapshot({ pid, tps: 5 }));

  // Deliberately no `await`: a process exit right after `agent_end` must find a
  // persisted terminal row, never a pending promise or timer.
  const result: unknown = publisher.finalizeTerminal(
    makeSnapshot({ pid, phase: "complete", completedAt: Date.now(), tps: 0 }),
  );

  assert.strictEqual(
    typeof result,
    "boolean",
    "finalizeTerminal returns a boolean, not a promise",
  );
  assert.strictEqual(result, true, "finalization reports success");
  assert.ok(
    fs.existsSync(finalPath),
    "terminal snapshot is on disk before the call returns",
  );
  assert.strictEqual(
    JSON.parse(fs.readFileSync(finalPath, "utf8")).phase,
    "complete",
  );
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")),
    [],
    "no residual temp file",
  );
});

test("finalizeTerminal retries a Windows EBUSY rename synchronously and lands the snapshot", (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 7777;
  const finalPath = path.join(dir, `worker-${pid}.json`);
  const originalRename = fs.renameSync.bind(fs);
  let calls = 0;
  t.mock.method(fs, "renameSync", (src: string, dst: string) => {
    calls += 1;
    if (calls === 1) {
      const err = new Error("EBUSY: resource busy or locked");
      (err as NodeJS.ErrnoException).code = "EBUSY";
      throw err;
    }
    return originalRename(src, dst);
  });

  // The synchronous wait is injected so the test observes retry pacing without
  // sleeping and pins the no-op/spy seam production relies on.
  const waits: number[] = [];
  const publisher = new ThrottledPublisher(dir, pid, {
    platform: "win32",
    wait: (ms) => waits.push(ms),
  });
  const ok: unknown = publisher.finalizeTerminal(
    makeSnapshot({ pid, phase: "complete", completedAt: Date.now(), tps: 0 }),
  );

  assert.strictEqual(
    typeof ok,
    "boolean",
    "finalizeTerminal returns synchronously, not a promise",
  );
  assert.strictEqual(ok, true, "the bounded retry lands the terminal snapshot");
  assert.ok(calls >= 2, "the busy rename was retried");
  assert.deepEqual(
    waits,
    [TERMINAL_RETRY_DELAY_MS],
    "one bounded synchronous wait precedes the retry",
  );
  assert.ok(
    fs.existsSync(finalPath),
    "terminal snapshot is on disk before the call returns",
  );
  const parsed = JSON.parse(fs.readFileSync(finalPath, "utf8"));
  assert.strictEqual(parsed.phase, "complete");
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")),
    [],
    "no residual temp file after the retry",
  );
});

test("default terminal retry uses a bounded synchronous wait, not a busy loop", (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 7002;
  const originalRename = fs.renameSync.bind(fs);
  let calls = 0;
  t.mock.method(fs, "renameSync", (src: string, dst: string) => {
    calls += 1;
    if (calls === 1) {
      const err = new Error("EBUSY: resource busy or locked");
      (err as NodeJS.ErrnoException).code = "EBUSY";
      throw err;
    }
    return originalRename(src, dst);
  });

  // No injected wait: the production default must itself block for the bounded
  // delay and land the retry, proving the seam default is exercised.
  const publisher = new ThrottledPublisher(dir, pid, { platform: "win32" });
  const started = Date.now();
  const ok: unknown = publisher.finalizeTerminal(
    makeSnapshot({ pid, phase: "complete", completedAt: Date.now(), tps: 0 }),
  );
  const elapsed = Date.now() - started;

  assert.strictEqual(typeof ok, "boolean", "synchronous boolean result");
  assert.strictEqual(ok, true, "the default wait lands the retry");
  assert.ok(
    elapsed >= TERMINAL_RETRY_DELAY_MS - 5,
    `default wait blocked for the retry delay (observed ${elapsed}ms)`,
  );
});

test("finalizeTerminal unlinks a stale live snapshot after repeated write failures", async (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 7001;
  const finalPath = path.join(dir, `worker-${pid}.json`);

  const waits: number[] = [];
  const publisher = new ThrottledPublisher(dir, pid, {
    platform: "win32",
    wait: (ms) => waits.push(ms),
  });
  // A live "tool" row is already on disk before finalization begins.
  publisher.publish(
    makeSnapshot({ pid, phase: "tool", activeTool: "bash", tps: 10 }),
    { significant: true },
  );
  assert.ok(
    fs.existsSync(finalPath),
    "live snapshot is on disk before finalization",
  );

  let calls = 0;
  t.mock.method(fs, "renameSync", () => {
    calls += 1;
    const err = new Error("EBUSY: resource busy or locked");
    (err as NodeJS.ErrnoException).code = "EBUSY";
    throw err;
  });

  const ok: unknown = publisher.finalizeTerminal(
    makeSnapshot({ pid, phase: "complete", completedAt: Date.now(), tps: 0 }),
  );

  assert.strictEqual(
    typeof ok,
    "boolean",
    "finalizeTerminal returns synchronously, not a promise",
  );
  assert.strictEqual(ok, false, "finalization reports failure");
  assert.ok(
    calls >= 1 + TERMINAL_RETRY_ATTEMPTS,
    "the bounded retry budget was exhausted",
  );
  assert.deepEqual(
    waits,
    [
      TERMINAL_RETRY_DELAY_MS,
      TERMINAL_RETRY_DELAY_MS,
      TERMINAL_RETRY_DELAY_MS,
    ],
    "exactly TERMINAL_RETRY_ATTEMPTS bounded waits precede the retries",
  );
  assert.strictEqual(
    fs.existsSync(finalPath),
    false,
    "stale live snapshot is unlinked, never shown as completed",
  );
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")),
    [],
    "no residual temp file after the failures",
  );

  // The call was synchronous, so nothing remains to fire later: no pending
  // timer or pending snapshot may resurrect the stale row.
  await delay(TERMINAL_RETRY_DELAY_MS * (TERMINAL_RETRY_ATTEMPTS + 2));
  assert.strictEqual(
    fs.existsSync(finalPath),
    false,
    "no late write resurrects a stale snapshot",
  );
});

test("finalizeTerminal never throws when the injected wait hook throws and still cleans stale snapshots", (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 7003;
  const finalPath = path.join(dir, `worker-${pid}.json`);

  // A live "tool" row plus a residual temp file are already on disk before a
  // faulting wait hook interrupts the bounded retry.
  const publisher = new ThrottledPublisher(dir, pid, {
    platform: "win32",
    wait: () => {
      throw new Error("injected wait hook fault");
    },
  });
  publisher.publish(
    makeSnapshot({ pid, phase: "tool", activeTool: "bash", tps: 10 }),
    { significant: true },
  );
  const staleTmp = path.join(dir, `.worker-${pid}.stale.tmp`);
  fs.writeFileSync(staleTmp, "stale");
  assert.ok(
    fs.existsSync(finalPath),
    "live snapshot is on disk before finalization",
  );

  t.mock.method(fs, "renameSync", () => {
    const err = new Error("EBUSY: resource busy or locked");
    (err as NodeJS.ErrnoException).code = "EBUSY";
    throw err;
  });

  let ok: unknown = "unset";
  assert.doesNotThrow(() => {
    ok = publisher.finalizeTerminal(
      makeSnapshot({ pid, phase: "complete", completedAt: Date.now(), tps: 0 }),
    );
  }, "a throwing wait hook must not breach the module no-throw contract");

  assert.strictEqual(
    typeof ok,
    "boolean",
    "finalizeTerminal returns synchronously, not a promise",
  );
  assert.strictEqual(ok, false, "finalization reports failure");
  assert.strictEqual(
    fs.existsSync(finalPath),
    false,
    "stale live snapshot is unlinked even when the wait hook throws",
  );
  assert.strictEqual(
    fs.existsSync(staleTmp),
    false,
    "residual temp snapshot is swept even when the wait hook throws",
  );
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")),
    [],
    "no residual temp file remains",
  );
});

test("finalizeTerminal still lands the terminal snapshot when the wait hook throws but the retry succeeds", (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 7004;
  const finalPath = path.join(dir, `worker-${pid}.json`);
  const originalRename = fs.renameSync.bind(fs);
  let calls = 0;
  t.mock.method(fs, "renameSync", (src: string, dst: string) => {
    calls += 1;
    if (calls === 1) {
      const err = new Error("EBUSY: resource busy or locked");
      (err as NodeJS.ErrnoException).code = "EBUSY";
      throw err;
    }
    return originalRename(src, dst);
  });

  const publisher = new ThrottledPublisher(dir, pid, {
    platform: "win32",
    wait: () => {
      throw new Error("injected wait hook fault");
    },
  });

  let ok: unknown = "unset";
  assert.doesNotThrow(() => {
    ok = publisher.finalizeTerminal(
      makeSnapshot({ pid, phase: "complete", completedAt: Date.now(), tps: 0 }),
    );
  }, "a throwing wait hook must not breach the module no-throw contract");

  assert.strictEqual(
    ok,
    true,
    "a faulting wait hook must not block a retry that would succeed",
  );
  assert.ok(calls >= 2, "the busy rename was retried despite the wait fault");
  const parsed = JSON.parse(fs.readFileSync(finalPath, "utf8"));
  assert.strictEqual(parsed.phase, "complete");
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")),
    [],
    "no residual temp file after the successful retry",
  );
});

test("Windows EBUSY/EPERM rename is caught, tmp unlinked, and retried on the next tick", async (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 8888;
  const finalPath = path.join(dir, `worker-${pid}.json`);
  const originalRename = fs.renameSync.bind(fs);
  let calls = 0;
  t.mock.method(fs, "renameSync", (src: string, dst: string) => {
    calls += 1;
    if (calls === 1) {
      const err = new Error("EBUSY: resource busy or locked");
      (err as NodeJS.ErrnoException).code = "EBUSY";
      throw err;
    }
    return originalRename(src, dst);
  });

  const publisher = new ThrottledPublisher(dir, pid, { platform: "win32" });
  publisher.publish(makeSnapshot({ pid }));

  assert.strictEqual(
    fs.existsSync(finalPath),
    false,
    "busy rename has not landed a snapshot yet",
  );
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")),
    [],
    "tmp is unlinked after EBUSY",
  );

  await delay(THROTTLE_MS + 50);
  assert.strictEqual(
    fs.existsSync(finalPath),
    true,
    "retry on the next throttle tick succeeds",
  );
  assert.ok(calls >= 2, "a second rename attempt was made");
});

test("unwritable temp root degrades to null without throwing", (t) => {
  const base = makeBase(t);
  const missingParent = path.join(base, "not-a-directory");
  const result = createSessionDirectory({ tmpDir: missingParent });
  assert.strictEqual(result, null);
});

test("ENOSPC during publication is caught and reported as failed without throwing", (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 2222;
  t.mock.method(fs, "writeFileSync", () => {
    const err = new Error("ENOSPC: no space left on device");
    (err as NodeJS.ErrnoException).code = "ENOSPC";
    throw err;
  });
  const result = writeSnapshotAtomic(dir, pid, makeSnapshot({ pid }));
  assert.strictEqual(result, "failed");
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")),
    [],
  );
});

test("every filesystem write is confined to the session directory", (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 5555;
  const originalWrite = fs.writeFileSync.bind(fs);
  const originalRename = fs.renameSync.bind(fs);
  const targets: string[] = [];
  t.mock.method(fs, "writeFileSync", (p: string, d: string, o?: object) => {
    targets.push(String(p));
    if (o === undefined) return originalWrite(p, d);
    return originalWrite(p, d, o);
  });
  t.mock.method(fs, "renameSync", (s: string, d: string) => {
    targets.push(String(s));
    targets.push(String(d));
    return originalRename(s, d);
  });

  writeSnapshotAtomic(dir, pid, makeSnapshot({ pid }));
  assert.ok(
    targets.length > 0,
    "at least one publication attempt was observed",
  );
  for (const target of targets) {
    assert.ok(
      target.startsWith(dir + path.sep),
      `write escaped the session directory: ${target}`,
    );
  }
});

test("channel.ts performs no shell commands", () => {
  const source = fs.readFileSync(
    new URL("../src/channel.ts", import.meta.url),
    "utf8",
  );
  assert.ok(!source.includes("child_process"), "no child_process import");
  assert.ok(!source.includes("execSync"), "no execSync");
  assert.ok(!source.includes("spawn"), "no spawn");
  assert.ok(!source.includes("exec("), "no exec(");
});

test("rapid transition sequences never exceed the throttle ceiling", (t) => {
  const base = makeBase(t);
  const dir = createSessionDirectory({ tmpDir: base });
  assert.ok(dir);
  const pid = 3333;
  const originalRename = fs.renameSync.bind(fs);
  let renames = 0;
  t.mock.method(fs, "renameSync", (s: string, d: string) => {
    renames += 1;
    return originalRename(s, d);
  });

  const publisher = new ThrottledPublisher(dir, pid);
  const sequence: Array<{ snapshot: WorkerSnapshot; significant: boolean }> = [
    { snapshot: makeSnapshot({ pid, phase: "streaming" }), significant: false },
    { snapshot: makeSnapshot({ pid, phase: "streaming" }), significant: false },
    {
      snapshot: makeSnapshot({ pid, phase: "tool", activeTool: "bash" }),
      significant: true,
    },
    { snapshot: makeSnapshot({ pid, phase: "streaming" }), significant: false },
    {
      snapshot: makeSnapshot({ pid, phase: "tool", activeTool: "read" }),
      significant: true,
    },
    { snapshot: makeSnapshot({ pid, phase: "streaming" }), significant: false },
    {
      snapshot: makeSnapshot({
        pid,
        phase: "complete",
        completedAt: Date.now(),
      }),
      significant: true,
    },
  ];
  for (const item of sequence) {
    publisher.publish(item.snapshot, { significant: item.significant });
  }
  publisher.flush();

  // One initial streaming write plus three significant flushes equals four
  // writes; the intermediate streaming deltas are coalesced, never exceeding
  // the throttle ceiling.
  assert.strictEqual(renames, 4);
});

test("sample snapshots are valid WorkerSnapshot-shaped packets", () => {
  const s = makeSnapshot();
  assert.strictEqual(s.v, 1);
  assert.strictEqual(s.workerId, "worker-4242");
  assert.ok(Number.isFinite(s.tps));
  assert.ok(Number.isFinite(s.totalTokens));
  const phases: WorkerPhase[] = ["waiting", "streaming", "tool", "complete"];
  assert.ok(phases.includes(s.phase));
});
