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

test("Regime A: one worker + one active task shows the agent badge and label", () => {
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
  assert.equal(rows[0].label, "explore auth");
  assert.equal(rows[0].taskId, "t1");
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
    assert.equal(row.label, undefined);
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
      assert.equal(row.label, undefined);
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
    assert.equal(row.label, "explore auth");
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

test("hostile agent and label names are sanitized in the correlated row", () => {
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
  assert.equal(row.label, "exploreauthx");
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
