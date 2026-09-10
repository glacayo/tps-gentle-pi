# Technical Architecture: Live TPS Meter for Gentle AI (tps-gentle-pi)

`tps-gentle-pi` is a zero-build, zero-configuration Pi extension that renders a live throughput (tokens-per-second, TPS) meter above the editor. It displays live TPS, gauge, 12-turn sparkline, session mean ($\mu$), and streaming p95 for the main agent, plus responsive live rows for active gentle-pi subagents. On vanilla Pi, the main-agent meter functions identically and subagent rows degrade silently.

## Executive Summary

| Architectural Area | Decision |
| --- | --- |
| **Runtime & Build** | Direct TypeScript execution by Pi; Node 24 native type stripping (`node --test`); zero build step, zero transpilation, zero external runtime dependencies. |
| **Package Distribution** | Public npm package named `tps-gentle-pi`, entrypoint `./extensions/index.ts`, tagged with `pi-package` for `pi.dev/packages` gallery discovery. |
| **Cross-Process Model** | Hybrid model: child RPC workers compute local TPS and publish throttled snapshots to a private session tmpfs directory; parent TUI process aggregates snapshots and enriches metadata. |
| **Role Detection** | Deterministic role selection at `session_start` using `ctx.mode`, `ctx.hasUI`, and `process.env.GENTLE_PI_AGENTS_CHILD`. Workers strictly suppress all `ctx.ui` calls to protect RPC stdout. |
| **Correlation & Join** | Honest, deterministic join: 1:1 single-active worker matches task metadata (`agent`, `label`); concurrent or ambiguous workers display verified runtime facts (PID, model, tool, gauge, TPS) with generic labels, never guessing identity. |
| **Filesystem & Privacy** | Unpredictable session directory under `os.tmpdir()` (`0700` POSIX, user ACLs on Windows); atomic write-replace (`0600` POSIX); throttled to $\le 1$ write per 160 ms; zero prompt or generated text stored. |
| **Resource Lifecycle** | Unreferenced intervals (`unref()`); child unlinks snapshot on exit; parent cleans session directory recursively on shutdown; safe scavenger removes verified stale abandoned directories. |
| **Review Workload** | 5 cohesive work units, each $\le 400$ changed lines with tests co-located. |

---

## 1. System Architecture & Component Boundaries

```text
+-------------------------------------------------------------------------------+
|                             Pi Parent (TUI Process)                           |
|                                                                               |
|  +-----------------------+     +-------------------+    +------------------+  |
|  | Main Agent Event      |     | Gentle Agents     |    | Aggregator &     |  |
|  | Tracker (src/tracker) |     | Tool Tracker      |    | Evictor          |  |
|  +-----------+-----------+     +---------+---------+    +--------+---------+  |
|              |                           |                       ^            |
|              v                           v                       |            |
|  +-------------------------------------------------+             |            |
|  | Panel Renderer (src/render.ts)                  |             |            |
|  | - Gauge & Sparkline (src/stats.ts)              |             |            |
|  | - Responsive width clamping (60/100/160 cols)   |             |            |
|  +-----------------------+-------------------------+             |            |
|                          |                                       |            |
|                          v                                       |            |
|         ctx.ui.setWidget("tps-meter", lines)                     |            |
+--------------------------|---------------------------------------|------------+
                           | process.env.PI_TPS_DIR                |
                           v                                       |
+------------------------------------------------------------------|------------+
|  Private Session Directory: path.join(tmpdir, "pi-tps-<pid>-<ts>")            |
|  (POSIX: mode 0700; Windows: User Temp ACLs)                             |
|                                                                               |
|  +--------------------+   +-----------------------+  +---------------------+  |
|  | .owner (marker)    |   | worker-<pid_A>.json   |  | worker-<pid_B>.json |  |
|  +--------------------+   +-----------^-----------+  +----------^----------+  |
+---------------------------------------|-------------------------|-------------+
                                        |                         |
                                        | Atomic rename           | Atomic rename
                                        | (<= 1 write / 160ms)    |
+---------------------------------------+--+  +-------------------+------------+
| Gentle Agents Child A (pi --mode rpc)    |  | Gentle Agents Child B (rpc)     |
| process.env.GENTLE_PI_AGENTS_CHILD = "1" |  | GENTLE_PI_AGENTS_CHILD = "1"    |
| - WorkerTracker (src/tracker.ts)         |  | - WorkerTracker (src/tracker.ts)|
| - ThrottledPublisher (src/channel.ts)    |  | - ThrottledPublisher             |
| - STRICT UI SUPPRESSION (no ctx.ui)      |  | - STRICT UI SUPPRESSION          |
+------------------------------------------+  +--------------------------------+
```

### Module / File Boundaries

The codebase adheres strictly to vanilla Node.js and Pi conventions with no compile or build phase:

```text
tps-gentle-pi/
├── extensions/
│   └── index.ts          # Pi extension entrypoint: role detection, lifecycle wiring
├── src/
│   ├── types.ts          # TypeScript interfaces, schemas, constants (Node 24 type-strippable)
│   ├── stats.ts          # Pure stats: P2Quantile, RingBuffer, IncrementalMean, computeTps
│   ├── render.ts         # Pure rendering: gauge, sparkline, formatters, width-safe layout
│   ├── channel.ts        # IPC: dir creation, atomic write-replace, throttling, validation, eviction
│   └── tracker.ts        # Event state machine: main streaming TPS & tool correlation tracker
├── test/
│   ├── stats.test.ts     # Unit tests for pure mathematical algorithms
│   ├── render.test.ts    # Unit tests for layout, width clamping, and ANSI safety
│   ├── channel.test.ts   # Unit tests for tmpfs lifecycle, throttling, validation, cleanup
│   ├── tracker.test.ts   # Event-driven tests for TPS estimation, turns, and tool correlation
│   └── extension.test.ts # Integration tests for role detection, UI suppression, and fallback
├── package.json          # Package manifest with pi manifest, keywords, peerDependencies
├── README.md             # Usage, installation, architecture, and troubleshooting docs
└── LICENSE               # MIT License
```

### Module Import & Type Stripping Contract

- Every internal import uses standard ESM with explicit `.ts` extensions:
  `import { P2Quantile } from "../src/stats.ts";`
- Node 24 native type stripping (`node --test`) strips type annotations natively without transpilation.
- No TypeScript-specific runtime syntax is permitted: no `enum` (use `as const` objects), no `namespace`, no parameter properties, and no decorators.
- `@earendil-works/pi-coding-agent` is declared as an optional peer dependency (`peerDependenciesMeta: { "@earendil-works/pi-coding-agent": { "optional": true } }`) and imported type-only (`import type { ... }`). It is never bundled.

---

## 2. Role Detection & Execution Model

When Pi executes `default function (pi: ExtensionAPI)`, the extension listens to `session_start`. Role detection determines whether the instance operates as a parent coordinator, an RPC worker, or degrades silently.

### Decision Matrix

```typescript
export type ExtensionRole = "parent-tui" | "gentle-worker" | "headless-noop";

export function detectRole(ctx: { mode: string; hasUI: boolean }, env: NodeJS.ProcessEnv): ExtensionRole {
  const isGentleChild = env.GENTLE_PI_AGENTS_CHILD === "1";
  const hasChannelDir = typeof env.PI_TPS_DIR === "string" && env.PI_TPS_DIR.length > 0;

  if (isGentleChild && hasChannelDir) {
    return "gentle-worker";
  }
  if (ctx.mode === "tui" && !isGentleChild) {
    return "parent-tui";
  }
  return "headless-noop";
}
```

| Evaluated State | Detected Role | Actions Taken |
| --- | --- | --- |
| `ctx.mode === "tui" && GENTLE_PI_AGENTS_CHILD !== "1"` | **`parent-tui`** | 1. Initialize main agent `EventTracker`, `P2Quantile`, `RingBuffer`. 2. Create unique session directory `PI_TPS_DIR` under `os.tmpdir()`. 3. Export `process.env.PI_TPS_DIR = sessionDir`. 4. Start unreferenced 200 ms render timer. 5. Listen to Gentle Agents tool events (`tool_call`, `tool_result`). 6. Register `session_shutdown` hook for resource release. |
| `GENTLE_PI_AGENTS_CHILD === "1" && PI_TPS_DIR != null` | **`gentle-worker`** | 1. Initialize worker `EventTracker` and `ThrottledPublisher`. 2. Hook local message and tool events. 3. **Strictly suppress all `ctx.ui` calls** (`setWidget`, `notify`, `confirm`). 4. Publish state snapshots to `${PI_TPS_DIR}/worker-${process.pid}.json`. 5. Unlink snapshot on `agent_end`, `session_shutdown`, and process exit. |
| `GENTLE_PI_AGENTS_CHILD === "1" && PI_TPS_DIR == null` | **`headless-noop`** | Extension was not loaded in parent or parent directory creation failed. Worker suppresses UI and exits silently without throwing or creating files. |
| `ctx.mode === "rpc" \|\| ctx.mode === "print"` (standalone) | **`headless-noop`** | Standalone non-TUI run without Gentle Agents marker. Does not set widget, does not create channel. Silent no-op. |

---

## 3. Snapshot Schema, Validation & Atomic Publication

### Schema Definition

The worker snapshot is a minimal current-state telemetry packet. It contains zero prompt text, user input, task description, or LLM-generated output.

```typescript
export interface WorkerSnapshot {
  /** Schema protocol version */
  v: 1;
  /** Worker operating system process ID */
  pid: number;
  /** Worker session identifier */
  workerId: string;
  /** Process start timestamp (epoch milliseconds) */
  startTime: number;
  /** Snapshot generation timestamp (epoch milliseconds) */
  updatedAt: number;
  /** Current agent execution phase */
  phase: "waiting" | "streaming" | "tool" | "complete";
  /** Active model identifier (e.g. "claude-3-7-sonnet") */
  model?: string;
  /** Reasoning effort / thinking level if active */
  thinkingLevel?: string;
  /** Active tool name if in "tool" phase (e.g. "read", "bash") */
  activeTool?: string;
  /** Live output tokens per second (0 when not streaming) */
  tps: number;
  /** Cumulative output tokens for current assistant message */
  messageTokens: number;
  /** Total cumulative output tokens for this worker session */
  totalTokens: number;
  /** Completion timestamp if phase === "complete" */
  completedAt?: number;
}
```

### Schema Validation Rules

Before reading or aggregating any snapshot file, the parent validates it with a pure function `validateWorkerSnapshot(data: unknown): WorkerSnapshot | null`:

1. Reject if `data` is not a plain object or is `null` / `Array`.
2. `data.v === 1`.
3. `data.pid` is an integer $> 0$.
4. `data.workerId` is a non-empty string $\le 128$ characters.
5. `data.startTime` and `data.updatedAt` are finite positive numbers.
6. `data.phase` is strictly one of `"waiting"`, `"streaming"`, `"tool"`, `"complete"`.
7. `data.tps`, `data.messageTokens`, `data.totalTokens` are finite non-negative numbers.
8. Optional strings (`model`, `thinkingLevel`, `activeTool`) are clamped to safe lengths ($\le 64$ chars) and sanitized (newlines/control characters stripped).
9. If any check fails, return `null` immediately. Never throw.

### Atomic Publication Semantics

To prevent readers from observing torn, partial, or locked writes:

1. **POSIX (`process.platform !== "win32"`)**:
   - Write snapshot to `${PI_TPS_DIR}/.worker-${pid}.${Date.now()}.tmp` with `mode: 0o600`.
   - Atomically rename temporary file to `${PI_TPS_DIR}/worker-${pid}.json` via `fs.renameSync`.
   - Atomic rename replaces the existing file instantaneously at filesystem level.
2. **Windows (`process.platform === "win32"`)**:
   - Inherits user profile temporary directory ACLs (no POSIX mode flags).
   - Write to `.tmp` file, then invoke `fs.renameSync`. If `EBUSY` or `EPERM` occurs due to an overlapping read tick, catch the exception, unlink `.tmp`, and retry on the next throttle tick (160 ms later).
   - Readers use `fs.readFileSync` with immediate descriptor close, minimizing lock collisions.
3. **Write Throttling**:
   - Updates are throttled to at most one disk write per 160 ms during streaming.
   - Significant state transitions (`tool_execution_start`, `tool_execution_end`, `message_end`, `agent_end`) flush immediately, bypassing and resetting the throttle window.

---

## 4. Deterministic Task/Worker Correlation & Honest Fallback

### The Core Correlation Reality

Gentle Agents launches workers using `spawn(pi.command, ["--mode", "rpc", "--session-dir", ...])`:

- **Parent Surface**: `pi.on("tool_call")` observes `{ agent, task, label, mode }`. `pi.on("tool_result")` observes `details.gentleAgents = { taskId, agent, status, mode }`.
- **Worker Surface**: The worker runs in an isolated process. It knows its own `process.pid`, `model`, `phase`, `activeTool`, and `tps`. It does **not** receive `taskId` or `agent` badge in CLI args or environment.
- **Public API Constraint**: `details.gentleAgents` exposes `taskId`, but does not expose child `pid`.

Because neither PID is exposed in tool results nor Task ID in child processes, **no exact universal cryptographic join key exists across arbitrary concurrent launches without mutating gentle-pi internals**.

### Correlation Specification: Two Regimes

To maintain absolute rigor and obey the mandate to **never guess**, the parent correlation engine implements two deterministic regimes:

```text
+-------------------------------------------------------------------------------+
|                        Correlation Resolution Pipeline                        |
+-------------------------------------------------------------------------------+
                                        |
                   Active Workers Count & Active Tasks Count
                                        |
                    +-------------------+-------------------+
                    |                                       |
             Exactly 1 Active                        >= 2 Active Workers
             Worker & 1 Active Task                  (or Unmatched Count)
                    |                                       |
                    v                                       v
        +-----------------------+               +-----------------------+
        |  1:1 DETERMINISTIC    |               |  HONEST FALLBACK      |
        |  REGIME               |               |  (NEVER GUESS)        |
        +-----------------------+               +-----------------------+
        | Map worker to task:   |               | Display verified      |
        | - Show agent badge    |               | worker runtime facts: |
        |   (e.g. "scout")      |               | - Label: "subagent"   |
        | - Show task label     |               |   or "worker #<pid>"  |
        | - Show child model    |               | - Child model         |
        | - Show child tool/TPS |               | - Child tool/TPS      |
        +-----------------------+               +-----------------------+
```

#### Regime A: Deterministic 1:1 Active Set

- **Trigger**: Exactly one worker snapshot is active in `PI_TPS_DIR`, and exactly one Gentle Agents task is active in the parent correlation registry.
- **Display**: The row is enriched with the task's observed `agent` badge (e.g. `scout`, `architect`) and `label` (e.g. `explore auth`).
- **Safety**: Unambiguous because only one delegated worker exists in the entire session.

#### Regime B: Honest Fallback (Concurrent / Ambiguous)

- **Trigger**: Two or more workers are active simultaneously, or a worker appears without a registered active task, or task count does not match worker count.
- **Rule**: **THE EXTENSION NEVER GUESSES.** It does not guess by launch order, process timestamps, or FIFO queues.
- **Display**:
  - The row **omits invented agent names** and displays a neutral identifier: `subagent` or `subagent · ${pid}`.
  - The row displays **100% verified, authentic worker metadata**:
    - Current model (reported directly by worker, e.g. `claude-3-7-sonnet`).
    - Current phase & active tool (reported directly by worker, e.g. `tool: read`, `streaming`, `waiting`).
    - Live gauge (calculated directly from worker tokens).
    - Live TPS (calculated directly from worker stream timing).
    - Cumulative tokens (from worker usage).
- **Result**: Zero false attributions (e.g. labeling a reviewer as a coder). Live throughput visibility remains complete and actionable.

### Task Lifecycle Tracking

```typescript
export interface TrackedTask {
  taskId: string;
  agent: string;
  label?: string;
  mode: "task" | "background";
  status: "pending" | "running" | "completed" | "cancelled";
  startedAt: number;
}
```

1. `tool_call` for `subagent_run`: Register pending task with `agent`, `label`, `mode`.
2. `tool_result` for `subagent_run`: Match by `toolCallId`, record `taskId` from `details.gentleAgents`, transition status to `"running"`.
3. `tool_call` / `tool_result` for `subagent_continue`: Re-activate task to `"running"`.
4. `tool_call` / `tool_result` for `subagent_cancel`: Transition status to `"cancelled"`, evict task and remove associated row.
5. Task completion / child exit: When child snapshot unlinks or phase is `"complete"`, task is cleared from the active set.

---

## 5. Panel Rendering & Layout Engine

### Layout Specifications

The above-editor panel is composed of pure string lines returned to `ctx.ui.setWidget("tps-meter", lines, { placement: "aboveEditor" })`.

#### Main Agent Row

```text
Main   [■■■■■■■■········]  42.5 tok/s  ▂▃▅▆▇█  μ 38.2  p95 51.0  (claude-3-7-sonnet)
```

- **Prefix / Phase**: `Main` (or `Main [tool: bash]` when executing a tool).
- **Live Gauge**: 16-character bar with fractional sub-blocks `[" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]` on track `·`.
- **Live Rate**: Formatted rate in `tok/s`, color-coded (green $\ge 50$, yellow $\ge 20$, red $< 20$, muted when idle).
- **Sparkline**: 12-turn history using 8-level blocks `["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]`.
- **Statistics**: Session mean ($\mu$) and P² streaming p95.
- **Model**: Active model name in dim text.

#### Subagent Rows (One per active worker)

```text
├─ scout     [■■■■■···········]  24.1 tok/s  tool: read  (1.4k tok)  claude-3-5-haiku
└─ subagent  [■■■■■■■■■■······]  58.0 tok/s  streaming   (3.2k tok)  claude-3-7-sonnet
```

- **Tree Prefix**: `├─` for intermediate rows, `└─` for the terminal worker row.
- **Identity**: Correlated agent badge (e.g. `scout`) or honest fallback (`subagent`).
- **Gauge**: 16-character live gauge representing worker TPS.
- **Live Rate**: Worker output TPS.
- **Phase / Tool**: Current activity (`tool: <name>`, `streaming`, `waiting`).
- **Tokens & Model**: Cumulative tokens and reported model.

### Responsive Width Safety

Terminal width is obtained via `process.stdout.columns || 80`. All rendering is passed through width-clamping logic:

| Terminal Width | Main Agent Row Rendering | Subagent Row Rendering |
| --- | --- | --- |
| **Wide ($\ge 120$ cols)** | Full layout: Gauge + Rate + Sparkline + Mean + p95 + Model + Tool. | Full layout: Tree prefix + Badge + Gauge + Rate + State/Tool + Tokens + Model. |
| **Standard ($80–119$ cols)** | Gauge + Rate + Sparkline + Mean + p95. (Model label truncated or hidden). | Tree prefix + Badge + Gauge + Rate + State/Tool + Tokens. (Model hidden). |
| **Narrow ($< 80$ cols, min 60)** | Compact: Gauge (8 chars) + Rate + Sparkline. (Stats/model hidden). | Tree prefix + Badge + Gauge (8 chars) + Rate + State. (Tokens/model hidden). |

Every line is strictly checked: `stripAnsi(line).length <= terminalWidth`. No line wraps or corrupts terminal output.

---

## 6. Statistics Engine (`src/stats.ts`)

### P² Streaming Quantile Sketch (`P2Quantile`)

To track the 95th percentile throughput across an entire session with $O(1)$ memory and $O(1)$ update time:

- Implements Jain & Chlamtac's piecewise-parabolic quantile approximation algorithm for $p = 0.95$.
- Maintains 5 marker positions and marker heights ($q_1, q_2, q_3, q_4, q_5$).
- **Bootstrap Phase**: The first 64 samples are stored in a fixed array. Upon receiving the 64th sample, values are sorted, initial marker heights are set to exact quantiles ($0, p/2, p, (1+p)/2, 1$), and bootstrap storage is released.
- **Streaming Updates**: Each completed turn adjusts marker positions using parabolic prediction with linear fallback.
- **Update Frequency**: Updated **strictly upon `message_end`**, never on render ticks. Idle render ticks do not alter the sketch.

### Incremental Session Mean

```typescript
export class IncrementalMean {
  private count = 0;
  private sum = 0;

  add(value: number): void {
    if (!Number.isFinite(value) || value <= 0) return;
    this.count++;
    this.sum += value;
  }

  get value(): number {
    return this.count > 0 ? this.sum / this.count : 0;
  }
}
```

Memory consumption is strictly constant ($O(1)$) across unbounded turns.

### Bounded Sparkline Ring Buffer

Fixed array of 12 elements. Pushing the 13th completed turn evicts the oldest entry. `toArray()` returns entries in chronological order (oldest first).

---

## 7. Lifecycle, Cleanup & Graceful Degradation

### Lifecycle State Machine

```text
[Pi session_start]
        |
   detectRole()
        |
        +---> "parent-tui" : 1. mkdirSync(PI_TPS_DIR, { mode: 0700 })
        |                    2. writeFileSync(.owner, { pid, created, v: 1 })
        |                    3. start setInterval(renderTick, 200).unref()
        |                    4. run safeScavenger() on old pi-tps-* dirs
        |
        +---> "gentle-worker" : 1. verify PI_TPS_DIR exists
        |                       2. start ThrottledPublisher(PI_TPS_DIR, pid)
        |                       3. suppress all ctx.ui.*
        |
        +---> "headless-noop" : do nothing

[Pi message / tool events]
        |
   Stream output deltas -> update live TPS
   message_end          -> finalize turn with authoritative usage, update sparkline/stats
   tool execution       -> toggle phase to "tool" / "waiting"

[Pi session_shutdown / process exit]
        |
        +---> Worker: unlinks worker-<pid>.json; cancels pending flush timers
        |
        +---> Parent: clears render interval; ctx.ui.setWidget("tps-meter", undefined)
                      recursively removes PI_TPS_DIR via fs.rmSync({ recursive: true, force: true })
```

### Staleness & Orphan Eviction Rules

1. **Child PID Liveness Check**:
   - On POSIX: `try { process.kill(pid, 0); } catch (e) { if (e.code === "ESRCH") dead = true; }`
   - If dead, the parent unlinks `worker-${pid}.json` immediately and purges the row.
2. **Timestamp Staleness Fallback (Cross-Platform)**:
   - If `Date.now() - snapshot.updatedAt > 5000` (5 seconds without updates), the worker is deemed stale/frozen.
   - The snapshot is unlinked and evicted from the display.
3. **Completed Workers**:
   - If `snapshot.phase === "complete"`, the parent removes the file and excludes it from the panel. Completed subagents are never retained as historical clutter.
4. **Safe Startup Scavenger**:
   - Scans `os.tmpdir()` for folders matching `pi-tps-*`.
   - Reads `.owner` file inside.
   - If `.owner` exists AND `owner.pid` is dead (`kill(pid, 0)` throws `ESRCH`) AND folder is $> 1$ hour old: safely deletes the folder.
   - If `.owner` is absent or invalid: leaves folder completely untouched.

### Graceful Degradation Matrix

| Component Failure | Consequence | Fallback Behavior |
| --- | --- | --- |
| `os.tmpdir()` unwritable / session dir creation fails | Parent cannot create IPC channel | Parent runs in main-only mode; widget shows main agent TPS; subagent rows absent; zero exceptions escape. |
| Subagent child cannot write snapshot (`ENOSPC` / permissions) | Worker cannot publish telemetry | Worker catches error silently; main Pi session continues uninterrupted. |
| Corrupted / torn snapshot file read by parent | Malformed JSON or schema violation | `validateWorkerSnapshot` returns `null`; file skipped; main panel and valid rows render normally. |
| Provider omits `usage.output` in streaming chunks | Missing real-time token count | Heuristic fallback `Math.ceil(chars / 4)` keeps meter moving; replaced by authoritative usage at `message_end`. |
| vanilla Pi environment (no gentle-pi installed) | `GENTLE_PI_AGENTS_CHILD` never set, no subagent tools called | Main-agent meter functions fully; subagent rows never appear; zero errors or overhead. |

---

## 8. Pure Test Seams & Strict TDD Strategy

Every module is designed around pure functions and isolated state objects, enabling 100% test coverage using Node 24 native `node --test` without running a live Pi harness.

### Test Suite Structure

```text
test/
├── stats.test.ts     # P2Quantile, RingBuffer, IncrementalMean, computeTps
├── render.test.ts    # Gauge, sparkline, rate formatters, width clamping, ANSI sanitization
├── channel.test.ts   # Session dir, atomic publication, throttling, schema validation, eviction
├── tracker.test.ts   # Message event stream, tool states, Gentle Agents tool correlation
└── extension.test.ts # Role detection, extension lifecycle, UI suppression, vanilla fallback
```

### Test Seam Details

1. **`test/stats.test.ts`**:
   - Verify `P2Quantile` bootstrap sort at 64 samples.
   - Verify $p95$ convergence against synthetic uniform and normal distributions ($\pm 2\%$ tolerance).
   - Verify `RingBuffer` bounds (capacity 12, FIFO eviction, chronological ordering).
   - Verify `IncrementalMean` with edge cases (zero tokens, division by zero protection).
2. **`test/render.test.ts`**:
   - Test gauge formatting across 0, 15, 35, 75, 150 tok/s.
   - Test sparkline block characters against varying turn histories.
   - Test terminal width clamping at 60, 80, 120, 160 columns: verify `stripAnsi(line).length <= cols`.
   - Test sanitization of hostile tool/agent names containing terminal control codes.
3. **`test/channel.test.ts`**:
   - Test directory creation with POSIX mode `0700` and owner marker verification.
   - Test atomic write-replace and verify zero residual `.tmp` files.
   - Test schema validator with valid snapshots, truncated JSON, out-of-bounds numbers, and injected prompt text.
   - Test write throttling: trigger 20 streaming updates in 50 ms and assert exactly 1 immediate write and 1 trailing write.
   - Test dead PID eviction and 5000 ms timestamp staleness eviction.
4. **`test/tracker.test.ts`**:
   - Mock event emitter simulating `message_start` $\to$ multiple `message_update` $\to$ `message_end`.
   - Test character-based estimate fallback during streaming, followed by authoritative usage replacement.
   - Test `tool_execution_start` / `tool_execution_end` phase transitions.
   - Test Gentle Agents tool correlation: single 1:1 match vs ambiguous multi-worker fallback.
5. **`test/extension.test.ts`**:
   - Test role detection logic under all environment combinations.
   - Test worker role: assert zero calls to `ctx.ui.setWidget` or `ctx.ui.notify`.
   - Test vanilla Pi session: assert parent widget sets successfully with zero subagent rows.
   - Test `session_shutdown`: assert timers cleared, widget cleared, directory deleted.

---

## 9. Work Unit Implementation Slices (400 Changed-Line Budget)

In compliance with the SDD review workload guard and `work-unit-commits` discipline, the implementation is decomposed into 5 reviewable work units. Each unit pairs production code with co-located tests, delivers a coherent capability, and remains well within the canonical 400-changed-line limit.

### Work Unit Breakdown

| Unit | Title & Scope | Files Created / Modified | Forecast Lines (Code + Test) |
| --- | --- | --- | --- |
| **WU-1** | **Package Setup, Types & Stats Math Core**: Package manifest (`package.json`), core types & interfaces (`src/types.ts`), pure stats engine (`src/stats.ts`), unit tests for stats (`test/stats.test.ts`) | `package.json`, `src/types.ts`, `src/stats.ts`, `test/stats.test.ts` | ~330 lines |
| **WU-2** | **Pure Panel Rendering & Width Safety**: Gauge & sparkline renderers (`src/render.ts`), rate formatters & color coding, responsive layout composer (60/100/160 cols), rendering & layout tests (`test/render.test.ts`) | `src/render.ts`, `test/render.test.ts` | ~310 lines |
| **WU-3** | **IPC Channel, Atomic Publication & Eviction**: Session dir & owner marker (`src/channel.ts`), atomic write-replace & throttling, schema validator & PID/stale evictor, channel lifecycle tests (`test/channel.test.ts`) | `src/channel.ts`, `test/channel.test.ts` | ~340 lines |
| **WU-4** | **Event Tracker & Task Correlation Engine**: Streaming TPS tracker & estimate fallback (`src/tracker.ts`), authoritative turn finalizer, Gentle Agents tool tracking & honest fallback, tracker & correlation tests (`test/tracker.test.ts`) | `src/tracker.ts`, `test/tracker.test.ts` | ~340 lines |
| **WU-5** | **Extension Wiring, Vanilla Fallback & Docs**: Role detection & lifecycle entry (`extensions/index.ts`), parent widget refresh & worker UI suppression, integration tests (`test/extension.test.ts`), package documentation & license (`README.md`, `LICENSE`) | `extensions/index.ts`, `test/extension.test.ts`, `README.md`, `LICENSE` | ~350 lines |

### Total Forecast

- Authored production & test code: ~1,670 lines across 5 focused, independently reviewable PRs/commits.
- No slice exceeds 360 lines, eliminating review budget overages without code-golfing.
