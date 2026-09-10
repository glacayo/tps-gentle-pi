# Apply Progress: Live TPS Meter (tps-gentle-pi)

## Superseding Re-slice Decision

The maintainer rejected a WU-2 size exception after the original oversized rendering draft exceeded the 400-line budget. Native attempt authority was reset, and the one permitted honest re-slicing pass replaced the original five-unit plan with nine bounded units in `tasks.md`.

- WU-1 remains complete under its explicit, WU-1-only size exception (514 lines, accepted).
- The original WU-2 rendering draft (`src/render.ts` / `test/render.test.ts`) was removed before baseline commits. Its historical evidence is superseded and does not mark deliverable completion.
- The re-sliced WU-2 ("Rendering Primitives: Format, Sanitize, Gauge & Sparkline") is implemented by this apply session.
- The re-sliced WU-3 ("Responsive Panel Composition & Width Safety") will recreate the layout composer boundfully.
- Current task readiness and numbering are authoritative in `tasks.md`.

## Status

- Change: `live-tps-meter`
- Phase: `sdd-apply`
- Work units executed: **WU-1 (tasks 1.1–1.4)** and **WU-2 (tasks 2.1–2.4)**
- Result: complete for WU-1 and WU-2 (8/8 tasks done)
- Implementation tasks overall: 8/41 complete
- Next recommended: implement WU-3 (`sdd-apply` continues via stacked-to-main chain), then `sdd-verify` after all units.

## Structured Status Consumed

- `schema`: gentle-pi.sdd-status v1
- `change`: live-tps-meter
- `artifactStore`: openspec (authoritative; no `resolve-via-engram` carve-out)
- `dependencies.apply`: ready
- `nextRecommended`: apply
- `applyState`: ready (authoritative)
- `actionContext.mode`: repo-local; `workspaceRoot`/`allowedEditRoots`: `/home/glacayom/localhost/tps-gentle-pi`; warnings: none
- Delivery decision (human-resolved): `ask-on-risk` → split delivery; `chain_strategy=stacked-to-main`; no WU-2 `size:exception`.
- Native attempt `proceed` token: `sha256:4277d4ef0641c4b0ec210854a199b1a3c634c410b8998cbb4b9a95f624f24750`; review budget 400 changed lines.
- Execution mode: `auto`; strict TDD active (`openspec/config.yaml` `strict_tdd: true`, runner `npm test`).

## Delivery Path Resolved (Review Workload Gate)

- `Decision needed before apply: No`.
- `Chained PRs recommended: Yes`.
- `Chain strategy: stacked-to-main`.
- `400-line budget risk: High` (total across change) / low per re-sliced unit.
- Human chose split delivery via chained work units; no `size:exception` requested for WU-2.
- PR order: WU-1 (done) → WU-2 → WU-3 → WU-4 → WU-5 → WU-6 → WU-7 → WU-8 → WU-9, one PR per unit targeting `main`.

## Workload / PR Boundary (WU-2)

- Deliverable: pure rendering primitives — text formatting and sanitization (`src/format.ts`), gauge and sparkline renderers (`src/graphics.ts`) — with co-located tests.
- Files authored (per `wc -l`):

| File | Lines |
| --- | --- |
| src/format.ts | 83 |
| src/graphics.ts | 89 |
| test/format.test.ts | 109 |
| test/graphics.test.ts | 95 |
| **Total** | **376** |

- **Budget:** 376 authored lines ≤ 400-changed-line budget. No `size:exception` needed.
- Chain context: WU-2 is PR #2 of the stacked-to-main chain, stacked on WU-1 (`src/types.ts` supplies `WorkerPhase`/`WORKER_PHASES`; `src/stats.ts` supplies the sparkline history via `RingBuffer`). No later unit imports `format.ts`/`graphics.ts` yet.

## Completed Tasks & Persisted Checkbox Updates

All four WU-2 tasks are marked `- [x]` in `openspec/changes/live-tps-meter/tasks.md`:

- [x] 2.1 RED
- [x] 2.2 GREEN
- [x] 2.3 TRIANGULATE
- [x] 2.4 REFACTOR

(WU-1 tasks 1.1–1.4 were already `- [x]` before this session.)

## Files Changed (this WU-2 session)

- `src/format.ts` (new): `ANSI_*` color constants, `DEFAULT_LABEL_MAX_LENGTH` (64), `stripAnsi`, `measureWidth`, `sanitizeText`, `rateColor`, `formatRate`, `formatTokens`, plus a shared `nonNegative` helper. No `enum`/`namespace`/parameter properties; pure and side-effect-free.
- `src/graphics.ts` (new): `GAUGE_MAX_TPS` (150), `DEFAULT_GAUGE_CELLS` (16), `GAUGE_SUBBLOCKS` (8 fractional blocks), `SPARKLINE_BLOCKS` (8 levels), `formatGauge`, `formatSparkline`, plus a shared `clamp` helper. Pure and side-effect-free.
- `test/format.test.ts` (new): 13 tests.
- `test/graphics.test.ts` (new): 14 tests.
- `openspec/changes/live-tps-meter/tasks.md` (checkboxes 2.1–2.4).
- `openspec/changes/live-tps-meter/apply-progress.md` (this file).

## Strict TDD — TDD Cycle Evidence

Strict TDD active (`strict_tdd: true`, runner `npm test`), RED → GREEN → TRIANGULATE → REFACTOR followed. Baseline before WU-2: 16 passing tests (WU-1).

### RED (task 2.1) — failing tests before production code

Command: `npm test`

`test/format.test.ts` and `test/graphics.test.ts` authored first; both failed to resolve the not-yet-written modules:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/format.ts' ... url: 'file://.../src/format.ts'
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/graphics.ts' ... url: 'file://.../src/graphics.ts'
✖ test/format.test.ts ... 'test failed'
✖ test/graphics.test.ts ... 'test failed'
ℹ tests 18
ℹ pass 16
ℹ fail 2
```

### GREEN (task 2.2) — production code makes tests pass

Command: `npm test`

One RED literal was corrected (author arithmetic, not a code bug): `formatSparkline([7, 1, 4])` expected `█▂▅` (block index 4 is `▅`), not `█▂▄`. Final GREEN output:

```text
ℹ tests 36
ℹ pass 36
ℹ fail 0
```

### TRIANGULATE (task 2.3) — adversarial input, reproducibility, exact boundaries

Command: `npm test` → 43/43 pass. Added tests:

- `sanitizeText never leaks ANSI or control characters from hostile names`
- `sanitizeText preserves surrogate pairs when clamping` (80 emoji → 64 code points, no split)
- `formatting helpers are byte-identical across repeated invocations`
- `rate color boundaries are exact at 20 and 50 tok/s`
- `gauge and sparkline are byte-identical across repeated renders`
- `formatGauge boundaries are exact at empty and full`
- `formatSparkline normalizes the history maximum to the top block`

Result: `ℹ tests 43 / pass 43 / fail 0`.

TRIANGULATE debugging evidence (recorded because it drove a source fix):

- The first ANSI regex (the `ansi-regex`-style OSC branch) mis-consumed `31mme` as an OSC body for the hostile name `na<ESC>[31mme<BEL>...`, yielding `"na🎉"` instead of `"name🎉"`. It was replaced with a precise CSI+OSC pattern (`ESC ] body (BEL|ST)` and `ESC [ params+intermediates <final byte>`), which strips SGR/CSI/OSC without swallowing adjacent text. This is the only behavior-affecting fix of the cycle; the hostile-name test now passes.

### REFACTOR (task 2.4) — consolidate duplication, no behavior change

Command: `npm test` → 43/43 pass (unchanged output).

- `src/format.ts`: extracted the duplicated `Number.isFinite(x) && x > 0 ? x : 0` coercion from `formatRate`/`formatTokens` into a single `nonNegative` helper.
- `src/graphics.ts`: extracted the duplicated `Math.max(lo, Math.min(value, hi))` clamping from `formatGauge`/`formatSparkline` into a single `clamp` helper.
- All public helpers remain exported and pure; internal imports use explicit `.ts` extensions; `node:test`/`node:assert/strict` are Node builtins.

## Runtime Harness Status

- `N/A` — pure formatting/rendering primitives, no runtime boundary. `src/format.ts` and `src/graphics.ts` perform no I/O and no Pi/process interaction; they are exercised entirely through Node 24.20.0 built-in `node --test` over `.ts` (native type stripping, no build/transpile step).
- Test runner: `node --test "test/*.test.ts"` (the `npm test` script from WU-1).

## Rollback Boundary

Delete the four WU-2 files to remove this work unit cleanly: `src/format.ts`, `src/graphics.ts`, `test/format.test.ts`, `test/graphics.test.ts`. WU-1 (`package.json`, `src/types.ts`, `src/stats.ts`, `test/stats.test.ts`) is intact and unaffected; no later unit imports these primitives yet.

## Deviations from Design

1. **Gauge normalization ceiling `GAUGE_MAX_TPS = 150`.** Design §5 specifies the 16-char gauge with fractional sub-blocks but leaves the rate→fill scale unspecified. `150` was chosen so the task-mandated rates 0/15/35/75/150 tok/s map cleanly from empty to full (150 → full). Design's example gauges are illustrative, not exact.
2. **Sparkline normalization to the history's own maximum.** Design §5 specifies 8-level blocks and a 12-turn bounded history but not the scale. Levels normalize against the max value in the presented history (0 → `▁`, max → `█`) so relative turn shape is preserved; an empty/all-zero history renders all `▁`.
3. **`stripAnsi` uses a CSI+OSC pattern, not the full `ansi-regex` alternation.** The full pattern's OSC branch over-matched adjacent text (see TDD evidence). The precise pattern still strips SGR color codes, cursor/erase CSI, and OSC sequences, satisfying the sanitization contract without false positives.

## Remaining Tasks (unchecked)

Remaining implementation-owned tasks are logical WU-3 → WU-9 plus final verification (10.1–10.5), all `- [ ]` in `tasks.md`. Exact unchecked `- [ ]` lines are preserved verbatim there (not duplicated here to keep this artifact reviewable). WU-3 is the next unit (`src/render.ts`, `test/render.test.ts`).

## Skills Loaded

- `work-unit-commits` (`/home/glacayom/.config/opencode/skills/work-unit-commits/SKILL.md`)
- `chained-pr` (`/home/glacayom/.config/opencode/skills/chained-pr/SKILL.md`)

`skill_resolution`: paths-injected (parent-provided exact paths read before work).

## Work Unit 3 — Responsive Panel Composition & Width Safety (tasks 3.1–3.4)

### Status

- Change: `live-tps-meter`; phase: `sdd-apply`; unit: **WU-3 complete** (tasks 3.1–3.4 all `- [x]` in `tasks.md`).
- `src/render.ts` and `test/render.test.ts` authored; `npm test` GREEN at 58/58.
- Implementation tasks overall: 12/41 complete (WU-1 4 + WU-2 4 + WU-3 4).
- Strict TDD followed (RED → GREEN → TRIANGULATE → REFACTOR) with `npm test` (Node 24 built-in `node --test`, native type stripping).

### TDD Cycle Evidence

Baseline before WU-3: 43 tests (WU-1 + WU-2).

**RED (3.1)** — `npm test`: `test/render.test.ts` authored first; 11 tests fail to resolve the not-yet-written module. `✖ test/render.test.ts`, `ERR_MODULE_NOT_FOUND … url: 'file://…/src/render.ts'`. Result: `tests 44 / pass 43 / fail 1`.

**GREEN (3.2)** — implemented `src/render.ts`; first run exposed a missing `formatSparkline` import (`ReferenceError: formatSparkline is not defined`), fixed by adding it to the `./graphics.ts` import. Final `npm test`: `tests 54 / pass 54 / fail 0`.

**TRIANGULATE (3.3)** — added determinism/width-adversarial tests (byte-identical at 60/80/120/160; maximally long sanitized labels clamp ≤ 60; zero-worker renders one line; 12-worker render fits). `npm test`: `tests 58 / pass 58 / fail 0`.

**REFACTOR (3.4)** — extracted `workerName` (removed nested ternary), hoisted `bp`/`cells` locals and consolidated `theme` handling; behavior preserved. A refactor intermediate (`dim` receiving `undefined` theme) was caught by the suite (`TypeError: Cannot read properties of undefined (reading 'dim')`) and fixed with `theme?.dim`; final `npm test`: `tests 58 / pass 58 / fail 0`.

### Budget Overage — size:exception recommendation

- Authored lines: `src/render.ts` **235** + `test/render.test.ts` **219** = **454 changed lines** (new files, `git diff --numstat`).
- Exceeds the 400-line budget by **54 lines** and the ≤~390 re-sliced ceiling, despite one honest reduction pass (478 → 454).
- Cannot shrink further without deleting mandated coverage (15 tests across the four TDD phases) or removing public-API/edge-case documentation — both forbidden by the work-unit-commits skill.
- **Recommendation:** a 54-line `size:exception` for WU-3, OR a human-decision re-slice. The parent prompt pre-declined `size:exception` (`no exception`); this finding is surfaced for the maintainer rather than silently code-golfed.

### Files Changed (WU-3)

- `src/render.ts` (new): pure layout composer `renderMainRow` / `renderSubagentRow` / `renderPanel`, `breakpointFor`, breakpoint constants, `PanelStats`/`WorkerRow`/`PanelTheme` types. Consumes WU-2 `formatGauge`/`formatSparkline`/`formatRate`/`formatTokens`/`sanitizeText`/`stripAnsi`; no ambient state, no I/O.
- `test/render.test.ts` (new): 15 tests (breakpoints, main row, tool-phase variant, badge/fallback, documented field hiding, width safety 60/80/120/160, determinism, long-label clamp, zero/many workers).
- `openspec/changes/live-tps-meter/tasks.md` (checkboxes 3.1–3.4 → `- [x]`).
- `openspec/changes/live-tps-meter/apply-progress.md` (this section).

### Runtime Harness Status

- `N/A` — pure panel composition, no runtime boundary. `src/render.ts` performs no I/O and no Pi/process interaction; exercised entirely via `node --test`.

### Rollback Boundary

Delete the two WU-3 files to remove this unit cleanly: `src/render.ts`, `test/render.test.ts`. WU-1/WU-2 primitives are unaffected (no later unit imports `render.ts` yet).

### Deviations from Design

1. **Gauge rendered without surrounding brackets.** Design §5's illustrative `[■■■■■■■■········]` is drawn as the bare 16/8-cell bar, consistent with WU-2's `formatGauge` contract (no bracket wrapping).
2. **Single uniform two-space field separator.** Design examples use variable whitespace; a fixed `"  "` separator keeps width accounting deterministic and testable.
3. **Model labels are dimmed; badges are not.** Dim color applies to `(model)` only, matching the design's "model in dim text" while keeping correlated badges plain.

## Work Unit 4 — IPC Channel Core (tasks 4.1–4.4)

### Status

- Change: `live-tps-meter`; phase: `sdd-apply`; unit: **WU-4 complete** (tasks 4.1–4.4 all `- [x]` in `tasks.md`).
- `src/channel.ts` and `test/channel.test.ts` authored; `npm test` GREEN at **72/72** (baseline was 58).
- Implementation tasks overall: 16/41 complete (WU-1 4 + WU-2 4 + WU-3 4 + WU-4 4).
- Strict TDD followed (RED → GREEN → TRIANGULATE → REFACTOR) with `npm test` (Node 24 built-in `node --test`, native type stripping).

### TDD Cycle Evidence

Baseline before WU-4: 58 tests.

**RED (4.1)** — `npm test`: `test/channel.test.ts` authored first (9 failing tests across dir/owner/atomic/throttle/significant/shutdown/EBUSY). Fails to resolve the not-yet-written module: `ERR_MODULE_NOT_FOUND: Cannot find module '…/src/channel.ts' imported from '…/test/channel.test.ts'`. Result: `tests 59 / pass 58 / fail 1`.

**GREEN (4.2)** — implemented `src/channel.ts`. `npm test` → `tests 67 / pass 67 / fail 0`.

**TRIANGULATE (4.3)** — added failure-injection tests (unwritable tmp root → `null`; `ENOSPC` → `"failed"` no throw; every write/rename path confined to the session dir; no `child_process`/`exec`/`spawn` in source; rapid significant+streaming sequence = exactly 4 renames). `npm test` → `tests 72 / pass 72 / fail 0`.

**REFACTOR (4.4)** — extracted `workerFileName(pid)` and computed `elapsed` once in `publish`; behavior unchanged. `npm test` → `tests 72 / pass 72 / fail 0`.

### Focused Test Command & Runtime Harness

- Focused: `node --test "test/channel.test.ts"` → `tests 14 / pass 14 / fail 0`.
- Runtime harness (temp-dir lifecycle under fixtures): tests build `fs.mkdtempSync(join(os.tmpdir(), "tps-channel-"))` bases registered for `t.after` recursive removal; directory creation, atomic rename, throttled publication, unlink, and cleanup are real filesystem operations confined to those fixture dirs. EBUSY/EPERM retry and shutdown-timer cancellation use real timers (`await delay(THROTTLE_MS + 50)`).

### Files Changed (WU-4)

- `src/channel.ts` (new, 288 lines): `createSessionDirectory` (unpredictable `pi-tps-<pid>-<ts>-<rand>` dir, `.owner` marker `{pid, created, v:1}`, POSIX `0700` dir / `0600` owner, win32 skips modes), `writeSnapshotAtomic` (`0600` `.tmp` → `renameSync`, zero residual `.tmp`, win32 `EBUSY`/`EPERM` → `"retry"`), `unlinkWorkerSnapshot`, and `ThrottledPublisher` (≤1 write/160 ms, significant-transition immediate flush + window reset, `flush()`, `shutdown()` unlink + timer cancel). All failures degrade silently (`null` / `WriteResult`), no throw escapes.
- `test/channel.test.ts` (new, 353 lines): 14 tests.
- `openspec/changes/live-tps-meter/tasks.md` (checkboxes 4.1–4.4 → `- [x]`).
- `openspec/changes/live-tps-meter/apply-progress.md` (this section).

### Budget — size:exception recommendation

- Authored lines: `src/channel.ts` **288** + `test/channel.test.ts` **353** = **641 changed lines** (new files, `git diff --numstat`).
- Exceeds the maintainer-authorized 600-line WU-3–WU-9 ceiling by **41 lines**.
- Cannot shrink honestly without deleting mandated coverage (the 13 production-behavior tests map 1:1 to tasks 4.1 and 4.3) or removing the defensive try/catch + documentation that implements "no throw escapes" — both forbidden under the no-code-golf rule. After one honest pass the unit remains a single cohesive deliverable and cannot be further sliced.
- **Recommendation:** a 41-line `size:exception` for WU-4. Product-only count (`src/channel.ts`) is 288 lines, well under 600.

### Rollback Boundary

Delete the two WU-4 files to remove this unit cleanly: `src/channel.ts`, `test/channel.test.ts`. WU-1 (`src/types.ts`, `src/stats.ts`) is intact; no later unit imports `channel.ts` yet (WU-5 `channel-guard.ts` will depend on it).

### Deviations from Design

1. **Random suffix appended to the name.** Session dirs are `pi-tps-<pid>-<ts>-<randomBytes(4).hex>`, not the bare `pi-tps-<pid>-<ts>`, to satisfy the spec's "unique and unpredictable" requirement even for two same-millisecond creations; it still matches the `pi-tps-*` scavenger glob.
2. **Owner marker written `0600` on POSIX** (dir `0700`), consistent with the snapshot privacy posture despite the design only mandating `0600` for snapshots.
3. **`WriteResult = "ok" | "retry" | "failed"`.** EBUSY/EPERM is a distinct `"retry"` so `ThrottledPublisher` retries on the next 160 ms tick without an unbounded retry loop on hard failures (ENOSPC/permission → `"failed"` drops the packet silently).

## Work Unit 5 — IPC Guard: Schema Validation, Eviction, Scavenger & Safe Aggregation (tasks 5.1–5.4)

### Status

- Change: `live-tps-meter`; phase: `sdd-apply`; unit: **WU-5 complete** (tasks 5.1–5.4 all `- [x]` in `tasks.md`).
- `src/channel-guard.ts` and `test/channel-guard.test.ts` authored; `npm test` GREEN at **94/94** (baseline was 72).
- Implementation tasks overall: 20/41 complete (WU-1 4 + WU-2 4 + WU-3 4 + WU-4 4 + WU-5 4).
- Strict TDD followed (RED → GREEN → TRIANGULATE → REFACTOR) with `npm test` (Node 24 built-in `node --test`, native type stripping).

### TDD Cycle Evidence

Baseline before WU-5: 72 tests.

**RED (5.1)** — `npm test`: `test/channel-guard.test.ts` authored first (18 tests across `validateWorkerSnapshot`, validated aggregation, dead/stale/completed eviction, scavenger, cleanup). The whole file fails to resolve the not-yet-written module: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/channel-guard.ts' imported from '…/test/channel-guard.test.ts'`. Result: `tests 73 / pass 72 / fail 1` (single `✖ test/channel-guard.test.ts`).

**GREEN (5.2)** — implemented `src/channel-guard.ts`. `npm test` → `tests 90 / pass 90 / fail 0` (72 + 18 new).

**TRIANGULATE (5.3)** — added privacy/torn-write/concurrent-read/foreign-scavenger tests: a contaminated packet drops `prompt`/`task`/`output`/`message` fields and never serializes the planted secret; truncated JSON (`…"phase":"str`) is skipped but not deleted; 25 interleaved atomic replace+read cycles never observe a torn payload (only full tps 1 or 99); six realistic foreign temp dirs (`systemd-private-*`, `npm-cache-*`, chrome, `.config`, plus `pi-tps-*` markerless/foreign-owner) are all preserved. `npm test` → `tests 94 / pass 94 / fail 0`.

**REFACTOR (5.4)** — extracted the per-file read→skip/evict/keep decision into `readWorkerFile` (returning a `FileRead` union) so `readWorkerSnapshots` only handles the aggregation loop; no behavior change. `npm test` → `tests 94 / pass 94 / fail 0`.

### Focused Test Command & Runtime Harness

- Focused: `node --test "test/channel-guard.test.ts"` → `tests 22 / pass 22 / fail 0`.
- Runtime harness (eviction/scavenge under fixtures): tests build `fs.mkdtempSync(join(os.tmpdir(), "tps-guard-"))` bases registered for `t.after` recursive removal; validation is pure, while dead/stale/completed eviction, the startup scavenger, and `removeSessionDirectory` operate on real `pi-tps-*`/foreign fixture dirs with injected `kill` and `now` clocks (no live process is ever signaled). `SCAVENGE_AGE_MS`, `STALENESS_MS` and `OWNER_FILENAME`/`DIR_PREFIX` are imported constants.

### Files Changed (WU-5)

- `src/channel-guard.ts` (new, 319 lines): `validateWorkerSnapshot` (whitelisted fresh object; rejects null/array/non-object, wrong `v`, invalid pid/workerId/timestamps/phase/counters; clamps+sanitizes optional strings; drops unknown fields; never throws), `isPidAlive` (only `ESRCH` = dead), validated `readWorkerSnapshots` (validation-before-aggregation, dead/stale/completed eviction, skip-not-delete for malformed files, sorted by pid), `scavengeStaleDirectories` (only valid `.owner` + dead pid + `> SCAVENGE_AGE_MS`), and `removeSessionDirectory` (refuses non-`pi-tps-*` basenames). All failures degrade silently, no throw escapes.
- `test/channel-guard.test.ts` (new, 501 lines): 22 tests.
- `openspec/changes/live-tps-meter/tasks.md` (checkboxes 5.1–5.4 → `- [x]`).
- `openspec/changes/live-tps-meter/apply-progress.md` (this section).

### Budget

- Authored lines: `src/channel-guard.ts` **319** + `test/channel-guard.test.ts` **501** = **820 changed lines** (new files, `git diff --numstat`).
- Within the maintainer-authorized **900-line WU-4–WU-9 ceiling** (no `size:exception` needed). Product-only count (`src/channel-guard.ts`) is 319 lines.

### Rollback Boundary

Delete the two WU-5 files to remove this unit cleanly: `src/channel-guard.ts`, `test/channel-guard.test.ts`. The WU-4 publisher (`src/channel.ts`, `test/channel.test.ts`) is intact and unaffected; no later unit imports `channel-guard.ts` yet (WU-8 `extensions/index.ts` will be its first consumer).

### Deviations from Design

1. **Oversized optional strings are clamped/sanitized, not rejected.** Design §3 rule 8 says optional strings are "clamped to safe lengths (≤ 64 chars) and sanitized"; the task 5.1 summary loosely groups them under "rejects". Implemented per the explicit rule 8: strings are sanitized (`sanitizeText`) and clamped to 64, while a present-but-non-string optional field is rejected. `workerId` remains a hard ≤128 reject (rule 4).
2. **`completedAt`, when present, must be a finite positive number.** Design §3 only validates `startTime`/`updatedAt`; I applied the same positive-timestamp rule to `completedAt` for consistency and rejected invalid values rather than emitting them.
3. **Scavenger age measured from `.owner.created`, not directory mtime.** Using the marker's own creation timestamp is immune to `touch`/atime churn and satisfies "positively match the package's ownership marker and schema"; the `.owner` must also carry `v === 1` (schema) to be considered.
4. **`removeSessionDirectory` requires a `pi-tps-*` basename.** This is the ownership boundary that prevents an accidental non-package path from ever being recursively deleted; it does not require a `.owner` marker (the parent owns its directory by name even if the marker readback fails).

## Work Unit 6 — Event Tracker: Streaming TPS, Fallback & Turn Finalization (tasks 6.1–6.4)

### Status

- Change: `live-tps-meter`; phase: `sdd-apply`; unit: **WU-6 complete** (tasks 6.1–6.4 all `- [x]` in `tasks.md`).
- `src/tracker.ts` and `test/tracker.test.ts` authored; `npm test` GREEN at **113/113** (baseline was 94).
- Implementation tasks overall: 24/41 complete (WU-1 4 + WU-2 4 + WU-3 4 + WU-4 4 + WU-5 4 + WU-6 4).
- Strict TDD followed (RED → GREEN → TRIANGULATE → REFACTOR) with `npm test` (Node 24 built-in `node --test`, native type stripping). Only `src/tracker.ts` + tests touched; no correlation or extension wiring implemented.

### TDD Cycle Evidence

Baseline before WU-6: 94 tests.

**RED (6.1)** — `npm test`: `test/tracker.test.ts` authored first (10 tests). Whole file fails to resolve the not-yet-written module: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/tracker.ts' imported from '…/test/tracker.test.ts'`. Result: `tests 95 / pass 94 / fail 1` (single `✖ test/tracker.test.ts`).

**GREEN (6.2)** — implemented `src/tracker.ts`. First run: two RED expectations were corrected (author fixture arithmetic, not a code bug): the first `message_update` establishes the elapsed base, so its own TPS is 0; the rate becomes non-zero only once time elapses after that first delta. After correction, `npm test` → `tests 104 / pass 104 / fail 0` (94 + 10 new). During GREEN, the initial `deepGet` helper (returning `unknown`) was rejected by the self-scan `no-unknown-returns` rule and replaced with typed `readStringAt`/`readNumberAt`/`readRecordAt` event-payload parsers; this is a boundary-typing fix with identical behavior.

**TRIANGULATE (6.3)** — added 9 adversarial tests (read-only render ticks never mutate stats; counter reset while session stats retain prior turns; no-usage fallback for the whole turn then estimate finalization; absent optional fields never throw and leave a sane state; `complete()` finalizes an open message idempotently; `totalTokens` accumulates authoritative output while streaming tokens are included live; tool end returns to `streaming` when a message is still open; p95 bootstraps after 64 finalized turns; thinking deltas count toward the estimate). `npm test` → `tests 113 / pass 113 / fail 0`.

**REFACTOR (6.4)** — extracted `onModelSelect`/`onThinkingLevelSelect` private methods so every `handle()` event type dispatches to a private handler (message/tool/model/thinking); behavior unchanged. `npm test` → `tests 113 / pass 113 / fail 0`.

### Focused Test Command & Runtime Harness

- Focused: `node --test "test/tracker.test.ts"` → `tests 19 / pass 19 / fail 0`.
- Runtime harness: `N/A` — exercised entirely through the mocked Pi event emitter (`EventTracker.handle(…)`) with an injected clock; no live Pi/process/fs interaction in WU-6.

### Files Changed (WU-6)

- `src/tracker.ts` (new, 372 lines): `EventTracker` state machine (`handle` dispatcher over `message_start`/`message_update`/`message_end`/`tool_execution_start`/`tool_execution_end`/`model_select`/`thinking_level_select`), `snapshot()` (`WorkerSnapshot`-shaped), `sessionStats()` (`{sparkline, mean, p95, p95SampleCount}`), `complete()`; tolerant payload parsers (`readOutputUsage` across RPC `usage.output` and in-process `message.usage.output`, `readDeltaLength` for text/thinking deltas, `isAssistantTurn` role gate, `readModelLabel`, `readThinkingLevel`, `clampLabel`, `estimateTokens`). Updates strictly on `handle()`/`complete()`; reads never mutate state.
- `test/tracker.test.ts` (new, 422 lines): 19 tests.
- `openspec/changes/live-tps-meter/tasks.md` (checkboxes 6.1–6.4 → `- [x]`).
- `openspec/changes/live-tps-meter/apply-progress.md` (this section).

### Budget

- Authored lines: `src/tracker.ts` **372** + `test/tracker.test.ts` **422** = **794 changed lines** (new files, `git diff --numstat`).
- Within the maintainer-authorized **1,200-line WU-5–WU-9 ceiling** (no `size:exception` needed). Product-only count (`src/tracker.ts`) is 372 lines.

### Workload / PR Boundary

- Deliverable: main/worker streaming TPS event tracker with estimate fallback, authoritative turn finalization, and session statistics. PR #6 of the stacked-to-main chain (WU-1 → … → WU-6 → WU-7 → WU-8 → WU-9), stacked on WU-1 (`stats.ts` supplies `RingBuffer`/`IncrementalMean`/`P2Quantile`/`computeTps`; `types.ts` supplies `WorkerSnapshot`/`WorkerPhase`/constants).

### Rollback Boundary

Delete the two WU-6 files to remove this unit cleanly: `src/tracker.ts`, `test/tracker.test.ts`. WU-1 (`src/stats.ts`, `src/types.ts`) is intact; no later unit imports `tracker.ts` yet (WU-7 `correlation.ts` and WU-8 `extensions/index.ts` will consume it).

### Deviations from Design

1. **Model label uses the compact `id`, not `provider/id`.** Design §5's panel example shows `claude-3-7-sonnet` (the id); Pi's `model_select` passes `event.model` as `{provider, id}`, so `readModelLabel` returns `id` to match that example. A string `event.model` is also tolerated.
2. **`p95SampleCount` exposed in `sessionStats()`.** Adds concrete observability for "p95 was updated" without requiring 64 turns to assert a bootstrapped value; it mirrors `P2Quantile.count` and lets the RED phase assert push-through deterministically.
3. **`complete()` seam added.** Not in tasks 6.1–6.4 but required for the `WorkerSnapshot`-shaped state to represent phase `"complete"`; WU-8 will call it on `agent_end`. It finalizes any still-open message from the estimate first (idempotent).
4. **Reported usage is retained monotonically.** `messageTokens = max(reportedTokens, estimateTokens(chars))` so a provider that reports usage and then omits it on later chunks can never regress the token count.
5. **Live TPS is 0 on the first output delta.** The elapsed base starts at the first delta, so the first delta has zero elapsed and yields 0 by construction; the meter "moves" on the second and later deltas (this is the spec's "elapsed-time base starts at the first observed output delta").
6. **Character estimate counts `thinking_delta` in addition to `text_delta`**, per `explore.md` §1 ("Filters for type text_delta or thinking_delta"), both accumulated into `messageChars`.

## Work Unit 7 — Task Correlation Engine & Honest Fallback (tasks 7.1–7.4)

### Status

- Change: `live-tps-meter`; phase: `sdd-apply`; unit: **WU-7 complete** (tasks 7.1–7.4 all `- [x]` in `tasks.md`).
- `src/correlation.ts` and `test/correlation.test.ts` authored; `npm test` GREEN at **131/131** (baseline was 113).
- Implementation tasks overall: 28/41 complete (WU-1→WU-7 = 7×4). Only WU-7 surfaces touched; **no extension wiring** (WU-8 untouched).
- Strict TDD followed (RED → GREEN → TRIANGULATE → REFACTOR) with `npm test` (Node 24 built-in `node --test`, native type stripping).

### TDD Cycle Evidence

Baseline before WU-7: 113 tests.

**RED (7.1)** — `npm test`: `test/correlation.test.ts` authored first (12 tests). Whole file fails to resolve the not-yet-written module: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/src/correlation.ts' imported from '…/test/correlation.test.ts'`. Result: `tests 114 / pass 113 / fail 1` (single `✖ test/correlation.test.ts`).

**GREEN (7.2)** — implemented `src/correlation.ts`. First run failed one RED literal (`subagent_run tool_call registers a pending task`): a pending run was stored only in the `pending` map, not in the task registry, so `activeTasks()` returned 0. Fixed by registering the run under its `toolCallId` placeholder in the registry, then promoting to the real `taskId` on result. Also fixed a tooling-mangled import (autofix corrupted `import type { WorkerRow }`). Final GREEN: `tests 125 / pass 125 / fail 0`.

**TRIANGULATE (7.3)** — added 6 adversarial tests (no launch-order/timestamp guessing across reversed worker order; deterministic repeat for the scout 1:1 match; cancel mid-run evicts and removes row identity; finished tasks leave the active set; hostile ANSI/control agent+label sanitized; unmatched worker preserves phase/tool/model). `npm test` → `tests 131 / pass 131 / fail 0`.

**REFACTOR (7.4)** — extracted `resolveKind`, `resolveTaskId`, and `recordCall` helpers, and introduced the `GentleAgentsInfo` type, collapsing three nearly-identical `tool_result` branches and the `calls.set` guards; behavior unchanged. `npm test` → `tests 131 / pass 131 / fail 0`.

### Focused Test Command & Runtime Harness

- Focused: `node --test "test/correlation.test.ts"` → `tests 18 / pass 18 / fail 0`.
- Runtime harness: `N/A` — exercised entirely through mocked Pi `tool_call`/`tool_result` events and in-memory `WorkerSnapshot`s (injected `now` clock); no live Pi, process, or filesystem interaction.

### Files Changed (WU-7)

- `src/correlation.ts` (new, 417 lines): `CorrelationEngine` (`handleToolCall`, `handleToolResult`, `correlate`, `tasks`/`activeTasks`), `PendingRun`/`CallEntry`/`GentleAgentsInfo` records, tolerant event parsers (`readToolCallId`, `readToolName`, `readInputString`, `readTaskIdFromInput`, `readGentleAgents`), status mapping (`mapGentleStatus`/`continueStatus`/`isFinishedStatus`), the two-regime join, and `upsert`/`reactivate`/`evict`/`recordCall`/`resolveTaskId`/`resolveKind` transitions. Exports `SUBAGENT_RUN`/`SUBAGENT_CONTINUE`/`SUBAGENT_CANCEL` and `CorrelatedWorker`.
- `test/correlation.test.ts` (new, 345 lines): 18 tests (12 RED + 6 TRIANGULATE).
- `openspec/changes/live-tps-meter/tasks.md` (checkboxes 7.1–7.4 → `- [x]`).
- `openspec/changes/live-tps-meter/apply-progress.md` (this section).

### Budget

- Authored lines: `src/correlation.ts` **417** + `test/correlation.test.ts` **345** = **762 changed lines** (new, untracked files).
- Within the maintainer-authorized **1,200-line WU-5–WU-9 ceiling** (no `size:exception` needed). Product-only count (`src/correlation.ts`) is 417 lines.

### Workload / PR Boundary

- Deliverable: deterministic task/worker correlation engine with honest never-guess fallback. PR #7 of the stacked-to-main chain (WU-1 → … → WU-7 → WU-8 → WU-9), stacked on WU-1 (`types.ts` supplies `TrackedTask`/`TaskMode`/`TaskStatus`/`WorkerSnapshot`), WU-3 (`render.ts` supplies `WorkerRow`), and WU-2 (`format.ts` supplies `sanitizeText`). WU-8 `extensions/index.ts` is the first consumer.

### Rollback Boundary

Delete the two WU-7 files to remove this unit cleanly: `src/correlation.ts`, `test/correlation.test.ts`. WU-1/WU-3/WU-2 primitives are intact; no later unit imports `correlation.ts` yet (WU-8 will).

### Deviations from Design

1. **Pending runs carry a `toolCallId` placeholder `taskId`** until the result assigns the real task id, so `activeTasks()` (and Regime A) see a just-launched subagent before its `tool_result` arrives. The placeholder is promoted (deleted + re-keyed) on result.
2. **Task-mode `subagent_run` results carry terminal `status` (`completed`/`failed`), while background runs return `queued`.** gentle-pi's `launch` awaits task-mode completion, so `mapGentleStatus` maps real `TASK_STATUS` values (`queued→pending`, `running/waiting→running`, `completed/failed/timed_out→completed`, `cancelled→cancelled`); the design's "run result → running" is treated as the default when `status` is absent.
3. **`subagent_continue` uses `input.task_id` (snake_case)** as the target, matching gentle-pi's tool schema; it re-activates the existing task rather than tracking gentle-pi's follow-up as a brand-new task id.
4. **Worker-side completion (phase `complete` / unlink) is handled by WU-5 eviction, not by the registry.** `correlate()` only sees live workers, so a completed worker produces no row; a stale active task whose worker vanished can only degrade to Regime B fallback (never a wrong badge).
5. **`CorrelatedWorker` adds optional `taskId`/`label` beyond `WorkerRow`** so tests can assert the label; `render.ts` (WU-3) currently renders only the `badge`, and WU-8 may surface `label` later.

## Work Unit 8 — Extension Wiring & Role Detection (tasks 8.1–8.4)

### Status

- Change: `live-tps-meter`; phase: `sdd-apply`; unit: **WU-8 complete** (tasks 8.1–8.4 all `- [x]` in `tasks.md`).
- `extensions/index.ts` and `test/extension.test.ts` authored; `npm test` GREEN at **139/139** (baseline was 131).
- Implementation tasks overall: 32/41 complete (WU-1→WU-8 = 8×4). Only WU-8 surfaces touched (`extensions/index.ts`, `test/extension.test.ts`); no fallback/docs work performed.
- Strict TDD followed (RED → GREEN → TRIANGULATE → REFACTOR) with `npm test` (Node 24 built-in `node --test`, native type stripping).

### TDD Cycle Evidence

Baseline before WU-8: 131 tests.

**RED (8.1)** — `npm test`: `test/extension.test.ts` authored first (4 tests: full `detectRole` decision matrix, parent lifecycle, worker publication + UI suppression, headless no-op). The whole file fails to resolve the not-yet-written module: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/extensions/index.ts' imported from '…/test/extension.test.ts'`. Result: `tests 132 / pass 131 / fail 1` (`✖ test/extension.test.ts`).

**GREEN (8.2)** — implemented `extensions/index.ts` (`detectRole`, `wireSession`, `wireParent`, `wireWorker`). `npm test` → `tests 135 / pass 135 / fail 0` (131 + 4 new).

**TRIANGULATE (8.3)** — added 4 lifecycle tests: `session_shutdown` clears timer/widget/directory; worker RPC stream stays free of all UI across the full event set; worker with a missing channel directory stays silent and creates no files; the render tick composes exactly the WU-3 panel from tracker/correlation state. `npm test` → `tests 139 / pass 139 / fail 0`.

**REFACTOR (8.4)** — extracted `wireTrackedEvents` to shared parent/worker event registration (removed the duplicated `for (const eventName of TRACKED_EVENTS)` loops); no behavior change. `npm test` → `tests 139 / pass 139 / fail 0`.

### Focused Test Command & Runtime Harness

- Focused: `node --test "test/extension.test.ts"` → `tests 8 / pass 8 / fail 0`.
- Runtime harness (mocked Pi lifecycle end-to-end): a mocked `ExtensionAPI` (`pi.on` collecting handlers) and mocked `ExtensionContext` (`ctx.mode`, `ctx.hasUI`, `ctx.ui` spies) drive the module; timers and the temp root are injected so the parent's unref'd 200 ms interval, `PI_TPS_DIR` export/cleanup, worker snapshot publication/unlink, and headless no-op are exercised without a live Pi. Result: `tests 8 / pass 8 / fail 0` via `node --test`.

### Files Changed (WU-8)

- `extensions/index.ts` (new, 272 lines): `detectRole` (decision matrix), `wireSession` seam, `wireParent` (tracker, channel dir, scavenger, unref'd 200 ms render interval, widget above editor, shutdown cleanup), `wireWorker` (channel verification, throttled publication, zero UI, unlink via `agent_end`/`session_shutdown`/exit), headless no-op; `RENDER_INTERVAL_MS` (200) and `WIDGET_ID`. Public Pi API consumed via `import type { ExtensionAPI }` only; never imports gentle-pi.
- `test/extension.test.ts` (new, 438 lines): 8 tests (4 RED + 4 TRIANGULATE).
- `openspec/changes/live-tps-meter/tasks.md` (checkboxes 8.1–8.4 → `- [x]`).
- `openspec/changes/live-tps-meter/apply-progress.md` (this section).

### Budget

- Authored lines: `extensions/index.ts` **272** + `test/extension.test.ts` **438** = **710 changed lines** (new, untracked files).
- Within the maintainer-authorized **1,200-line WU-5–WU-9 ceiling** (no `size:exception` needed). Product-only count (`extensions/index.ts`) is 272 lines.

### Workload / PR Boundary

- Deliverable: role detection and lifecycle wiring joining all prior units. PR #8 of the stacked-to-main chain (WU-1 → … → WU-8 → WU-9), stacked on the WU-1/WU-4/WU-5/WU-6/WU-7 modules. WU-9 (`test/fallback.test.ts`, `README.md`, `LICENSE`) is the sole follow-up.

### Rollback Boundary

Delete the two WU-8 files to remove this unit cleanly: `extensions/index.ts`, `test/extension.test.ts`. WU-1–WU-7 modules are intact and none imports `extensions/index.ts`; WU-9 has not been started.

### Deviations from Design

1. **Parent renders once immediately before starting the 200 ms interval.** The design's lifecycle sketch only shows the interval; the extra first render makes the panel visible promptly and is observable in the same widget contract.
2. **Window default is `process.stdout.columns || 80` exactly as specified**, passed straight to `renderPanel`; no extra clamping occurs here because WU-3 already clamps internally.
3. **Worker unlinks on `agent_end`, `session_shutdown`, and process `exit`** per task 8.2, rather than publishing a `complete` snapshot on `agent_end`; the disappearing file is the parent's eviction signal, matching the subagent-rows "completed worker row disappears" scenario.

## Work Unit 9 — Vanilla Fallback, Degradation Integration & Documentation (tasks 9.1–9.4)

### Status

- Change: `live-tps-meter`; phase: `sdd-apply`; unit: **WU-9 complete** (tasks 9.1–9.4 all `- [x]` in `tasks.md`).
- `test/fallback.test.ts`, `README.md`, `LICENSE` authored; `npm test` GREEN at **149/149** (baseline was 139).
- Implementation tasks overall: 36/41 complete (WU-1→WU-9 = 9×4; final verification 10.1–10.5 remain unchecked).
- Strict TDD followed (RED → GREEN → TRIANGULATE → REFACTOR) with `npm test` (Node 24 built-in `node --test`, native type stripping).

### Structured Status Consumed

- Native token `sha256:1ae07244e099c2365fb5c80643e4e60a9d3f50ccbe6d1e58627c3a8b542454a5`; review budget 1,200 changed lines (maintainer-authorized WU-5–WU-9 ceiling).
- `applyState: ready` (authoritative, `artifactStore: openspec`); `actionContext.mode: repo-local`, edit root `/home/glacayom/localhost/tps-gentle-pi`, warnings none.
- Review Workload Gate: `Decision needed before apply: No`; `Chained PRs recommended: Yes`; `Chain strategy: stacked-to-main`. Delivery decision already human-resolved in prior sessions; WU-9 is the last product unit.

### TDD Cycle Evidence

Baseline before WU-9: 139 tests.

**RED (9.1)** — `npm test`: `test/fallback.test.ts` authored first. Initial run: `tests 146 / pass 142 / fail 4`. Two failures were fixture-timing corrections (zero elapsed → `computeTps` legitimately 0), not wiring defects; after letting real milliseconds elapse between streaming deltas, the two runtime tests passed and the two genuine RED failures remained: `README.md exists` and `LICENSE exists` (`AssertionError: README.md exists` / `LICENSE exists`). Final RED state: `tests 146 / pass 144 / fail 2` (the two documentation artifacts absent), with all five runtime scenarios GREEN — **no `extensions/index.ts` wiring defect exposed**.

**GREEN (9.2)** — authored `README.md` and `LICENSE` (MIT). No `extensions/index.ts` edit was needed (9.1 exposed no defect; task 9.2's "test-verification only" branch applies). `npm test` → `tests 146 / pass 146 / fail 0`.

**TRIANGULATE (9.3)** — added three tests (completed worker + dead-pid worker evicted on next tick; five repeated failed-aggregation ticks never degrade the main panel; README install instructions match `package.json` name/manifest/keywords). `npm test` → `tests 149 / pass 149 / fail 0`.

**REFACTOR (9.4)** — removed the unused `extraDeps` parameter from the `startParent` harness helper (no behavior change). `npm test` → `tests 149 / pass 149 / fail 0`.

### Focused Test Command & Runtime Harness

- Focused: `node --test "test/fallback.test.ts"` → `tests 10 / pass 10 / fail 0`.
- Runtime harness (mocked vanilla and degraded sessions): a mocked Pi `on`/`ctx.ui.setWidget` surface plus a fixture temp root and fake interval timer drive the module; the vanilla parent streams a real-clock assistant turn, a `pi -e` parent asserts no worker snapshot files, a file-as-tmp-root forces channel creation failure (ENOTDIR), aggregation failure is forced by removing the channel directory, and completed/dead worker snapshots verify eviction. No live Pi or gentle-pi runtime is used. Result: `tests 10 / pass 10 / fail 0`.

### Files Changed (WU-9)

- `test/fallback.test.ts` (new, 508 lines): 10 tests across 9.1/9.2/9.3 phases.
- `README.md` (new, 104 lines): quick path, `pi install npm:tps-gentle-pi`, child visibility + `pi -e` limitation, vanilla fallback, temporary-file lifecycle/privacy (0700/0600, `.owner`, scavenger), platforms (Linux/macOS/Windows), package metadata, troubleshooting, no telemetry.
- `LICENSE` (new, 20 lines): MIT.
- `openspec/changes/live-tps-meter/tasks.md` (checkboxes 9.1–9.4 → `- [x]`).
- `openspec/changes/live-tps-meter/apply-progress.md` (this section).
- `extensions/index.ts` — **unchanged** (no wiring fix required; 9.1 exposed no defect).

### Budget

- Authored lines: `test/fallback.test.ts` 508 + `README.md` 104 + `LICENSE` 20 = **632 changed lines** (new files; `extensions/index.ts` untouched).
- Within the maintainer-authorized **1,200-line WU-5–WU-9 ceiling** (no `size:exception` needed).

### Rollback Boundary

Delete the three WU-9 files to remove this unit cleanly: `test/fallback.test.ts`, `README.md`, `LICENSE`. There is no documented wiring fix to revert (`extensions/index.ts` was not modified). WU-1–WU-8 modules are intact.

### Deviations from Design

1. **No `extensions/index.ts` wiring defect was exposed.** Task 9.2's `Exception` branch (test-verification only) applied; the only modifications were docs and tests.
2. **README and LICENSE absence was the genuine RED, not runtime behavior.** The five runtime fallback scenarios already held under WU-8 wiring; two initial runtime failures were synchronous-fixture timing corrections (documented under RED), matching the WU-2 "author arithmetic, not a code bug" precedent.
3. **README documents `pi.extensions = "./extensions"` and the discovery keywords explicitly**, beyond the spec's minimum, so the 9.3 metadata-match test is precise rather than tautological.

## Remaining Tasks (unchecked)

Final verification only, all `- [ ]` in `tasks.md`: 10.1 (clean full `npm test`), 10.2 (package metadata inspect), 10.3 (width safety re-run), 10.4 (channel cleanup/privacy re-run), 10.5 (review workload confirmation). Exact unchecked lines are preserved verbatim in `tasks.md`.

## Skills Loaded

- `work-unit-commits` (`/home/glacayom/.config/opencode/skills/work-unit-commits/SKILL.md`)
- `chained-pr` (`/home/glacayom/.config/opencode/skills/chained-pr/SKILL.md`)
- `cognitive-doc-design` (`/home/glacayom/.config/opencode/skills/cognitive-doc-design/SKILL.md`)

`skill_resolution`: paths-injected (parent-provided exact paths read before work).
