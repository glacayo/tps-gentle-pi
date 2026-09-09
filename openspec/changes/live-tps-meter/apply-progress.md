# Apply Progress: Live TPS Meter (tps-gentle-pi)

## Superseding Re-slice Decision

The maintainer rejected a WU-2 size exception after the original rendering draft exceeded the 400-line budget. Native attempt authority was reset, and the one permitted honest re-slicing pass replaced the original five-unit plan with nine bounded units in `tasks.md`.

- WU-1 remains complete under its explicit, WU-1-only size exception.
- The original WU-2 rendering evidence below is retained as historical RED/GREEN evidence only; it no longer marks deliverable completion.
- The oversized `src/render.ts` and `test/render.test.ts` draft was removed before baseline commits and will be recreated through the new bounded WU-2 and WU-3 tasks.
- Current task readiness and numbering are authoritative in `tasks.md`.

## Status

- Change: `live-tps-meter`
- Phase: `sdd-apply`
- Work units executed: **WU-1 (tasks 1.1–1.4)** and **WU-2 (tasks 2.1–2.4)**
- Result: **complete for WU-1 and WU-2** (8/8 tasks done; 8/25 overall implementation tasks done)
- Next recommended: implement WU-3 (`sdd-apply` continues via stacked-to-main chain), then `sdd-verify` after all units.

## Structured Status Consumed

- `schema`: gentle-ai.sdd-status v2
- `change`: live-tps-meter
- `artifactStore`: openspec (authoritative; no `resolve-via-engram` carve-out)
- `dependencies.apply`: ready
- `nextRecommended`: apply
- `applyState`: ready (authoritative)
- `actionContext.mode`: repo-local; `workspaceRoot`/`allowedEditRoots`: `/home/glacayom/localhost/tps-gentle-pi`; warnings: none
- Delivery decision (human-resolved): `ask-on-risk` → split delivery; `chain_strategy=stacked-to-main`; no `size:exception`.
- Execution mode: `auto`; strict TDD active (`openspec/config.yaml` `strict_tdd: true`, runner `npm test`).

## Delivery Path Resolved (Review Workload Gate)

- `Decision needed before apply: No` (gate already resolved).
- `Chained PRs recommended: Yes`.
- `Chain strategy: stacked-to-main`.
- `400-line budget risk: High` (total) / per work unit.
- Human chose split delivery via chained work units; no `size:exception` was requested.
- PR order: WU-1 → WU-2 → WU-3 → WU-4 → WU-5, one PR per work unit targeting `main`.

## Workload / PR Boundary (WU-1)

- Deliverable: package metadata, type-strippable domain types/constants, and the pure stats math core (P² streaming quantile, bounded ring buffer, incremental mean, `computeTps`) with co-located tests.
- Files authored (per `wc -l`):

| File | Lines |
| --- | --- |
| package.json | 29 |
| src/types.ts | 73 |
| src/stats.ts | 201 |
| test/stats.test.ts | 195 |
| **Total** | **498** |

- **Budget note:** WU-1 totals **498 authored lines**, which exceeds the canonical **400-changed-line** per-work-unit budget by 98 lines (and the task forecast of ~330 lines).
  - These four files form one atomic, cohesive deliverable (manifest + shared types + stats core + their co-located tests). They cannot be split further without violating "tests co-located with the unit they verify" and "one clear purpose" (a package manifest and its domain types alone are not independently reviewable deliverables).
  - The budget rule forbids shrinking by deleting comments, blank lines, docs, or tests, so the count is reported honestly rather than trimmed.
  - **`size:exception` recommendation:** accept a `size:exception` for WU-1 only. No `size:exception` was pre-authorized; if the maintainer prefers strict ≤400 per PR, WU-1 would need re-slicing (which I judge not cohesively possible).
- Chain context: WU-1 is PR #1 of the stacked-to-main chain; no prior dependency. Later units (WU-2..WU-5) depend on WU-1's `src/types.ts` and `src/stats.ts`.

## Completed Tasks & Persisted Checkbox Updates

All eight WU-1 and WU-2 tasks are marked `- [x]` in `openspec/changes/live-tps-meter/tasks.md`:

- [x] 1.1 RED
- [x] 1.2 GREEN
- [x] 1.3 TRIANGULATE
- [x] 1.4 REFACTOR
- [x] 2.1 RED
- [x] 2.2 GREEN
- [x] 2.3 TRIANGULATE
- [x] 2.4 REFACTOR

## Files Changed

- `package.json` (new): name `tps-gentle-pi`, `"pi": { "extensions": "./extensions" }`, `pi-package` keyword (+ `pi`, `pi-extension` discovery keywords), optional peerDependency `@earendil-works/pi-coding-agent >=3.0.0` with `peerDependenciesMeta.optional`, `"test": "node --test \"test/*.test.ts\""`, `"type": "module"`.
- `src/types.ts` (new): `WorkerPhase`, `ExtensionRole`, `WorkerSnapshot`, `TrackedTask`, `TaskMode`, `TaskStatus`, and constants `THROTTLE_MS` (160), `STALENESS_MS` (5000), `SNAPSHOT_VERSION` (1), `WORKER_ID_MAX_LENGTH` (128), `SNAPSHOT_STRING_MAX_LENGTH` (64). No `enum`/`namespace`/parameter properties.
- `src/stats.ts` (new): pure `P2Quantile`, `RingBuffer`, `IncrementalMean`, `computeTps`, plus `P2_BOOTSTRAP_SAMPLES`, `DEFAULT_P2_QUANTILE`, `SPARKLINE_CAPACITY`.
- `test/stats.test.ts` (new): 16 tests (RED + TRIANGULATE).
- `openspec/changes/live-tps-meter/tasks.md` (checkboxes 1.1–1.4).
- `openspec/changes/live-tps-meter/apply-progress.md` (this file).

## Strict TDD — TDD Cycle Evidence

Strict TDD is active (`strict_tdd: true`, runner `npm test`), so RED → GREEN → TRIANGULATE → REFACTOR was followed.

### RED (task 1.1) — failing tests before production code

Command 1: `node --test test/stats.test.ts`

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/glacayom/localhost/tps-gentle-pi/src/stats.ts' imported from .../test/stats.test.ts
Node.js v24.20.0
✖ test/stats.test.ts ... fail 1
ℹ pass 0 / fail 1
```

Command 2: `npm test`

```
npm error code ENOENT
npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '.../package.json'
NPM_EXIT_CODE=254
```

RED evidence is the `ERR_MODULE_NOT_FOUND` for the not-yet-written `src/stats.ts` (and the absent `package.json` test script).

### GREEN (task 1.2) — production code makes tests pass

Command: `npm test`

Final GREEN output (11 tests in this cycle, after the P² correction described below):

```
✔ P2Quantile bootstraps by sorting exactly 64 samples
✔ P2Quantile p95 converges on a uniform distribution within ±2%
✔ P2Quantile p95 converges on a normal distribution within ±2%
✔ RingBuffer defaults to capacity 12
✔ RingBuffer evicts the oldest entry when a 13th entry is pushed
✔ RingBuffer toArray returns chronological (oldest-first) order
✔ IncrementalMean rejects non-finite and non-positive values
✔ IncrementalMean computes the correct arithmetic mean
✔ IncrementalMean guards division by zero
✔ computeTps uses elapsed time measured from the first output delta
✔ computeTps guards zero tokens, zero/negative elapsed, and non-finite inputs
ℹ tests 11 / pass 11 / fail 0
```

GREEN debugging evidence (recorded because it drove a design deviation):

- Initial parabolic P² yielded `p95=75.267…` (uniform OK) on normal — an 11%+ overshoot at the heavy tail.
- Root causes found and fixed during GREEN: (1) a **wrong sign in the left-move linear fallback** (`+ (q[i]-q[i-1])/gap` instead of `-`); (2) the **parabolic interpolation variant overshooting** into the heavy tail for p95 of the normal distribution (markers 2 & 3 colliding). The stable canonical linear-fallback form was adopted (see Deviations).

### TRIANGULATE (task 1.3) — algorithmic, not fixture-seeded

Command: `npm test` → 16 tests pass. Added tests:

- `P2Quantile is updated only per update() call, never on reads`
- `P2Quantile keeps a bounded memory footprint across 1000 samples`
- `RingBuffer evicts the oldest entry exactly at the 12→13 transition`
- `RingBuffer toArray returns a defensive copy`
- `IncrementalMean keeps constant storage across many turns`

Result: `ℹ tests 16 / pass 16 / fail 0`.

### REFACTOR (task 1.4) — structure cleanup, no behavior change

Command: `npm test` → 16/16 pass (unchanged output).

- Hoisted the marker quantile fractions into a single `readonly` field computed once in the constructor (previously recomputed inside `seedMarkers`/`desiredPosition`).
- Import check: every internal import uses an explicit `.ts` extension (`test/stats.test.ts → "../src/stats.ts"`; `src/stats.ts` and `src/types.ts` have no internal imports). `node:test` / `node:assert/strict` are Node builtins.

## Runtime Harness Status

- `N/A` — pure math, no runtime boundary. The stats core performs no I/O and no Pi/process interaction, so it is exercised entirely through Node's built-in test runner; there is no external runtime harness scenario to run.
- Test runner: Node 24.20.0 built-in `node --test` over `.ts` (native type stripping, no build/transpile step).

## Rollback Boundary

Delete the four WU-1 files to remove this work unit cleanly: `package.json`, `src/types.ts`, `src/stats.ts`, `test/stats.test.ts`. No other unit depends on them yet, and nothing else in the repo references them.

## Deviations from Design

1. **P² uses linear interpolation instead of parabolic prediction.** Design §6 describes "parabolic prediction with linear fallback". The parabolic variant exhibited instability at the p95 marker for heavy-tailed data (normal distribution): marker 2 and marker 3 collided and overshot ~11% (observed `p95=74.17` vs expected `66.45`). The canonical **linear** fallback is stable and converges within ±2% (observed normal p95 ≈ `66.456`, err `0.01%`). This is consistent with the spec's "bounded-memory streaming quantile sketch (P² **or equivalent**)" allowance, and the linear form is the paper's own fallback update.
2. **Convergence tests use 300,000 samples** (vs the 100k initially drafted) because the linear P² converges to within ±2% for the normal tail at ~200k+ samples; at 100k it was ~3% off. Tolerance remains ±2% as specified.

## Remaining Tasks (unchecked)

Implementation-owned tasks still `- [ ]` in `tasks.md` (WU-3 → WU-5 work units + final verification):

- 3.1 / 3.2 / 3.3 / 3.4 — IPC Channel, Atomic Publication & Eviction (`src/channel.ts`, `test/channel.test.ts`)
- 4.1 / 4.2 / 4.3 / 4.4 — Event Tracker & Task Correlation Engine (`src/tracker.ts`, `test/tracker.test.ts`)
- 5.1 / 5.2 / 5.3 / 5.4 — Extension Wiring, Vanilla Fallback & Documentation (`extensions/index.ts`, `test/extension.test.ts`, `README.md`, `LICENSE`)
- 6.1 / 6.2 / 6.3 / 6.4 / 6.5 — Final Verification & Delivery Preparation

Exact unchecked `- [ ]` lines are preserved verbatim in `openspec/changes/live-tps-meter/tasks.md` (not duplicated here to keep this artifact reviewable).

## Work Unit 2 — Pure Panel Rendering & Width Safety (tasks 2.1–2.4)

### Deliverable

Pure, exported rendering helpers in `src/render.ts` with co-located tests in `test/render.test.ts`: gauge formatter with fractional sub-blocks, 8-level sparkline formatter, color-coded rate formatter, human-readable token formatter, ANSI/control-character sanitizer, `stripAnsi`, and a width-aware layout composer (`renderMainRow` / `renderSubagentRow` / `renderPanel`) with deterministic field hiding and hard width clamping.

### Workload / PR Boundary (WU-2)

| File | Lines |
| --- | --- |
| src/render.ts | 272 |
| test/render.test.ts | 205 |
| **Total** | **477** |

- **Budget note:** WU-2 totals **477 authored lines**, which exceeds the canonical **400-changed-line** per-work-unit budget by 77 lines (task forecast was ~310).
  - The two files form one atomic, cohesive deliverable: a single RED test file (task 2.1) was authored against a single `src/render.ts` module spanning formatters, sanitization, and the layout composer; the four tasks are one RED→GREEN→TRIANGULATE→REFACTOR cycle. They cannot be split without violating "tests co-located with the unit they verify" and the task file's atomicity.
  - The budget rule forbids shrinking by deleting comments, blank lines, docs, or tests, so the count is reported honestly rather than trimmed.
  - **`size:exception` recommendation:** accept a `size:exception` for WU-2 (`+77` lines) or authorize a re-slice into "pure formatters + sanitizer" and "layout composer" (each ≈ 280 lines), which would require splitting `test/render.test.ts` into two files and thus deviating from the single-file RED task structure.
- Chain context: WU-2 is PR #2 of the stacked-to-main chain, stacked on WU-1 (`src/types.ts` supplies `WorkerPhase`/`WORKER_PHASES`). No size exception was pre-authorized for WU-2.

### Strict TDD — TDD Cycle Evidence

Strict TDD active (`strict_tdd: true`, runner `npm test`). Baseline before WU-2: 16 passing tests (WU-1).

#### RED (task 2.1) — failing tests before production code

Command: `npm test`

`test/render.test.ts` authored first; the first run failed to resolve the not-yet-written module:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/render.ts' imported from .../test/render.test.ts
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file://.../src/render.ts'
✖ test/render.test.ts ... fail 1
ℹ tests 17 / pass 16 / fail 1
```

(RED evidence: `ERR_MODULE_NOT_FOUND` for the un-written `src/render.ts`; the 16 WU-1 tests still pass.)

#### GREEN (task 2.2) — production code makes tests pass

Command: `npm test`

```text
✔ formatGauge renders an empty 16-cell gauge at 0 tok/s
✔ formatGauge renders a fractional sub-block at 15 tok/s
✔ formatGauge renders a fractional sub-block at 35 tok/s
✔ formatGauge renders a half-filled gauge at 75 tok/s
✔ formatGauge renders a full gauge at 150 tok/s and above
✔ formatGauge renders a narrow 8-cell gauge
✔ formatSparkline renders the eight ascending block levels
✔ formatSparkline keeps oldest-first chronological order
✔ rateColor applies green/yellow/red/muted thresholds
✔ formatRate wraps a one-decimal rate in the correct color code
✔ sanitizeText strips ANSI and control characters from hostile names
✔ formatTokens renders human-readable cumulative tokens
✔ renderPanel stays width-safe at 60/80/120/160 columns
✔ renderPanel hides fields deterministically at standard and narrow widths
✔ renderPanel uses ├─ for intermediate rows and └─ for the last row
ℹ tests 31 / pass 31 / fail 0
```

#### TRIANGULATE (task 2.3) — reproducibility, determinism, variants

Command: `npm test` → 35/35 pass. Added tests:

- `renderPanel is reproducible with an injected mock theme`
- `layout is stable across repeated renders at each breakpoint`
- `renderMainRow renders the tool-phase variant within width`
- `honest fallback labels render within width without invented identity`

Result: `ℹ tests 35 / pass 35 / fail 0`.

#### REFACTOR (task 2.4) — consolidate duplication, no behavior change

Command: `npm test` → 35/35 pass (unchanged output).

- Extracted the duplicated `width < 80 ? NARROW_GAUGE_CELLS : GAUGE_CELLS` resolution from `renderMainRow`/`renderSubagentRow` into a single `gaugeCellsForWidth(width)` helper.
- All helpers remain exported and pure (no ambient mutable state; every internal import uses explicit `.ts` extensions).

### Runtime Harness Status

`N/A` — pure rendering, no runtime boundary. `src/render.ts` performs no I/O and no Pi/process interaction; it is exercised entirely through Node 24 built-in `node --test` over `.ts` (native type stripping, no build/transpile step).

### Rollback Boundary

Delete `src/render.ts` and `test/render.test.ts` to remove WU-2 cleanly. WU-1 (`src/types.ts`, `src/stats.ts`) is intact and unaffected; no later unit imports render yet.

### Deviations from Design

1. **Gauge normalization ceiling `GAUGE_MAX_TPS = 150`.** Design §5 specifies the 16-char gauge with fractional sub-blocks but leaves the rate→fill scale unspecified. `150` was chosen so the task-mandated test rates 0/15/35/75/150 tok/s map cleanly from empty to full (150 → full). The design's example gauges are illustrative, not exact.
2. **Sparkline normalization to the history's own maximum.** Design §5 specifies 8-level blocks and a 12-turn bounded history but not the scale. Levels normalize against the max value in the presented history (0 → `▁`, max → `█`) so relative turn shape is preserved; an empty/all-zero history renders all `▁`.

## Skills Loaded

- `work-unit-commits` (`/home/glacayom/.config/opencode/skills/work-unit-commits/SKILL.md`)
- `chained-pr` (`/home/glacayom/.config/opencode/skills/chained-pr/SKILL.md`)

`skill_resolution`: paths-injected (parent-provided exact paths read before work).
