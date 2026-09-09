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
