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
