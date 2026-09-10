# Exploration: Live TPS Meter for Gentle AI (tps-gentle-pi)

## Overview & Goals

The goal of `tps-gentle-pi` is to provide a public npm Pi package inspired by `omp-throughput` that renders a live throughput (tokens-per-second, TPS) meter panel above the editor.

- **Main Agent**: Real-time gauge, session sparkline (12 turns), mean throughput $\mu$, and p95 streaming quantile sketch.
- **Gentle-pi Subagents**: One live row per active subagent showing agent badge, model, state/tool, gauge, and TPS rate.
- **Vanilla Pi Guarantee**: On vanilla Pi (where `gentle-pi` is not installed or no subagents run), the extension retains full main-agent functionality and subagent rows never appear. Zero crashes, zero breaking changes.

This exploration investigates the exact APIs, runtime execution models, cross-process constraints, reference design reuse, and risk mitigation strategies based on direct inspection of `@earendil-works/pi-coding-agent` (v0.85.1) and `gentle-pi` (v2.5.0).

---

## 1. Vanilla Pi Extension Lifecycle & UI Widget APIs

### Lifecycle & Event Subscription

Pi extensions export a default function receiving `ExtensionAPI`:

```typescript
export default function (pi: ExtensionAPI): void;
```

Every event handler receives `(event, ctx: ExtensionContext)`.

Key lifecycle hooks:

- `session_start`: Fired when Pi starts, resumes, forks, or reloads. Guarded with `ctx.hasUI` (`true` in TUI and RPC modes). In interactive TUI mode (`ctx.mode === "tui"`), this initializes the UI refresh interval (200ms) and resets or reconstructs session-level metrics.
- `session_shutdown`: Cleans up background resources: clears `setInterval` UI timer, clears widget (`ctx.ui.setWidget(KEY, undefined)`), and unlinks cross-process communication directories.
- `model_select` & `thinking_level_select`: Fires when the active model or reasoning effort changes, updating label displays immediately.

### Message Events & TPS Calculation

Pi streams assistant output through three sequential event types:

1. `message_start`:
   - Fired when an assistant turn begins: `event.message.role === "assistant"`.
   - Marks phase as `"streaming"`, initializes `messageStartedAt = Date.now()`, `firstTokenAt = 0`, `messageChars = 0`, `messageTokens = 0`, `messageOpen = true`.
2. `message_update`:
   - Fired for every chunk. The token stream is accessed via `event.assistantMessageEvent`.
   - Filters for `type === "text_delta"` or `type === "thinking_delta"` with a non-empty `delta.delta`.
   - First token latency: if `firstTokenAt === 0`, set `firstTokenAt = Date.now()`.
   - Accumulates characters: `messageChars += delta.delta.length`.
   - Token count: extracted from `event.message.usage.output` if reported by provider in real time, or estimated via heuristic `Math.ceil(messageChars / 4)`.
   - Streaming TPS: `elapsed = (Date.now() - firstTokenAt) / 1000`. If `elapsed >= 0.1`, `tps = messageTokens / elapsed`, else `0`.
3. `message_end`:
   - Finalizes the turn. Authoritative token usage is read from `event.message.usage.output` (or fallback estimate).
   - Final turn TPS is calculated against `Date.now() - (firstTokenAt || messageStartedAt)`.
   - Main agent stats update:
     - Appended to 12-item sparkline ring buffer (`mainSpark`).
     - Added to cumulative mean counters: `mainSum += tps`, `mainCount++`.
     - Sampled into `P2Quantile(0.95)` sketch for $p95$.
   - Phase resets to `"waiting"`, `messageOpen = false`.

### Tool Execution Events

- `tool_execution_start`: Fires when tool preflight finishes and execution starts (`event.toolName`, `event.toolCallId`). Transitions phase to `"tool"` and records active tool name.
- `tool_execution_end`: Fires when tool execution finishes. Transitions phase back to `"waiting"`.

### UI Widget API

Pi provides `ctx.ui.setWidget(key, content, options)`:

- `key`: Unique widget namespace string (e.g. `"tps-meter"`).
- `content`: `string[] | undefined` (or component factory). Using `string[]` allows pure, deterministic rendering functions that are 100% unit-testable without a terminal harness.
- `options`: `{ placement: "aboveEditor" | "belowEditor" }`. Defaults to `"aboveEditor"`.
- Passing `undefined` removes the widget cleanly.
- Styling is applied using Pi's theme helpers: `ctx.ui.theme.fg(role, text)` where role is `"accent"`, `"success"`, `"warning"`, `"error"`, `"dim"`, `"muted"`, etc.

---

## 2. Gentle-pi Subagent Execution & Data Surfaces

Authoritative inspection of `gentle-pi` v2.5.0 (`gentle-agents.ts`, `lib/agents-runner.ts`, `lib/agents-protocol.ts`, `lib/agents-widget.ts`) reveals the following architecture:

### Execution Model

- **Process Isolation**: Gentle Agents does not run subagents in-process. `AgentRunner` launches each subagent as an isolated child OS process:

  ```typescript
  spawn(pi.command, ["--mode", "rpc", "--session-dir", request.sessionDir, ...], {
    cwd: request.cwd,
    env: { ...request.env, GENTLE_PI_AGENTS_CHILD: "1" },
    detached: process.platform !== "win32"
  });
  ```

- **Child Extension Disabling**: `gentle-agents.ts` explicitly checks:

  ```typescript
  if (env.GENTLE_PI_AGENTS_CHILD === "1") return false;
  ```

  Gentle Agents prevents itself from re-running inside child subagent processes.

### Data Boundaries & Closures

- `store: TaskStore` and `runner: AgentRunner` in `gentle-agents.ts` are **private closure variables** inside the extension entry function. They are **not** attached to `globalThis`, **not** exported, and **not** exposed on `pi.events`.
- In the parent process, Gentle Agents renders its own widget (`"gentle-agents"`) above the editor showing:
  `glyph · agent · task summary · model · tokens · cost · time`
  Gentle Agents does **not** calculate or display TPS (tokens-per-second) for subagents.
- Subagent RPC stream handling:
  - Child writes RPC JSON lines to stdout.
  - `AgentRunner.receive()` calls `normalizeRpcEvent(raw)`.
  - On `message_update`, it extracts text deltas to append to `TaskThread`, but drops delta timestamps and does not compute streaming rate.
  - On `message_end`, it extracts cumulative usage tokens (`task.tokens += event.tokens`).
  - Disk persistence (`historyDir`): Tasks are only written to disk upon completion (`onFinish: persist(task)`), not while running.
  - Session files (`~/.pi/agent/gentle-agents/sessions/*.jsonl`): Pi appends entries only on turn completion (`message_end`), never during token streaming deltas.

### Tool Invocation Surface in Parent

In the parent agent session, the LLM delegates work by calling tools registered by `gentle-agents`:

- `subagent_run(agent, task, label, mode)`
- `subagent_continue(task_id, prompt, label, mode)`
- `subagent_cancel(task_id)`
- `subagent_send_message(task_id, message)`

When `subagent_run` is invoked:

- In `pi.on("tool_call")`, parent extensions observe `event.input.agent` (e.g. `"scout"`, `"reviewer"`), `event.input.label` (e.g. `"map footer data sources"`), and `event.input.mode` (`"task"` or `"background"`).
- In `pi.on("tool_result")`, parent extensions observe `event.details.gentleAgents = { taskId, agent, status, mode }`.

---

## 3. Feasible Cross-Process Architectures

### Do Child RPC Sessions Load Globally Installed Extensions?

**YES.** Evidence from `@earendil-works/pi-coding-agent` (`dist/main.js` and `dist/core/resource-loader.js`):

1. When `pi --mode rpc` executes, `createAgentSessionServices` instantiates `DefaultResourceLoader`.
2. `loadCurrentExtensionSet()` calls `this.packageManager.resolve()`, which loads all packages from `settings.json` and auto-discovers global extensions in `~/.pi/agent/extensions/*.ts` and `~/.pi/agent/extensions/*/index.ts`.
3. `agents-runner.ts` passes `["--mode", "rpc", "--session-dir", ...]` and does **not** pass `--no-extensions`.
4. Therefore, globally installed extensions (and project-trusted extensions) are loaded inside every subagent child process.

### Architecture Comparison

| Dimension | Option A: Pure Parent-Side Observation | Option B: Pure Child-Side Publishing | Option C: Hybrid (Child Publisher + Parent Enricher) |
| --- | --- | --- | --- |
| **Mechanism** | Parent polls child session files or hooks `TaskStore` | Child streams metrics via IPC/file; parent displays | Child computes live TPS; parent enriches with agent badges from tool calls |
| **Feasibility** | **Infeasible for live TPS**: Pi session files do not flush per-token; `TaskStore` is an unexported closure. | **Feasible for TPS, but missing agent badge**: Child does not know its Gentle Agents badge name (`scout`). | **Fully Feasible**: Child provides high-precision TPS; parent provides agent badge & label. |
| **Live TPS Fidelity** | None (only turn-level post-hoc) | Microsecond per-token streaming rate | Microsecond per-token streaming rate |
| **State Cleanliness** | In-memory parent only | Potential stale worker files on `SIGKILL` | Parent monitors worker PIDs (`kill(pid, 0)`) and purges directory on exit |
| **Vanilla Pi Impact** | None | None (child branch never runs) | None (child branch never runs) |

### Selected Architecture: Hybrid (Child Publisher + Parent Enricher)

1. **Parent Initialization (`ctx.mode === "tui"`)**:
   - Creates a private session directory: `path.join(os.tmpdir(),`pi-tps-${process.pid}`)`.
   - Exports `process.env.PI_TPS_DIR = dirPath`.
   - Because Node's `child_process.spawn` inherits parent `process.env` (via `request.env = deps.env`), all spawned subagent children inherit `PI_TPS_DIR`.
   - Parent listens to `pi.on("tool_call")` for `subagent_run` to map the upcoming task to `agent` name (`scout`, `reviewer`, etc.) and `label`.
   - UI loop (every 200ms) reads active worker files in `PI_TPS_DIR`, checks worker PID liveness (`process.kill(pid, 0)`), joins agent metadata, and renders the composite panel.
   - On shutdown/exit, parent recursively removes `PI_TPS_DIR`.
2. **Child Execution (`process.env.GENTLE_PI_AGENTS_CHILD === "1"` or `ctx.mode === "rpc"`)**:
   - Detects worker role. Skips all `ctx.ui` calls (avoiding RPC stdout protocol noise).
   - Subscribes to child Pi events (`message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_end`, `agent_end`).
   - Computes local subagent TPS with high accuracy.
   - Writes throttled state updates (at most once every 150-200ms) to `path.join(process.env.PI_TPS_DIR,`worker-${process.pid}.json`).
   - State packet: `{ pid, sessionId, model, thinking, phase, toolName, tps, messageTokens, totalTokens, updatedAt, completedAt }`.
   - On `agent_end` marks `phase: "complete"`; on exit unlinks its file.

---

## 4. The omp-throughput Reference Design (MIT Reuse vs Adaptations)

### Reusable Concepts (Under MIT)

1. **P² Streaming Quantile Sketch (`P2Quantile`)**:
   - Uses Jain & Chlamtac's 5-marker piecewise-parabolic quantile approximation.
   - Computes streaming $p95$ in $O(1)$ memory and $O(1)$ time without unbounded array storage.
   - 64-sample bootstrap buffer, followed by dynamic marker adjustment.
2. **Visual Components & ASCII Bar Art**:
   - Ring buffer sparkline (`mainSpark`, length 12) rendered using 8 level blocks: `["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]`.
   - Gauge bar rendered using 8 fractional sub-blocks: `[" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]` on `·` track.
   - Rate color coding: $\ge 50$ green, $\ge 20$ yellow, $< 20$ red.
   - Responsive column width computation based on terminal columns (`process.stdout.columns`).

### Required Adaptations

1. **Replace In-Process `globalThis`**:
   `omp-throughput` used `globalThis[Symbol.for("omp.throughput.registry.v1")]` because omp workers ran in-process. In `gentle-pi`, this is replaced by the cross-process tmpfs communication channel.
2. **Role & UI Suppression in RPC**:
   Workers must detect RPC/child mode and completely silence UI rendering (`setWidget`, `notify`), publishing metrics exclusively over the channel.
3. **Agent Metadata Mapping**:
   Instead of hardcoded omp subagent names, `tps-gentle-pi` dynamically extracts subagent names and badges from gentle-pi `subagent_run` tool calls.

---

## 5. Test Seams & Major Risks

### Test Seams

1. **Pure Math & Stat Modules** (`stats.ts`):
   - `P2Quantile`: Bootstrap sorting, marker updates, quantile accuracy tests against synthetic uniform and normal distributions, `reset()` behavior.
   - Ring buffer: Eviction policy on capacity overflow.
   - Token rate calculations: Edge cases (elapsed time $< 0.1s$, zero tokens).
2. **Pure UI Rendering Modules** (`render.ts`):
   - `renderGauge`, `renderSparkline`, `formatRate`, `formatTokens`.
   - Column layout and truncation at narrow (60), standard (100), and wide (160) terminal widths.
   - Mock theme helper testing (escapes, ANSI lengths, visual widths).
3. **Event State Machine** (`tracker.ts`):
   - Mock `ExtensionAPI` event emitter simulating: `message_start` $\to$ multiple `message_update` $\to$ `tool_execution_start` $\to$ `tool_execution_end` $\to$ `message_end` $\to$ `agent_end`.
   - Assert state transitions (`waiting` $\to$ `streaming` $\to$ `tool` $\to$ `waiting` $\to$ `complete`).
4. **Cross-Process Channel** (`channel.ts`):
   - Unit test writer and reader against a mock temporary directory.
   - Verify serialization, throttled writes, stale worker eviction, and dead PID handling.
5. **Vanilla Pi Compatibility**:
   - Execute test suite with no gentle-pi tools or subagents present: assert main panel renders accurately with zero subagent rows and zero errors.

### Major Risks & Mitigations

1. **Risk: `pi -e` CLI Flag Propagation**:
   - *Detail*: If a developer runs `pi -e ./tps-gentle-pi.ts`, gentle-pi does not pass `-e` to spawned `pi --mode rpc` child processes. Child subagents will not load the extension.
   - *Mitigation*: Clearly document in README that package must be installed globally (`pi install`) or configured in `settings.json` / `~/.pi/agent/extensions/` for subagent rows to populate. Main-agent TPS remains fully functional in all modes.
2. **Risk: Disk I/O from Frequent Streaming Updates**:
   - *Detail*: Writing to disk on every token chunk would cause I/O thrashing.
   - *Mitigation*: Child worker throttles writes: updates file at most once every 150ms during streaming, plus immediate writes on discrete state transitions (`tool_start`, `agent_end`).
3. **Risk: Orphaned Worker Files**:
   - *Detail*: If a subagent process is abruptly terminated (`SIGKILL`), its JSON file could linger.
   - *Mitigation*: Parent aggregator actively checks PID liveness (`process.kill(pid, 0)`). Any file whose PID is no longer alive is purged immediately. Parent deletes the entire session directory on shutdown.
4. **Risk: Review Budget Exceeded**:
   - *Detail*: Canonical SDD review budget is 400 lines per PR/work unit.
   - *Mitigation*: Split implementation into clean, modular work units:
     1. Math, stats & formatting pure functions + tests (~250 lines).
     2. Main agent tracker & UI widget integration + tests (~280 lines).
     3. Cross-process channel & child publisher + tests (~260 lines).
     4. Subagent row integration & aggregator + tests (~250 lines).

---

## Conclusion & Next Phase Handoff

All 5 investigation topics have been resolved with authoritative evidence. The design path for the proposal phase is clear: a lightweight hybrid architecture delivering live TPS with zero dependencies, zero build step, native `node --test` compatibility, and full vanilla Pi graceful fallback.
