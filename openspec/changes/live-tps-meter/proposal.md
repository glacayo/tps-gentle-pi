# Proposal: Live TPS Meter for Pi and Gentle Agents

`tps-gentle-pi` will be a zero-configuration Pi extension that shows live throughput for the main agent and every active gentle-pi subagent in a compact panel above the editor. It will remain fully useful on vanilla Pi, where the main-agent meter stays intact and subagent rows are simply absent.

## Decision summary

| Topic | Proposal decision |
| --- | --- |
| Product slice | Main-agent live TPS plus one live row per active gentle-pi subagent |
| Package | Public npm package named `tps-gentle-pi`, discoverable through pi.dev/packages |
| Runtime | TypeScript loaded directly by Pi; no build or generated runtime artifacts |
| Subagent transport | Private, throttled, ephemeral temporary-file IPC between isolated Pi processes |
| Compatibility | Full main-agent behavior on vanilla Pi; gentle-pi remains optional |
| Platforms | Linux, macOS, and Windows through cross-platform Node.js APIs |
| Data lifecycle | Session-scoped metrics only; no retained telemetry or network service |

## Intent

Pi users can see token totals after work completes but cannot see whether the main agent or delegated Gentle Agents workers are currently producing output quickly, waiting, or using a tool. Existing in-process throughput registries cannot solve this for gentle-pi because `AgentRunner` launches each worker as an isolated `pi --mode rpc` process.

This change will make active throughput visible at the moment it is useful without requiring users to configure a service, modify gentle-pi, or sacrifice the same main-agent experience when gentle-pi is unavailable.

## MVP experience

### Main agent

The panel will show:

- a live TPS rate and gauge while assistant output streams;
- a 12-turn session sparkline;
- an incremental session mean (`μ`); and
- a streaming p95 calculated with a P² quantile sketch.

Final token usage from Pi will be authoritative when available. During streaming, the tracker may use live usage or a documented character-based estimate so the meter continues to move when a provider delays usage reporting.

### Gentle-pi subagents

Each active Gentle Agents worker will have one row containing its agent identity, model, current state or tool, gauge, and live TPS. Rows will be based on metrics calculated inside the isolated worker and enriched in the parent from observable gentle-pi tool metadata. Completed, cancelled, dead, or stale workers will be removed rather than retained as history.

### Vanilla Pi and degraded operation

The extension will not import or require gentle-pi. If gentle-pi is not installed, no Gentle Agents tools are observed, a worker does not load the extension, or the IPC channel is unavailable, the main-agent panel will continue to operate and no invalid subagent row will be shown. Failure of optional subagent collection must not crash or block a Pi session.

## Scope

### In scope

1. A Pi extension panel above the editor with the main-agent and active-subagent behavior described above.
2. O(1) incremental mean, bounded sparkline storage, and a P² streaming p95 updated when messages complete rather than on render ticks.
3. A hybrid subagent architecture: child-side live metric publication plus parent-side aggregation and metadata enrichment.
4. Private, throttled, ephemeral temporary-file IPC with stale-record detection and automatic cleanup.
5. Responsive, deterministic rendering implemented through pure, exported helpers where practical.
6. Cross-platform behavior on Linux, macOS, and Windows using Node.js `fs`, `os`, `path`, process, and timer APIs rather than shell-specific commands.
7. Direct TypeScript loading by Pi and TypeScript tests executed by Node's built-in test runner, with no compilation or bundling step.
8. Public npm distribution as `tps-gentle-pi`, including a Pi extension manifest, `pi-package` discovery metadata, documentation, and an optional Pi peer dependency.

### Out of scope

- Metrics for non-gentle-pi orchestrators or arbitrary child processes.
- Persistent throughput history, analytics, telemetry upload, dashboards, or a network daemon.
- Cost reporting, prompt/input TPS, time-to-first-token analytics beyond internal rate timing, or provider benchmarking.
- User configuration, custom thresholds, themes, placement controls, or historical drill-down in the MVP.
- Changes to gentle-pi's `AgentRunner`, private task store, transcript format, widgets, or RPC protocol.
- Guaranteed subagent rows when the extension is loaded only with a one-off parent `pi -e` flag that gentle-pi does not propagate to children. The main-agent meter must still work in that case.

## Proposed technical direction

The parent TUI process will create a unique session directory under `os.tmpdir()`, expose its location only to inherited child processes, aggregate current worker snapshots, and render the panel on a bounded refresh interval. A gentle-pi RPC child that has both the Gentle Agents child marker and the inherited channel location will suppress UI output, calculate its own TPS from Pi events, and publish a small state snapshot at most once per 150–200 ms during streaming, plus immediate updates for significant state transitions.

The channel is an intentional, bounded exception to the project's in-memory preference:

- The directory will be unpredictable and private to the user session. POSIX implementations will request directory mode `0700` and file mode `0600`; Windows will use the current user's temporary directory and inherited ACLs.
- Publications will be partial-read-safe and schema-validated before aggregation.
- Children will unlink their own files on normal shutdown. The parent will remove dead or stale worker files and recursively remove only its own session directory on shutdown.
- No metric file will be treated as durable state, and no data will be written outside the package-owned session directory.
- If creation, publication, reading, validation, or cleanup fails, subagent rows will degrade safely while main-agent tracking remains available.

The design phase must specify deterministic correlation between worker snapshots and the public Gentle Agents task metadata, including concurrent launches, continuation, cancellation, and background-task completion. It must never guess an agent identity when correlation evidence is insufficient.

## Consumed integration surfaces

### Pi extension events

| Event | Consumption |
| --- | --- |
| `session_start` | Select parent TUI or child RPC behavior, initialize session state, and start only the resources appropriate to that role. |
| `session_shutdown` | Stop timers, remove the widget, close child publication, and clean the package-owned temporary session state. |
| `message_start` | Begin timing an assistant response and reset per-message counters. |
| `message_update` | Observe text/thinking deltas and live output usage to update current TPS. |
| `message_end` | Finalize authoritative tokens and elapsed time; update main-agent sparkline, mean, and p95. |
| `model_select` | Refresh the current model label without waiting for another message. |
| `thinking_level_select` | Refresh displayed reasoning-effort metadata where available. |
| `tool_execution_start` | Set the current main or child phase and active tool name. |
| `tool_execution_end` | Clear the active tool and return to the appropriate waiting/streaming phase. |
| `tool_call` | Observe Gentle Agents calls such as `subagent_run`, `subagent_continue`, `subagent_cancel`, and `subagent_send_message`; other tools are ignored for subagent metadata. |
| `tool_result` | Read the public `details.gentleAgents` result metadata when present to correlate task ID, agent, status, and mode. |
| `agent_end` | Mark a child worker complete and publish/remove its terminal state. |

All handlers will use the vanilla Pi `ExtensionAPI`/`ExtensionContext` surface (`pi.on`, `ctx.mode`, `ctx.hasUI`, and `ctx.ui.setWidget`). RPC children will not call TUI widget or notification APIs.

### Gentle-pi surfaces

| Surface | Consumption boundary |
| --- | --- |
| `AgentRunner` | Consumed indirectly as a documented runtime behavior: it spawns isolated `pi --mode rpc` children, sets `GENTLE_PI_AGENTS_CHILD=1`, inherits the parent environment, and does not disable globally/package-loaded extensions. `tps-gentle-pi` will not import, patch, or mutate `AgentRunner`. |
| Gentle Agents tools | Consumed through Pi's public `tool_call` and `tool_result` events for task identity and lifecycle metadata. No private gentle-pi API is required. |
| Private task store | Not consumed. It is an unexported closure and does not expose the timestamped token stream required for accurate live TPS. |
| Live task thread/RPC normalization | Not consumed directly. `AgentRunner` drops the delta timing needed for live throughput before storing task updates. |
| History and session transcripts | Not consumed. They are updated at turn completion rather than per streaming delta and therefore cannot provide live TPS. |

These boundaries preserve vanilla Pi compatibility and avoid a runtime dependency on gentle-pi internals.

## Affected areas

| Area | Expected impact |
| --- | --- |
| Extension runtime | Event tracking, bounded statistics, role detection, parent aggregation, child publication, and widget lifecycle. |
| Rendering | Main-agent summary plus responsive active-worker rows above the editor. |
| Temporary state | One private, ephemeral directory per parent session containing throttled worker snapshots. |
| Package metadata | `tps-gentle-pi` name, `pi` manifest targeting `./extensions`, `pi-package`/extension keywords, and optional `@earendil-works/pi-coding-agent` peer dependency. |
| Documentation | Install guidance for package-based loading, vanilla Pi behavior, temporary-file lifecycle, supported platforms, and troubleshooting. |
| Tests | Pure stats/rendering tests, mocked Pi event-state tests, IPC lifecycle tests, vanilla fallback tests, and Linux/macOS/Windows compatibility coverage. |
| gentle-pi | No source, storage, protocol, or package changes. |

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Worker extension is not loaded when the parent uses a one-off `pi -e` path | Missing subagent rows | Document package/global installation as required for child visibility; keep main-agent behavior intact. |
| Concurrent task launches are correlated to the wrong metadata | Misleading agent labels | Require deterministic task/session correlation in design and test concurrent run, continue, cancel, and background flows; omit unverified enrichment rather than guess. |
| Streaming writes create excessive I/O | Host overhead and poor UX | Throttle snapshots to at most one per 150–200 ms, write only small current-state packets, and render on a bounded interval. |
| A crash or forced kill leaves files behind | Stale rows or temporary clutter | Validate timestamps and PIDs where supported, evict stale/dead workers, unlink on normal child exit, and remove the parent session directory on shutdown and safe startup scavenging. |
| Another local process reads or modifies snapshots | Information exposure or forged rows | Use an unpredictable per-session directory, restrictive permissions/ACLs, schema validation, ownership boundaries, and no prompt or generated text in packets. |
| File replacement or PID-liveness behavior differs by OS | Missing/stale rows on one platform | Use cross-platform Node APIs, partial-read-safe publication, timestamp expiry as a liveness fallback, and test Linux, macOS, and Windows. |
| Pi or gentle-pi event payloads evolve | Metrics or enrichment stop updating | Isolate event parsing, tolerate absent optional fields, test documented payload shapes, and degrade to main-only behavior instead of failing the session. |
| Provider usage arrives late or not at all | Live rate differs from final rate | Prefer reported output usage, clearly bound the character estimate fallback, and replace estimates with final usage at `message_end`. |
| Implementation exceeds the 400-line review budget | Review quality declines | Keep pure math/rendering, main tracking, IPC, and subagent aggregation as separate reviewable work units of at most 400 changed lines; pause for the configured delivery decision if that bound is at risk. |

## Rollback plan

1. **User rollback:** Disable or remove `tps-gentle-pi` from Pi package settings and restart Pi. Because the package owns no durable data or migrations, this restores the previous UI and runtime immediately.
2. **IPC safety rollback:** If subagent collection is defective, disable the child publisher and parent aggregator in a corrective release while retaining the isolated main-agent meter. Clear the inherited channel variable and remove only the package-created session directory during shutdown.
3. **Release rollback:** Deprecate the defective npm version and direct users to the last known-good version; publishing or deprecation remains a separately authorized release action.
4. **Cleanup:** Normal child shutdown removes worker snapshots, normal parent shutdown removes the session directory, and a later safe scavenger may remove only stale directories that match the package's ownership marker and schema.
5. **No coupled revert:** No gentle-pi code, transcript, task-store data, or user project data is changed, so rollback does not require a gentle-pi release or data restoration.

## Success criteria

The MVP is successful when all of the following are true:

1. During a main-agent assistant response, the above-editor panel updates live TPS and a gauge, then records the completed turn in a 12-turn sparkline, incremental mean, and P² p95.
2. During gentle-pi execution, each active worker that loads the package produces exactly one current row with correct observable identity/model/state/tool data and a live TPS rate; stale and completed rows disappear.
3. On vanilla Pi, the same main-agent panel works with no gentle-pi installation, no subagent rows, and no extension errors.
4. A missing, inaccessible, malformed, stale, or partially written IPC snapshot cannot crash Pi and cannot disable the main-agent meter.
5. Worker snapshots are throttled, contain no prompt or generated text, use private session-scoped storage, and are cleaned automatically without persistent telemetry.
6. The package and tests run on Linux, macOS, and Windows without shell-specific logic.
7. Pi loads the shipped TypeScript directly, `npm test` runs TypeScript tests through Node's built-in test runner, and no build step is introduced.
8. The public npm package is named `tps-gentle-pi` and includes the manifest and keywords required for pi.dev package discovery.
9. Implementation work remains within the configured 400-changed-line review budget per work unit or stops at the configured delivery-risk gate before exceeding it.

## Evidence and next phase

This proposal is based on the confirmed decisions in `openspec/changes/live-tps-meter/preproposal.md` and the inspected Pi/gentle-pi behavior recorded in `openspec/changes/live-tps-meter/explore.md`. Formal external research was not selected.

The next phase should define normative behavior in the OpenSpec specification, including vanilla fallback, IPC failure handling, worker lifecycle, privacy, rendering expectations, and cross-platform scenarios. The following design phase must then resolve packet schema, deterministic task correlation, safe publication semantics, cleanup ownership, and module boundaries without expanding the MVP.
