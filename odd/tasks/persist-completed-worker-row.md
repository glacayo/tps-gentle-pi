# Persist completed worker row

## Goal

Keep a completed gentle-pi worker visible for the configured 10-second persistence window instead of unlinking its snapshot immediately on `agent_end`.

## Tasks

- [x] Add an end-to-end regression test proving `agent_end` publishes a `complete` snapshot with `completedAt` and keeps it readable inside the persistence window.
- [x] Implement the smallest worker shutdown/channel change that preserves the completed snapshot without weakening stale/dead cleanup.
- [x] Run focused and full verification, then record evidence.

## Review follow-up

- [x] Correct the readability mismatch around preserved retry timers.
- [x] Make terminal snapshot retry deterministic without leaving a stale live snapshot or an unowned pending timer.
- [x] Re-run focused/full verification and native four-lens review.
- [ ] Commit, push, merge through issue #1, and release patch version 0.2.1 after approval.

## Constraints

- Preserve RPC stdout/UI isolation in worker processes.
- Keep crash, stale PID, and parent cleanup behavior unchanged.
- Restore `npm:tps-gentle-pi@0.2.0` after every local smoke test until the new release is published.
- Publish only through the existing GitHub Actions workflow.

## Evidence

- Review workload: user expanded final `size:exception` to 786 lines after adding no-throw wait-hook regressions, preserving all concurrency/Windows coverage in one PR.
- RED: `node --test test/extension.test.ts` failed 2/17 because `agent_end` unlinked the terminal snapshot.
- Focused GREEN: 139/139 tests passed across extension, channel, guard, correlation, and render suites.
- Full GREEN: `npm test` passed 232/232 tests.
- Independent verification repeated 139/139 focused and 232/232 full tests; `git diff --check` passed.
- LSP diagnostics: zero errors across all four changed source/test files.
- Final focused GREEN: 147/147 tests passed across extension, channel, guard, correlation, and render suites.
- Final full GREEN: `npm test` passed 240/240 tests; `git diff --check` passed.
- Final independent verification confirmed the same 147/147 and 240/240 results with no code findings.
- Native four-lens review approved and acknowledged for candidate `sha256:a9945f5d54e8cf0c3d61dfe5fe56635cd71dd12d10f5403989e19d93c581ac10` under lineage `review-88d05dd0f811a44e`.
- Non-blocking follow-ups: deduplicate test fixtures and consider observability for terminal persistence failure.
- Implementation commit: `da3da78` (`fix: persist completed worker rows`).
- Release version prepared: `0.2.1`; delivery pending.
