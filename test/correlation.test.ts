// Task correlation engine tests: Gentle Agents tool lifecycle tracking, the
// deterministic 1:1 worker-task join (Regime A), and the honest never-guess
// fallback for concurrent, ambiguous, or unmatched worker sets (Regime B).
//
// Strict TDD: these tests are exercised through mocked Pi tool_call/tool_result
// events and in-memory worker snapshots. No live Pi, process, or filesystem
// interaction is involved.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CorrelationEngine,
  SUBAGENT_CANCEL,
  SUBAGENT_CONTINUE,
  SUBAGENT_RUN,
} from "../src/correlation.ts";

let workerCounter = 0;

/** Builds a validated worker snapshot with sensible defaults overridable per test. */
function snapshot(overrides = {}) {
  workerCounter += 1;
  const pid = 4000 + workerCounter;
  return {
    v: 1,
    pid,
    workerId: `worker-${pid}`,
    startTime: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    phase: "streaming",
    model: "claude-3-7-sonnet",
    tps: 42.5,
    messageTokens: 100,
    totalTokens: 1234,
    ...overrides,
  };
}

function runCall(callId, input = {}) {
  return {
    type: "tool_call",
    toolCallId: callId,
    toolName: SUBAGENT_RUN,
    input: {
      agent: "scout",
      task: "explore auth",
      label: "explore auth",
      mode: "task",
      ...input,
    },
  };
}

function runResult(callId, gentleAgents = {}) {
  return {
    type: "tool_result",
    toolCallId: callId,
    toolName: SUBAGENT_RUN,
    input: {},
    isError: false,
    content: [],
    details: {
      gentleAgents: {
        taskId: "t1",
        agent: "scout",
        status: "running",
        mode: "task",
        ...gentleAgents,
      },
    },
  };
}

function continueCall(callId, taskId = "t1") {
  return {
    type: "tool_call",
    toolCallId: callId,
    toolName: SUBAGENT_CONTINUE,
    input: { task_id: taskId, prompt: "keep going" },
  };
}

function continueResult(callId, gentleAgents = {}) {
  return {
    type: "tool_result",
    toolCallId: callId,
    toolName: SUBAGENT_CONTINUE,
    input: { task_id: "t1" },
    isError: false,
    content: [],
    details: {
      gentleAgents: {
        taskId: "t1",
        agent: "scout",
        status: "running",
        mode: "task",
        ...gentleAgents,
      },
    },
  };
}

function cancelCall(callId, taskId = "t1") {
  return {
    type: "tool_call",
    toolCallId: callId,
    toolName: SUBAGENT_CANCEL,
    input: { task_id: taskId },
  };
}

test("subagent_run tool_call registers a pending task, then result records taskId/metadata and runs", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(runCall("c1"));

  assert.equal(engine.activeTasks().length, 1);
  assert.equal(engine.activeTasks()[0].status, "pending");
  assert.equal(engine.activeTasks()[0].agent, "scout");

  engine.handleToolResult(
    runResult("c1", { taskId: "t-42", status: "running" }),
  );
  const tasks = engine.tasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].taskId, "t-42");
  assert.equal(tasks[0].agent, "scout");
  assert.equal(tasks[0].label, "explore auth");
  assert.equal(tasks[0].mode, "task");
  assert.equal(tasks[0].status, "running");
});

test("background queued result records background mode and pending status", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(runCall("c1", { mode: "background" }));
  engine.handleToolResult(
    runResult("c1", { taskId: "t-bg", status: "queued", mode: "background" }),
  );

  const [task] = engine.activeTasks();
  assert.equal(task.mode, "background");
  assert.equal(task.status, "pending");
});

test("subagent_continue re-activates a finished task to running", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(runCall("c1"));
  engine.handleToolResult(
    runResult("c1", { taskId: "t1", status: "completed" }),
  );
  assert.equal(engine.activeTasks().length, 0); // finished task leaves the active set

  engine.handleToolCall(continueCall("c2", "t1"));
  assert.equal(engine.activeTasks().length, 1);
  assert.equal(engine.activeTasks()[0].status, "running");
});

test("subagent_continue result also re-activates the task", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(runCall("c1"));
  engine.handleToolResult(
    runResult("c1", { taskId: "t1", status: "completed" }),
  );
  engine.handleToolResult(
    continueResult("c2", { taskId: "t1", status: "queued" }),
  );

  assert.equal(engine.activeTasks().length, 1);
  assert.equal(engine.activeTasks()[0].status, "running");
});

test("subagent_cancel tool_call evicts the tracked task", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(runCall("c1"));
  engine.handleToolResult(runResult("c1", { taskId: "t1", status: "running" }));
  assert.equal(engine.activeTasks().length, 1);

  engine.handleToolCall(cancelCall("c2", "t1"));
  assert.equal(engine.tasks().length, 0);
  assert.equal(engine.activeTasks().length, 0);
});

test("subagent_cancel tool_result (cancelled status) evicts the task", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(runCall("c1"));
  engine.handleToolResult(runResult("c1", { taskId: "t1", status: "running" }));

  engine.handleToolResult({
    type: "tool_result",
    toolCallId: "c2",
    toolName: SUBAGENT_CANCEL,
    input: { task_id: "t1" },
    isError: false,
    content: [],
    details: {
      gentleAgents: {
        taskId: "t1",
        agent: "scout",
        status: "cancelled",
        mode: "task",
      },
    },
  });
  assert.equal(engine.tasks().length, 0);
});

test("Regime A: the row carries the agent badge while the engine keeps the label", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(
    runCall("c1", { agent: "scout", label: "explore auth" }),
  );
  engine.handleToolResult(
    runResult("c1", { taskId: "t1", agent: "scout", status: "running" }),
  );

  const worker = snapshot();
  const rows = engine.correlate([worker]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].badge, "scout");
  assert.ok(!("label" in rows[0]), "the render row never carries task text");
  assert.equal(rows[0].taskId, "t1");
  assert.equal(engine.tasks()[0].label, "explore auth");
});

test("Regime A row carries the worker's verified runtime facts", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(runCall("c1"));
  engine.handleToolResult(runResult("c1", { status: "running" }));

  const worker = snapshot({
    phase: "tool",
    activeTool: "read",
    tps: 24.1,
    totalTokens: 1400,
    model: "claude-3-5-haiku",
  });
  const [row] = engine.correlate([worker]);
  assert.equal(row.pid, worker.pid);
  assert.equal(row.tps, 24.1);
  assert.equal(row.phase, "tool");
  assert.equal(row.activeTool, "read");
  assert.equal(row.tokens, 1400);
  assert.equal(row.model, "claude-3-5-haiku");
});

test("Regime A row carries the raw agent badge and thinking level, never the label", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(
    runCall("c1", { agent: "scout", label: "explore auth" }),
  );
  engine.handleToolResult(runResult("c1", { taskId: "t1", status: "running" }));

  const [row] = engine.correlate([snapshot({ thinkingLevel: "high" })]);
  assert.ok(!("label" in row), "no label in the render row");
  assert.equal(row.badge, "scout");
  assert.equal(row.thinkingLevel, "high");
});

test("Regime B keeps the thinking level but never invents a label or badge", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(runCall("c1", { agent: "scout" }));
  engine.handleToolResult(runResult("c1", { taskId: "t1", status: "running" }));
  engine.handleToolCall(runCall("c2", { agent: "architect" }));
  engine.handleToolResult(
    runResult("c2", { taskId: "t2", agent: "architect", status: "running" }),
  );

  const rows = engine.correlate([
    snapshot({ thinkingLevel: "low" }),
    snapshot({ thinkingLevel: "medium" }),
  ]);
  assert.equal(rows[0].thinkingLevel, "low");
  assert.equal(rows[1].thinkingLevel, "medium");
  for (const row of rows) {
    assert.ok(!("label" in row), "no label in the render row");
    assert.equal(row.badge, undefined);
  }
});

test("an absent or hostile thinking level never reaches the row", () => {
  const noLevel = new CorrelationEngine().correlate([snapshot()])[0];
  assert.equal(noLevel.thinkingLevel, undefined);

  const [hostile] = new CorrelationEngine().correlate([
    snapshot({ thinkingLevel: "hi\u001b[31mgh" }),
  ]);
  assert.equal(hostile.thinkingLevel, "high");
});

test("Regime B: two concurrent workers and tasks render metrics-only without guessed identity", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(runCall("c1", { agent: "scout" }));
  engine.handleToolResult(runResult("c1", { taskId: "t1", status: "running" }));
  engine.handleToolCall(runCall("c2", { agent: "architect" }));
  engine.handleToolResult(
    runResult("c2", { taskId: "t2", agent: "architect", status: "running" }),
  );

  const rows = engine.correlate([snapshot(), snapshot()]);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.badge, undefined);
    assert.ok(!("label" in row), "no label in the render row");
    assert.ok(Number.isInteger(row.pid) && row.pid > 0);
  }
});

test("Regime B: a worker with no registered task renders metrics-only", () => {
  const worker = snapshot({ tps: 58.0, totalTokens: 3200 });
  const [row] = new CorrelationEngine().correlate([worker]);
  assert.equal(row.badge, undefined);
  assert.equal(row.tps, 58.0);
  assert.equal(row.tokens, 3200);
});

test("Regime B: count mismatch (one worker, two active tasks) omits identity", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(runCall("c1"));
  engine.handleToolResult(runResult("c1", { taskId: "t1", status: "running" }));
  engine.handleToolCall(runCall("c2", { agent: "architect" }));
  engine.handleToolResult(
    runResult("c2", { taskId: "t2", agent: "architect", status: "running" }),
  );

  const [row] = engine.correlate([snapshot()]);
  assert.equal(row.badge, undefined);
  assert.ok(Number.isInteger(row.pid) && row.pid > 0);
});

test("tool_result gentleAgents metadata records a task without a prior run call", () => {
  const engine = new CorrelationEngine();
  engine.handleToolResult(
    runResult("c1", {
      taskId: "t9",
      agent: "reviewer",
      status: "running",
      mode: "background",
    }),
  );

  const [task] = engine.tasks();
  assert.equal(task.taskId, "t9");
  assert.equal(task.agent, "reviewer");
  assert.equal(task.mode, "background");
  assert.equal(task.status, "running");
});

// --- TRIANGULATE: adversarial correlation cases (7.3) ---

test("two concurrent launches never guess identity by launch order or timestamp", () => {
  const engine = new CorrelationEngine({ now: () => 1_700_000_000_000 });
  engine.handleToolCall(runCall("c1", { agent: "scout" }));
  engine.handleToolResult(runResult("c1", { taskId: "t1", status: "running" }));
  engine.handleToolCall(runCall("c2", { agent: "architect" }));
  engine.handleToolResult(
    runResult("c2", { taskId: "t2", agent: "architect", status: "running" }),
  );

  const workers = [snapshot(), snapshot()];
  // Order-independence: neither FIFO launch order nor timestamp is used to pair.
  for (const list of [workers, [...workers].reverse()]) {
    const rows = engine.correlate(list);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.badge, undefined);
      assert.ok(!("label" in row), "no label in the render row");
      assert.equal(row.taskId, undefined);
    }
  }
});

test("single scout 1:1 match is deterministic across repeated correlates", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(
    runCall("c1", { agent: "scout", label: "explore auth" }),
  );
  engine.handleToolResult(runResult("c1", { taskId: "t1", status: "running" }));

  const worker = snapshot();
  for (let i = 0; i < 3; i++) {
    const [row] = engine.correlate([worker]);
    assert.equal(row.badge, "scout");
    assert.ok(!("label" in row), "the render row never carries task text");
  }
});

test("cancel mid-run evicts the task and removes its row identity", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(runCall("c1", { agent: "scout" }));
  engine.handleToolResult(runResult("c1", { taskId: "t1", status: "running" }));
  assert.equal(engine.correlate([snapshot()])[0].badge, "scout");

  engine.handleToolCall(cancelCall("c2", "t1"));
  assert.equal(engine.correlate([]).length, 0); // no live worker, no row
  assert.equal(engine.tasks().length, 0); // task fully evicted

  // A still-publishing worker after cancel is metrics-only, never re-badged.
  const [fallback] = engine.correlate([snapshot()]);
  assert.equal(fallback.badge, undefined);
});

test("finished tasks cease to appear in the active set", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(runCall("c1"));
  engine.handleToolResult(
    runResult("c1", { taskId: "t1", status: "completed" }),
  );
  assert.equal(engine.activeTasks().length, 0);
  assert.equal(engine.correlate([]).length, 0);

  // A fresh unrelated worker is not mis-paired with the finished task.
  const [row] = engine.correlate([snapshot()]);
  assert.equal(row.badge, undefined);
});

test("hostile agent names are sanitized into the row and hostile labels stay engine-side", () => {
  const engine = new CorrelationEngine();
  engine.handleToolCall(
    runCall("c1", {
      agent: "sc\u001b[31mout",
      label: "explore\u0007auth\u0007x",
    }),
  );
  engine.handleToolResult(runResult("c1", { taskId: "t1", status: "running" }));

  const [row] = engine.correlate([snapshot()]);
  assert.equal(row.badge, "scout");
  assert.ok(!("label" in row), "hostile label never reaches the render row");
  assert.equal(engine.tasks()[0].label, "exploreauthx");
});

test("unmatched worker metrics-only fallback preserves phase/tool/model", () => {
  const worker = snapshot({
    phase: "tool",
    activeTool: "bash",
    tps: 8.5,
    totalTokens: 90,
    model: "claude-3-5-haiku",
  });
  const [row] = new CorrelationEngine().correlate([worker]);
  assert.equal(row.badge, undefined);
  assert.equal(row.phase, "tool");
  assert.equal(row.activeTool, "bash");
  assert.equal(row.tps, 8.5);
  assert.equal(row.tokens, 90);
  assert.equal(row.model, "claude-3-5-haiku");
});

// ---------------------------------------------------------------------------
// WU-5: anti-flicker stabilization and completed rows
// ---------------------------------------------------------------------------

/** Fixed epoch used as the mutable clock base for the stabilization window. */
const T0 = 1_700_000_000_000;

test("activeTool survives a 200 ms gap, holds at the boundary, then expires", () => {
  let now = T0;
  const engine = new CorrelationEngine({ now: () => now });
  const base = snapshot({ phase: "tool", activeTool: "read", tps: 0 });
  const noTool = () => [{ ...base, activeTool: undefined }];

  const live = engine.correlate([base]);
  assert.equal(live[0].activeTool, "read");
  assert.equal(live[0].avgTps, undefined, "a live row carries no average");

  now = T0 + 200;
  assert.equal(engine.correlate(noTool())[0].activeTool, "read");
  now = T0 + 400; // still inside the window, 200 ms after the last render tick
  assert.equal(
    engine.correlate(noTool())[0].activeTool,
    "read",
    "boundary holds",
  );
  now = T0 + 401;
  assert.equal(
    engine.correlate(noTool())[0].activeTool,
    undefined,
    "then expires",
  );
  now = T0 + 500;
  assert.equal(
    engine.correlate(noTool())[0].activeTool,
    undefined,
    "never resurrected",
  );
});

test("tps survives a brief transition out of a live phase and then settles to zero", () => {
  let now = T0;
  const engine = new CorrelationEngine({ now: () => now });
  const base = snapshot({
    phase: "streaming",
    tps: 42.5,
    activeTool: undefined,
  });
  const idle = () => [{ ...base, phase: "waiting", tps: 0 }];

  assert.equal(engine.correlate([base])[0].tps, 42.5);
  now = T0 + 200;
  assert.equal(
    engine.correlate(idle())[0].tps,
    42.5,
    "the gauge does not blink",
  );
  now = T0 + 400;
  assert.equal(engine.correlate(idle())[0].tps, 0, "no phantom rate when idle");
});

test("tokens never move backwards across ticks", () => {
  let now = T0;
  const engine = new CorrelationEngine({ now: () => now });
  const base = snapshot({ totalTokens: 1400 });
  assert.equal(engine.correlate([base])[0].tokens, 1400);

  now = T0 + 200;
  const lower = engine.correlate([{ ...base, totalTokens: 900 }]);
  assert.equal(lower[0].tokens, 1400, "a smaller reading is never displayed");
  now = T0 + 400;
  const grown = engine.correlate([{ ...base, totalTokens: 2100 }]);
  assert.equal(grown[0].tokens, 2100, "real growth still tracks the worker");
});

test("a completed snapshot carries completedAt and its lifetime average rate", () => {
  const base = snapshot({
    phase: "complete",
    startTime: T0,
    completedAt: T0 + 20_000,
    tps: 0,
    activeTool: undefined,
    totalTokens: 1000,
  });
  const [row] = new CorrelationEngine().correlate([base]);

  assert.equal(row.phase, "complete");
  assert.equal(row.completedAt, T0 + 20_000);
  assert.equal(row.avgTps, 50, "1000 tokens over 20 seconds");
  assert.equal(row.tokens, 1000);
});

test("a completed row carries no tool or live rate forward from its prior snapshots", () => {
  let now = T0;
  const engine = new CorrelationEngine({ now: () => now });
  const base = snapshot({
    phase: "tool",
    activeTool: "read",
    tps: 42.5,
    totalTokens: 400,
  });
  engine.correlate([base]);

  now = T0 + 200;
  const [row] = engine.correlate([
    {
      ...base,
      phase: "complete",
      startTime: now - 10_000,
      completedAt: now,
      tps: 0,
      activeTool: undefined,
      totalTokens: 500,
    },
  ]);

  assert.equal(row.activeTool, undefined, "a finished worker shows no tool");
  assert.equal(row.tps, 0, "a finished worker shows no live rate");
  assert.equal(row.avgTps, 50, "500 tokens over 10 seconds");
});
