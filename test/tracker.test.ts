// Event tracker tests: streaming TPS estimation, character-based fallback,
// authoritative turn finalization, tool/model/thinking transitions, and later
// lifecycle adversarial cases. Events are plain objects driven through the
// tracker's `handle()` method with an injected clock — no Pi runtime is required.
//
// Node 24 executes this file directly via native type stripping.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CHAR_ESTIMATE_DIVISOR, EventTracker } from "../src/tracker.ts";
import { SNAPSHOT_VERSION } from "../src/types.ts";

/** A tracker with a controllable wall clock (advances only when told to). */
function makeTracker(pid = 1) {
  let clock = 0;
  const now = (): number => clock;
  const tracker = new EventTracker({
    pid,
    workerId: `worker-${pid}`,
    startTime: 0,
    now,
  });
  return {
    tracker,
    now,
    advance(ms: number): void {
      clock += ms;
    },
    setClock(ms: number): void {
      clock = ms;
    },
  };
}

/** message_start for the assistant role (the only role the meter tracks). */
function msgStart() {
  return { type: "message_start", message: { role: "assistant" } };
}

/** message_update carrying a text delta and no provider usage. */
function textDelta(chars: string) {
  return {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: chars },
  };
}

/** message_end whose authoritative usage is the given output token count. */
function msgEnd(output?: number) {
  return output === undefined
    ? { type: "message_end", message: { role: "assistant" } }
    : {
        type: "message_end",
        message: { role: "assistant", usage: { output } },
      };
}

// ---------------------------------------------------------------------------
// RED (task 6.1): streaming counters, timing base, fallback, finalization,
// tool phase, and model/thinking label refresh.
// ---------------------------------------------------------------------------

test("message_start resets per-message counters before a new turn", () => {
  const t = makeTracker();

  // Establish non-zero per-message counters with a completed turn.
  t.tracker.handle(msgStart());
  t.advance(1000);
  t.tracker.handle(textDelta("abcd")); // 4 chars -> estimate 1 token
  t.advance(1000);
  t.tracker.handle(msgEnd(8)); // authoritative 8 tokens replaces the estimate
  assert.equal(t.tracker.snapshot().messageTokens, 8);

  // A new assistant message resets them to zero.
  t.tracker.handle(msgStart());
  const s = t.tracker.snapshot();
  assert.equal(s.messageTokens, 0);
  assert.equal(s.tps, 0);
  assert.equal(s.phase, "streaming");
});

test("elapsed time bases at the first observed output delta, not message start", () => {
  const t = makeTracker();

  t.tracker.handle(msgStart()); // clock = 0 (message start)
  t.advance(1000);
  t.tracker.handle(textDelta("the")); // 3 chars -> estimate 1; first delta here
  t.advance(3000); // clock = 4000; 3000 ms since the first delta
  t.tracker.handle(textDelta("quick")); // 8 chars total -> estimate 2

  const s = t.tracker.snapshot();
  assert.equal(s.messageTokens, 2);
  // 2 tokens over 3000 ms = 2/3 tok/s. A message-start base would yield 0.5.
  assert.ok(Math.abs(s.tps - 2 / 3) < 1e-9, `tps=${s.tps}`);
});

test("message_update computes live TPS preferring reported output usage", () => {
  const t = makeTracker();

  t.tracker.handle(msgStart());
  t.advance(1000);
  t.tracker.handle({
    type: "message_update",
    usage: { output: 50 },
    assistantMessageEvent: { type: "text_delta", delta: "hello" }, // 5 chars -> estimate 2
  });

  // The first delta establishes the elapsed base, so it cannot carry a rate yet.
  const first = t.tracker.snapshot();
  assert.equal(first.messageTokens, 50); // reported usage wins over the estimate
  assert.equal(first.tps, 0);

  t.advance(1000); // 1000 ms elapsed since the first delta
  t.tracker.handle({
    type: "message_update",
    usage: { output: 50 },
    assistantMessageEvent: { type: "text_delta", delta: " world" },
  });

  const s = t.tracker.snapshot();
  assert.equal(s.messageTokens, 50); // still reported, never regressed by the estimate
  assert.equal(s.tps, 50); // 50 tokens over 1000 ms
});

test("character-based estimate keeps the meter moving when usage is absent", () => {
  const t = makeTracker();

  t.tracker.handle(msgStart());
  t.advance(1000);
  t.tracker.handle(textDelta("Hello, world!")); // 13 chars -> ceil(13/4) = 4

  const first = t.tracker.snapshot();
  assert.equal(first.messageTokens, Math.ceil(13 / CHAR_ESTIMATE_DIVISOR));
  assert.equal(first.messageTokens, 4);
  assert.equal(first.tps, 0); // first delta: elapsed base only

  t.advance(1000);
  t.tracker.handle(textDelta("again")); // 18 chars total -> ceil(18/4) = 5

  const s = t.tracker.snapshot();
  assert.equal(s.messageTokens, 5);
  assert.equal(s.tps, 5); // 5 tokens over 1000 ms
});

test("message_end finalizes authoritative usage and replaces the streaming estimate", () => {
  const t = makeTracker();

  t.tracker.handle(msgStart());
  t.advance(1000);
  t.tracker.handle(textDelta("abcdefghijkl")); // 12 chars -> estimate 3
  t.advance(2000); // 2000 ms since the first delta
  t.tracker.handle(msgEnd(30)); // authoritative 30 tokens -> 30/2 = 15 tok/s

  const s = t.tracker.snapshot();
  assert.equal(s.messageTokens, 30); // estimate (3) discarded
  assert.equal(s.phase, "waiting");

  const stats = t.tracker.sessionStats();
  assert.deepEqual(stats.sparkline, [15]);
  assert.equal(stats.mean, 15);
});

test("message_end pushes finalized per-turn TPS into sparkline, mean and p95", () => {
  const t = makeTracker();

  // Three turns with known finalized rates of 10, 20, and 30 tok/s.
  for (const usage of [10, 20, 30]) {
    t.tracker.handle(msgStart());
    t.advance(1000);
    t.tracker.handle(textDelta("x")); // mark the first output delta
    t.advance(1000);
    t.tracker.handle(msgEnd(usage)); // usage / 1 s
  }

  const stats = t.tracker.sessionStats();
  assert.deepEqual(stats.sparkline, [10, 20, 30]);
  assert.equal(stats.mean, 20);
  assert.equal(stats.p95SampleCount, 3);
});

test("tool_execution_start/end toggle phase and clear the active tool", () => {
  const t = makeTracker();

  t.tracker.handle({ type: "tool_execution_start", toolName: "bash" });
  let s = t.tracker.snapshot();
  assert.equal(s.phase, "tool");
  assert.equal(s.activeTool, "bash");
  assert.equal(s.tps, 0); // not streaming while a tool runs

  t.tracker.handle({ type: "tool_execution_end" });
  s = t.tracker.snapshot();
  assert.equal(s.activeTool, undefined);
  assert.equal(s.phase, "waiting");
});

test("model_select stores the qualified provider/id label", () => {
  const t = makeTracker();

  t.tracker.handle({
    type: "model_select",
    model: { provider: "anthropic", id: "claude-3-7-sonnet" },
  });

  assert.equal(t.tracker.snapshot().model, "anthropic/claude-3-7-sonnet");
});

test("model_select falls back to id-only/string/name labels and sanitizes hostile ids", () => {
  const t = makeTracker();

  // Missing provider: the compact id is kept as-is.
  t.tracker.handle({ type: "model_select", model: { id: "claude-3-5-haiku" } });
  assert.equal(t.tracker.snapshot().model, "claude-3-5-haiku");

  // An empty provider is not a provider: still id-only.
  t.tracker.handle({
    type: "model_select",
    model: { provider: "", id: "gpt-5" },
  });
  assert.equal(t.tracker.snapshot().model, "gpt-5");

  // Plain string model and the modelName/modelId fallbacks are unchanged.
  t.tracker.handle({ type: "model_select", model: "plain-model" });
  assert.equal(t.tracker.snapshot().model, "plain-model");

  t.tracker.handle({ type: "model_select", modelName: "named-model" });
  assert.equal(t.tracker.snapshot().model, "named-model");

  // Hostile provider/id text is sanitized before it reaches the snapshot.
  t.tracker.handle({
    type: "model_select",
    model: { provider: "ac\u001b[31mme", id: "claude\n-3" },
  });
  assert.equal(t.tracker.snapshot().model, "acme/claude-3");
});

test("thinking_level_select refreshes the thinking level label", () => {
  const t = makeTracker();

  t.tracker.handle({ type: "thinking_level_select", level: "high" });

  assert.equal(t.tracker.snapshot().thinkingLevel, "high");
});

test("snapshot returns a WorkerSnapshot-shaped state", () => {
  const t = makeTracker(4242);

  const s = t.tracker.snapshot();
  assert.equal(s.v, SNAPSHOT_VERSION);
  assert.equal(s.pid, 4242);
  assert.equal(s.workerId, "worker-4242");
  assert.equal(s.phase, "waiting");
  assert.equal(s.tps, 0);
  assert.equal(s.messageTokens, 0);
  assert.equal(s.totalTokens, 0);
});

// ---------------------------------------------------------------------------
// TRIANGULATE (task 6.3): lifecycle adversarial cases.
// ---------------------------------------------------------------------------

test("reading snapshot/sessionStats never mutates statistics or counters", () => {
  const t = makeTracker();

  // One completed turn establishes non-zero state.
  t.tracker.handle(msgStart());
  t.advance(1000);
  t.tracker.handle(textDelta("abcd"));
  t.advance(1000);
  t.tracker.handle(msgEnd(8)); // 8 tok/s

  const before = t.tracker.snapshot();
  const statsBefore = t.tracker.sessionStats();

  // Many idle render ticks (read-only) with time passing.
  for (let i = 0; i < 20; i++) {
    t.advance(500);
    void t.tracker.snapshot();
    void t.tracker.sessionStats();
  }

  const after = t.tracker.snapshot();
  const statsAfter = t.tracker.sessionStats();
  assert.deepEqual(statsAfter.sparkline, statsBefore.sparkline);
  assert.equal(statsAfter.mean, statsBefore.mean);
  assert.equal(statsAfter.p95SampleCount, statsBefore.p95SampleCount);
  assert.equal(after.messageTokens, before.messageTokens);
  assert.equal(after.totalTokens, before.totalTokens);
  assert.equal(after.tps, before.tps);
});

test("counters reset on new message while session statistics retain prior turns", () => {
  const t = makeTracker();

  for (const usage of [10, 20]) {
    t.tracker.handle(msgStart());
    t.advance(1000);
    t.tracker.handle(textDelta("x"));
    t.advance(1000);
    t.tracker.handle(msgEnd(usage));
  }
  const statsBefore = t.tracker.sessionStats();
  assert.deepEqual(statsBefore.sparkline, [10, 20]);
  assert.equal(statsBefore.mean, 15);

  t.tracker.handle(msgStart());
  const s = t.tracker.snapshot();
  assert.equal(s.messageTokens, 0);
  assert.equal(s.tps, 0);

  const statsAfter = t.tracker.sessionStats();
  assert.deepEqual(statsAfter.sparkline, [10, 20]); // retained
  assert.equal(statsAfter.mean, 15); // retained
});

test("a provider that never reports usage falls back cleanly then finalizes the estimate", () => {
  const t = makeTracker();

  t.tracker.handle(msgStart()); // clock 0
  t.advance(1000);
  t.tracker.handle(textDelta("abcdefgh")); // 8 chars -> 2; first delta at 1000 ms
  t.advance(1000);
  t.tracker.handle(textDelta("ijkl")); // 12 chars -> 3
  t.advance(1000);
  t.tracker.handle(msgEnd()); // no usage -> finalize estimate

  const s = t.tracker.snapshot();
  assert.equal(s.messageTokens, 3);
  assert.equal(s.phase, "waiting");

  // 3 estimated tokens over 2000 ms (first delta -> message end).
  const stats = t.tracker.sessionStats();
  assert.deepEqual(stats.sparkline, [1.5]);
});

test("absent optional event fields never throw and leave a sane state", () => {
  const t = makeTracker();

  assert.doesNotThrow(() => {
    t.tracker.handle(null);
    t.tracker.handle(undefined);
    t.tracker.handle({});
    t.tracker.handle({ type: "message_start" });
    t.tracker.handle({ type: "message_update" });
    t.tracker.handle({ type: "message_update", message: { usage: {} } });
    t.tracker.handle({ type: "message_end" });
    t.tracker.handle({ type: "tool_execution_start" });
    t.tracker.handle({ type: "tool_execution_end" });
    t.tracker.handle({ type: "model_select" });
    t.tracker.handle({ type: "thinking_level_select" });
    t.tracker.handle({ type: "unknown_event" });
    t.tracker.handle(42);
  });

  const s = t.tracker.snapshot();
  assert.equal(s.phase, "waiting");
  assert.equal(s.tps, 0);
});

test("complete() finalizes an open message and marks the worker complete", () => {
  const t = makeTracker();

  t.tracker.handle(msgStart());
  t.advance(1000);
  t.tracker.handle(textDelta("abcdefgh")); // 8 chars -> 2
  t.advance(1000);
  t.tracker.complete(); // no message_end observed

  const s = t.tracker.snapshot();
  assert.equal(s.phase, "complete");
  assert.ok(s.completedAt !== undefined);
  assert.equal(s.tps, 0);

  // The open turn was finalized from the estimate: 2 tokens over 1000 ms.
  assert.deepEqual(t.tracker.sessionStats().sparkline, [2]);

  // Completing again is idempotent for session statistics.
  const before = t.tracker.sessionStats().sparkline;
  t.tracker.complete();
  assert.deepEqual(t.tracker.sessionStats().sparkline, before);
});

test("totalTokens accumulates authoritative output and includes streaming tokens", () => {
  const t = makeTracker();

  // First turn: 10 authoritative tokens.
  t.tracker.handle(msgStart());
  t.advance(1000);
  t.tracker.handle(textDelta("x"));
  t.advance(1000);
  t.tracker.handle(msgEnd(10));
  assert.equal(t.tracker.snapshot().totalTokens, 10);

  // Second turn streaming: 16 chars -> estimate 4.
  t.tracker.handle(msgStart());
  t.advance(1000);
  t.tracker.handle(textDelta("abcdefghijklmnop")); // 16 chars -> 4
  assert.equal(t.tracker.snapshot().totalTokens, 14); // 10 finalized + 4 live

  t.advance(1000);
  t.tracker.handle(msgEnd(20)); // authoritative 20 replaces the estimate
  assert.equal(t.tracker.snapshot().totalTokens, 30); // 10 + 20 authoritative
});

test("tool end returns to streaming while a message is still open", () => {
  const t = makeTracker();

  t.tracker.handle(msgStart()); // streaming, message open
  t.advance(1000);
  t.tracker.handle(textDelta("abcd"));

  t.tracker.handle({ type: "tool_execution_start", toolName: "read" });
  assert.equal(t.tracker.snapshot().phase, "tool");

  t.tracker.handle({ type: "tool_execution_end" });
  assert.equal(t.tracker.snapshot().phase, "streaming");
});

test("p95 bootstraps after 64 finalized turns", () => {
  const t = makeTracker();

  for (let i = 0; i < 64; i++) {
    t.tracker.handle(msgStart());
    t.advance(1000);
    t.tracker.handle(textDelta("x"));
    t.advance(1000);
    t.tracker.handle(msgEnd(50)); // 50 tok/s each
  }

  const stats = t.tracker.sessionStats();
  assert.equal(stats.p95SampleCount, 64);
  assert.ok(Math.abs(stats.p95 - 50) < 1e-6, `p95=${stats.p95}`);
});

test("thinking deltas count toward the character estimate", () => {
  const t = makeTracker();

  t.tracker.handle(msgStart());
  t.advance(1000);
  t.tracker.handle({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "reasoning" }, // 9 chars
  });
  t.advance(1000);
  t.tracker.handle({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "more" }, // 13 chars -> 4
  });

  assert.equal(
    t.tracker.snapshot().messageTokens,
    Math.ceil(13 / CHAR_ESTIMATE_DIVISOR),
  );
});
