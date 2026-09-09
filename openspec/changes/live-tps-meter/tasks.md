# Tasks: Live TPS Meter (tps-gentle-pi)

Execution constraints: strict TDD (`strict_tdd: true`), tests run with `npm test` (Node 24 built-in `node --test`, native TypeScript type stripping), and tests stay co-located with the code they verify. The maintainer explicitly accepted `size:exception` up to 600 changed lines for WU-3 and up to 900 changed lines for WU-4 and up to 1,200 changed lines per work unit for WU-5–WU-9 after the single permitted re-slicing pass was exhausted.

## Re-slicing Status & Evidence

This is the ONE honest re-slicing pass required by the chained-pr skill after a runtime budget incident invalidated the original forecast:

- **WU-1** was delivered at 514 actual product lines (forecast ~330, ~1.56x expansion). The maintainer accepted a **WU-1-only `size:exception`** and a native reset. No blanket exception exists; no other unit may cite the WU-1 exception.
- **WU-2** (original rendering slice) reached 489 actual product lines (forecast ~310, ~1.58x expansion). The maintainer **rejected** a size exception, authorized re-slicing, a native reset, and local commits. The original 2.1–2.4 tasks are recorded as an **invalidated draft**: the oversized WU-2 code will be removed/recreated under bounded attempts in the re-sliced WU-2 and WU-3 below.
- Observed forecast expansion is **~1.5x** on both measured units. Re-forecasts therefore cap every remaining unit at **≤ ~250 forecast product+test lines**, giving a credible actual ceiling of ≤ ~390 lines (≤400 budget respected).
- Both invalid attempts were inflated by untracked cumulative SDD/planning artifacts. **Planning/control artifacts are not product work-unit surfaces.** Local baseline commits (authorized) will commit them once so they stop inflating native changed-line accounting; allowed-edit-root statements below cover product and test files only.

## Review Workload Forecast

| Field | Value |
| ------- | ------- |
| Estimated changed lines | WU-1 delivered at 514 actual (accepted WU-1-only exception). Remaining ~1,560 forecast lines across 8 units (reforecast range at ~1.5x expansion: ~2,300–2,700); each remaining unit forecast ≤ 250 → credible ceiling ≤ ~390 |
| 400-line budget risk | High (total across the change); Low per re-sliced work unit |
| Chained PRs recommended | Yes |
| Suggested split | 9 chained PRs, one per work unit: WU-1 (done) → WU-2 → WU-3 → WU-4 → WU-5 → WU-6 → WU-7 → WU-8 → WU-9 |
| Delivery strategy | ask-on-risk — resolved by the human: split delivery via chained work units |
| Chain strategy | stacked-to-main |
| Size exception | WU-1 accepted at 514 product lines; WU-2 accepted for control-artifact accounting; WU-3 accepted under 600; WU-4 accepted under 900; WU-5–WU-9 explicitly allowed up to 1,200 changed lines per unit. |

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

- The remaining total must NOT be combined into oversized slices. Under `stacked-to-main`, each work unit is its own PR targeting `main`; if a PR's diff is polluted by an unmerged parent or by planning artifacts, retarget/rebase/commit-as-baseline until only that unit appears. One deliverable work unit per PR; tests and docs stay with their unit; every chained PR carries chain context and a dependency diagram marking the current PR.
- Budget is not code-golf: comments, docs, blank lines, and tests are never deleted or compressed to fit. WU-3 used its maintainer-authorized 600-line ceiling; WU-4 used its 900-line ceiling; WU-5–WU-9 use the maintainer-authorized 1,200-line ceiling; stop and report if any unit exceeds its ceiling.
- Slicing is bounded: this is the single re-slicing pass. No further re-slicing after this pass.

## Work Unit 1 — Package Setup, Types & Stats Math Core (COMPLETE — 514 lines, accepted exception)

Allowed edit roots/surfaces: `package.json`, `src/types.ts`, `src/stats.ts`, `test/stats.test.ts` only. Delivered at 514 actual product lines; the maintainer accepted a WU-1-only `size:exception`. This is the final state — WU-1 is never re-sliced.

- [x] 1.1 RED: `test/stats.test.ts` failing tests for `P2Quantile` (bootstrap sort at 64 samples, p95 convergence ±2%), `RingBuffer` (capacity 12, FIFO eviction, chronological `toArray()`), `IncrementalMean` (non-finite/non-positive rejection, mean correctness, division-by-zero protection), `computeTps` (elapsed base at first output delta). RED evidence recorded via `npm test`. <!-- sdd-owner: implementation -->
- [x] 1.2 GREEN: `package.json` (`tps-gentle-pi`, `pi` manifest targeting `./extensions`, `pi-package` keyword, optional peerDependency), `src/types.ts` (type-strippable interfaces/constants; no `enum`/`namespace`/parameter properties), `src/stats.ts` (pure `P2Quantile`, `RingBuffer`, `IncrementalMean`, `computeTps`). GREEN evidence recorded via `npm test`. <!-- sdd-owner: implementation -->
- [x] 1.3 TRIANGULATE: Edge-case tests — P² updated only per completed sample, bounded memory at 1000 samples, FIFO exactly at 12→13, constant mean storage. Result recorded via `npm test`. <!-- sdd-owner: implementation -->
- [x] 1.4 REFACTOR: Structural cleanup, explicit `.ts` import extensions verified, `npm test` result, runtime harness `N/A` (pure math) with reason, and rollback boundary recorded. <!-- sdd-owner: implementation -->

## Work Unit 2 — Rendering Primitives: Format, Sanitize, Gauge & Sparkline (~200 forecast lines)

Replaces the invalidated WU-2 draft. Depends on WU-1. Allowed edit roots/surfaces: `src/format.ts`, `src/graphics.ts`, `test/format.test.ts`, `test/graphics.test.ts` only. The removed/recreated code from the oversized draft is in scope only via these four files.

- [x] 2.1 RED: Author `test/format.test.ts` and `test/graphics.test.ts` with failing tests for rate formatting with color thresholds (green ≥ 50, yellow ≥ 20, red < 20, muted idle), `stripAnsi`/width-measure helpers, text sanitization of hostile agent/tool names containing terminal control codes (strip newlines/control codes, clamp ≤ 64 chars), the 16-char gauge with fractional sub-blocks across rates 0/15/35/75/150 tok/s on track `·`, and the 8-level block sparkline (oldest first). Run `npm test`; record exact failing output as RED evidence. <!-- sdd-owner: implementation -->
- [x] 2.2 GREEN: Implement `src/format.ts` (pure formatters: rate formatting/color coding, token counts, `stripAnsi`, width measurement, sanitize/clamp of untrusted label strings) and `src/graphics.ts` (pure gauge and sparkline renderers using the fractional sub-blocks `[" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]` and 8-level blocks `["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]`). Run `npm test`; record exact passing output as GREEN evidence. <!-- sdd-owner: implementation -->
- [x] 2.3 TRIANGULATE: Add adversarial and reproducibility tests: hostile names with ANSI escapes, unicode edge cases, and control characters never leak into output; identical helper invocation with fixed inputs returns byte-identical strings twice; gauge boundaries at exact thresholds (20/50). Run `npm test`; record exact result. <!-- sdd-owner: implementation -->
- [x] 2.4 REFACTOR: Consolidate formatter duplication, keep helpers exported and pure, re-run `npm test` and record exact result. Record focused test command/result, runtime harness status (`N/A` — pure formatting, no runtime boundary), and rollback boundary (the four files listed above). <!-- sdd-owner: implementation -->

## Work Unit 3 — Responsive Panel Composition & Width Safety (~210 forecast lines)

Replaces the invalidated WU-2 draft's composition half. Depends on WU-1 and WU-2. Allowed edit roots/surfaces: `src/render.ts`, `test/render.test.ts` only.

- [x] 3.1 RED: Author `test/render.test.ts` with failing tests for the responsive layout composer: main-agent row (gauge + rate + sparkline + `μ` + p95 + model, tool-phase variant `Main [tool: bash]`), subagent rows (tree prefixes `├─`/`└─`, badge or honest `subagent`/`subagent · <pid>` fallback, gauge, rate, phase/tool, tokens, model), responsive breakpoints at 60/80/120/160 columns with documented field hiding, and every emitted line satisfying `stripAnsi(line).length <= cols`. Run `npm test`; record exact failing output as RED evidence. <!-- sdd-owner: implementation -->
- [x] 3.2 GREEN: Implement `src/render.ts` as a pure, exported layout composer consuming WU-2 primitives: main-agent row, subagent row list, and width-aware composition per design §5 (wide ≥ 120, standard 80–119, narrow < 80 / min 60). Output depends only on explicit inputs (stats, rows, theme, width) — no ambient mutable global state. Run `npm test`; record exact passing output as GREEN evidence. <!-- sdd-owner: implementation -->
- [x] 3.3 TRIANGULATE: Add determinism and width-adversarial tests: byte-identical output across repeated renders at each breakpoint; rows with maximally long sanitized labels still clamp at 60 columns; zero-worker and many-worker renders fit; layout decisions stable across repeats. Run `npm test`; record exact result. <!-- sdd-owner: implementation -->
- [x] 3.4 REFACTOR: Streamline composition internals without behavior change; re-run `npm test` and record exact result. Record focused test command/result, runtime harness status (`N/A` — pure rendering, no runtime boundary), and rollback boundary (`src/render.ts`, `test/render.test.ts`). <!-- sdd-owner: implementation -->

## Work Unit 4 — IPC Channel Core: Session Directory, Throttled Publication & Atomic Writes (~190 forecast lines)

Depends on WU-1 (types/constants). Allowed edit roots/surfaces: `src/channel.ts`, `test/channel.test.ts` only.

- [x] 4.1 RED: Author `test/channel.test.ts` with failing tests for: unpredictable `pi-tps-<pid>-<ts>` session directory under `os.tmpdir()` with POSIX mode `0700`, `.owner` marker (`{ pid, created, v: 1 }`), Windows path skipping POSIX modes; atomic write-replace (`mode 0o600`, zero residual `.tmp` files); `ThrottledPublisher` ≤ 1 write per 160 ms with immediate flush on significant transitions (tool start/end, turn completion, worker completion) bypassing and resetting the throttle window; 20 streaming updates in 50 ms produce exactly 1 immediate + 1 trailing write. Run `npm test`; record exact failing output as RED evidence. <!-- sdd-owner: implementation -->
- [x] 4.2 GREEN: Implement `src/channel.ts`: session directory creation with `.owner` marker, `ThrottledPublisher` with the semantics above, atomic write-replace including Windows `EBUSY`/`EPERM` catch-unlink-retry-on-next-tick semantics, and child unlink on normal shutdown. All failures degrade silently — no throw escapes. Run `npm test`; record exact passing output as GREEN evidence. <!-- sdd-owner: implementation -->
- [x] 4.3 TRIANGULATE: Add failure-injection tests: unwritable-tempdir creation failure and `ENOSPC` publication failure are caught with no escaping exception; nothing is ever written outside the session directory; no shell commands on any code path (inspect for `child_process`/`exec`/`spawn`); rapid-transition sequences never exceed the throttle ceiling. Run `npm test`; record exact result. <!-- sdd-owner: implementation -->
- [x] 4.4 REFACTOR: Clean publisher/dir seams without behavior change; re-run `npm test` and record exact result. Record focused test command/result, runtime harness scenario (temp-dir lifecycle under fixtures) and exact result, and rollback boundary (`src/channel.ts`, `test/channel.test.ts`). <!-- sdd-owner: implementation -->

## Work Unit 5 — IPC Guard: Schema Validation, Eviction, Scavenger & Safe Aggregation (~190 forecast lines)

Depends on WU-1 and WU-4. Allowed edit roots/surfaces: `src/channel-guard.ts`, `test/channel-guard.test.ts` only.

- [x] 5.1 RED: Author `test/channel-guard.test.ts` with failing tests for `validateWorkerSnapshot` per design §3 (rejects non-objects/arrays/null, wrong `v`, invalid pid/workerId/timestamps/phase, out-of-bounds numbers, oversized/unsanitized optional strings; returns `null`, never throws), snapshot reading with validation-before-aggregation, dead-PID eviction (`kill(pid, 0)` / `ESRCH`), 5000 ms timestamp-staleness eviction as cross-platform fallback, completed-phase eviction, startup scavenger removing only verified stale `pi-tps-*` directories (`.owner` present + dead pid + > 1 h old) while leaving foreign/markerless directories untouched, and parent recursive cleanup of only its own session directory. Run `npm test`; record exact failing output as RED evidence. <!-- sdd-owner: implementation -->
- [x] 5.2 GREEN: Implement `src/channel-guard.ts`: `validateWorkerSnapshot`, validated snapshot reader/aggregator, evictor, scavenger, and cleanup with the ownership boundaries above. Every failure path degrades silently. Run `npm test`; record exact passing output as GREEN evidence. <!-- sdd-owner: implementation -->
- [x] 5.3 TRIANGULATE: Add privacy and torn-write tests: packet contents provably contain no prompt/task/generated text; truncated JSON mid-write is never aggregated as valid; concurrent read during replace yields a complete old or new snapshot; scavenger presented with realistic foreign temp directories preserves every one. Run `npm test`; record exact result. <!-- sdd-owner: implementation -->
- [x] 5.4 REFACTOR: Streamline validator/evictor/scavenger boundaries without behavior change; re-run `npm test` and record exact result. Record focused test command/result, runtime harness scenario (eviction/scavenge under fixtures) and exact result, and rollback boundary (`src/channel-guard.ts`, `test/channel-guard.test.ts` — removal does not affect the WU-4 publisher). <!-- sdd-owner: implementation -->

## Work Unit 6 — Event Tracker: Streaming TPS, Fallback & Turn Finalization (~190 forecast lines)

Depends on WU-1 (stats/types). Allowed edit roots/surfaces: `src/tracker.ts`, `test/tracker.test.ts` only.

- [x] 6.1 RED: Author `test/tracker.test.ts` with failing mock-event tests: `message_start` resets per-message counters; elapsed time bases at the first observed output delta, not message start; `message_update` deltas compute live TPS preferring reported output usage; character-based estimate (`Math.ceil(chars / 4)`) when provider usage is absent, keeping the meter moving; `message_end` finalizes with authoritative usage, replaces/discards the estimate, and pushes to sparkline/mean/p95; `tool_execution_start`/`tool_execution_end` toggle phase and clear the active tool; model/thinking-level label refresh on `model_select`/`thinking_level_select`. Run `npm test`; record exact failing output as RED evidence. <!-- sdd-owner: implementation -->
- [x] 6.2 GREEN: Implement `src/tracker.ts`: main/worker `EventTracker` state machine consuming Pi events into `WorkerSnapshot`-shaped state plus session statistics using WU-1 classes (`RingBuffer`, `IncrementalMean`, `P2Quantile`), updated strictly on message/tool events — never on render ticks. Run `npm test`; record exact passing output as GREEN evidence. <!-- sdd-owner: implementation -->
- [x] 6.3 TRIANGULATE: Add lifecycle adversarial tests: idle render ticks never mutate statistics; counters reset on new message while session statistics retain prior turns; provider never reporting usage falls back cleanly for the whole turn then finalizes at `message_end`; absent optional event fields do not throw. Run `npm test`; record exact result. <!-- sdd-owner: implementation -->
- [x] 6.4 REFACTOR: Isolate event-payload parsing into tolerant helpers; re-run `npm test` and record exact result. Record focused test command/result, runtime harness status (`N/A` — exercised through mocked Pi event emitter), and rollback boundary (`src/tracker.ts`, `test/tracker.test.ts`). <!-- sdd-owner: implementation -->

## Work Unit 7 — Task Correlation Engine & Honest Fallback (~180 forecast lines)

Depends on WU-1 and WU-6. Allowed edit roots/surfaces: `src/correlation.ts`, `test/correlation.test.ts` only.

- [x] 7.1 RED: Author `test/correlation.test.ts` with failing tests: Gentle Agents tool tracking registering `subagent_run`/`subagent_continue`/`subagent_cancel` keyed by `toolCallId`; recording `details.gentleAgents` metadata (`taskId`, `agent`, `status`, `mode`) from `tool_result`; Regime A deterministic 1:1 active set (exactly one worker + one active task shows the agent badge and label); Regime B honest fallback (ambiguous/concurrent/unmatched shows verified runtime facts with `subagent` / `subagent · <pid>`, never a guessed identity). Run `npm test`; record exact failing output as RED evidence. <!-- sdd-owner: implementation -->
- [x] 7.2 GREEN: Implement `src/correlation.ts`: `TrackedTask` registry, task lifecycle transitions (pending → running → completed/cancelled; continue re-activates; cancel evicts task and row; background completion clears the active set), and the two-regime worker-task join per design §4. Run `npm test`; record exact passing output as GREEN evidence. <!-- sdd-owner: implementation -->
- [x] 7.3 TRIANGULATE: Add adversarial correlation tests: two concurrent launches with ambiguous evidence produce two rows with omitted identity and no FIFO/launch-order/timestamp guessing; single `scout`-style 1:1 match shows the badge; cancel mid-run removes the row; finished tasks cease to appear; worker snapshot without registered task renders metrics-only. Run `npm test`; record exact result. <!-- sdd-owner: implementation -->
- [x] 7.4 REFACTOR: De-duplicate transition handling without behavior change; re-run `npm test` and record exact result. Record focused test command/result, runtime harness status (`N/A` — exercised through mocked tool events), and rollback boundary (`src/correlation.ts`, `test/correlation.test.ts`). <!-- sdd-owner: implementation -->

## Work Unit 8 — Extension Wiring & Role Detection (~220 forecast lines)

Depends on WU-1–WU-7. Allowed edit roots/surfaces: `extensions/index.ts`, `test/extension.test.ts` only.

- [ ] 8.1 RED: Author `test/extension.test.ts` with failing integration tests over a mocked `ExtensionAPI`/`ExtensionContext`: `detectRole` returns `parent-tui`, `gentle-worker`, and `headless-noop` across all context/environment combinations per the design decision matrix; parent role initializes tracker/stats, creates and exports `PI_TPS_DIR`, starts an unreferenced 200 ms render interval calling `ctx.ui.setWidget("tps-meter", lines, { placement: "aboveEditor" })` with `process.stdout.columns || 80`; worker role starts tracker + `ThrottledPublisher` on `${PI_TPS_DIR}/worker-${pid}.json` with strictly zero `ctx.ui.setWidget`/`notify`/`confirm` calls; headless role is a silent no-op. Run `npm test`; record exact failing output as RED evidence. <!-- sdd-owner: implementation -->
- [ ] 8.2 GREEN: Implement `extensions/index.ts`: `default function (pi: ExtensionAPI)` wiring `session_start` role detection; parent path (tracker, stats, channel dir, aggregation/correlation hooks on `tool_call`/`tool_result`, render interval, safe scavenger, shutdown cleanup clearing the interval/widget and recursively removing only its own session directory); worker path (channel verification, publication, UI suppression, unlink on `agent_end`/`session_shutdown`/exit); headless path. Run `npm test`; record exact passing output as GREEN evidence. <!-- sdd-owner: implementation -->
- [ ] 8.3 TRIANGULATE: Add lifecycle tests: `session_shutdown` clears timer/widget/directory; worker RPC stdout stays free of widget/UI output; worker with missing `PI_TPS_DIR` stays silent without creating files; the render tick composes exactly the WU-3 panel from current tracker/correlation state. Run `npm test`; record exact result. <!-- sdd-owner: implementation -->
- [ ] 8.4 REFACTOR: Final wiring cleanup without behavior change; re-run `npm test` and record exact result. Record focused test command/result, runtime harness scenario (mocked Pi lifecycle end-to-end) and exact result, and rollback boundary (`extensions/index.ts`, `test/extension.test.ts`). <!-- sdd-owner: implementation -->

## Work Unit 9 — Vanilla Fallback, Degradation Integration & Documentation (~180 forecast lines)

Depends on WU-8. Allowed edit roots/surfaces: `test/fallback.test.ts`, `README.md`, `LICENSE` only.

- [ ] 9.1 RED: Author `test/fallback.test.ts` with failing integration tests: vanilla Pi parent session (`GENTLE_PI_AGENTS_CHILD` unset, no Gentle Agents tools) sets the widget with zero subagent rows and no errors while live TPS/sparkline/mean/p95 work fully; one-off `pi -e` parent (channel not inherited by children) shows no faked rows while the main panel works; failed channel directory creation still initializes the main-agent widget with rows absent and no escaped exception; aggregation failure during a refresh keeps the main panel updating; no gentle-pi module is imported or referenced anywhere in the package. Run `npm test`; record exact failing output as RED evidence. <!-- sdd-owner: implementation -->
- [ ] 9.2 GREEN: Implement only the wiring adjustments in WU-8's `extensions/index.ts` needed to pass the fallback tests... **Exception:** `extensions/index.ts` remains owned by WU-8; if 9.1 exposes a wiring defect, fix it as a minimal bounded edit to `extensions/index.ts` documented in this unit's evidence (still the only additional surface touched). Otherwise 9.2 is test-verification only plus `README.md` and `LICENSE` (MIT): package-based installation required for child visibility including the `pi -e` limitation, vanilla Pi behavior and fallback, temp-file lifecycle/privacy guarantees, supported platforms (Linux/macOS/Windows), troubleshooting. Run `npm test`; record exact passing output as GREEN evidence. <!-- sdd-owner: implementation -->
- [ ] 9.3 TRIANGULATE: Add residual degradation tests: stale/dead worker snapshots evicted by the parent disappear from the panel on the next tick; repeated failed aggregation attempts across many ticks never degrade the main panel; README install instructions match actual `package.json` metadata (name, keywords, manifest). Run `npm test`; record exact result. <!-- sdd-owner: implementation -->
- [ ] 9.4 REFACTOR: Documentation and test polish without behavior change; re-run `npm test` and record exact result. Record focused test command/result, runtime harness scenario (mocked vanilla and degraded sessions) and exact result, and rollback boundary (`test/fallback.test.ts`, `README.md`, `LICENSE`, plus any documented minimal wiring fix). <!-- sdd-owner: implementation -->

## Final Verification & Delivery Preparation

- [ ] 10.1 Run full `npm test` from a clean state and record the exact command and result; confirm the suite runs through Node's built-in `node --test` over `.ts` files with no build or transpilation step. <!-- sdd-owner: implementation -->
- [ ] 10.2 Verify package metadata against the package-distribution spec: name `tps-gentle-pi`, `pi` manifest targeting `./extensions`, `pi-package` keyword present, extension-discovery keywords, optional `@earendil-works/pi-coding-agent` peer dependency declared optional via `peerDependenciesMeta`. Record inspect command/output. <!-- sdd-owner: implementation -->
- [ ] 10.3 Verify width safety end-to-end: every panel line satisfies `stripAnsi(line).length <= terminalWidth` at 60/80/120/160 columns, and no ANSI/control characters from agent or tool names leak into output. Focused tests already exist; re-run them and record exact result. <!-- sdd-owner: implementation -->
- [ ] 10.4 Verify channel cleanup and privacy behavior end-to-end: normal child unlink, parent recursive removal of only its own session directory, scavenger preserving foreign directories, snapshot packets containing no prompt/task/generated text, and channel failures leaving the main-agent meter intact (vanilla fallback scenarios). Re-run channel/guard/extension tests and record exact results. <!-- sdd-owner: implementation -->
- [ ] 10.5 Review workload confirmation: run `git diff --stat` per work unit; confirm WU-3 stayed within 600 and WU-4 stayed within 900 and WU-5–WU-9 stayed within the maintainer-authorized 1,200-line ceiling, tests remain co-located with code, and the delivered chain matches the human-resolved `stacked-to-main` plan (WU-1 → WU-2 → WU-3 → WU-4 → WU-5 → WU-6 → WU-7 → WU-8 → WU-9). Record the WU-1 product exception and WU-2 accounting exception explicitly. <!-- sdd-owner: implementation -->
