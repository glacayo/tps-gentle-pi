# Project: tps-gentle-pi

## Purpose

A public npm package for the [Pi coding agent](https://github.com/earendilworks/pi-coding-agent):
a live throughput (tokens-per-second, TPS) meter that renders a small panel above the editor,
inspired by [omp-throughput](https://www.npmjs.com/package/omp-throughput) but designed
primarily for **gentle-pi**. The MVP MUST show live TPS for:

1. The main agent (gauge, session sparkline, mean μ, p95), and
2. Gentle-pi subagents (one row per running Gentle Agents worker).

## Why gentle-pi is different from omp

omp-throughput works because omp task subagents run **in-process**, so a shared
`globalThis[Symbol.for("omp.throughput.registry.v1")]` registry is visible to every worker.
Gentle-pi subagents do not work that way:

- `gentle-pi`'s Gentle Agents (extensions/gentle-agents.ts, lib/agents-runner.ts) launches
  each subagent as an **isolated `pi --mode rpc` child OS process** (`spawn` of the pi CLI
  with `--mode rpc --session-dir …`).
- Therefore an in-process registry cannot carry subagent metrics. The package needs a
  cross-process observation strategy. Candidate approaches (to be decided in design):
  - Child-side publisher: the extension also loads inside each spawned `pi --mode rpc`
    child and publishes metrics over a lightweight channel (temp file / IPC), with the
    main-process extension aggregating.
  - Parent-side observer: subscribe to Gentle Agents' task store / transcript updates from
    the main process and derive per-subagent TPS.

On **vanilla pi** (no gentle-pi installed), the main-agent panel must still work fully and
subagent rows must simply not appear — nothing may break, mirroring omp-throughput's
compatibility stance.

## Product principles (inherited from omp-throughput)

- Zero configuration — drop it in and it runs.
- Zero (or minimal, justified) disk I/O; state is discarded on exit.
- O(1) per-frame stats: incremental mean and a P² streaming quantile sketch for p95,
  updated per completed message, not per render tick.
- No build step: pi loads the TypeScript extension directly.

## Distribution

- Public npm package; pi.dev package gallery listing via the `pi-package` keyword.
- `package.json` needs: `pi` manifest pointing at `./extensions`, optional peerDependency
  `@earendil-works/pi-coding-agent >= 3.0.0` (never bundled), keywords
  `pi-package`, `pi-extension`, `gentle-pi`, `tps`, `throughput`, `subagents`.
- Tentative package name: `tps-gentle-pi` (verified available on npm at init time;
  final naming is a proposal-phase decision).

## Technical baseline (verified at init)

- Node v24.20.0, npm 11.12.1.
- Node's built-in `node --test` runner executes `.ts` test files natively
  (type stripping verified) — no test framework or build step required.
- Reference implementation studied: omp-throughput@1.0.1 (single ~700-line
  `extensions/throughput.ts`, MIT).

## Testing strategy

- `npm test` → `node --test` over the package's TypeScript test files.
- Mock the pi `ExtensionAPI`/`ExtensionContext` surface (message_start /
  message_update / message_end, tool events, session lifecycle) for event-driven tests.
- Keep stats math (P² sketch, ring buffer), aggregation, and row/header rendering in
  pure exported functions so they are unit-testable without a live pi session.

## Workspace facts

- The workspace is **not yet a Git repository** (verified: `git status` fails).
  No Git initialization was performed during this phase; delivery phases that
  require branches/PRs will need the repository initialized first.
- Only `.gitignore`, `.atl/skill-registry.md`, `.pi/gentle-ai/sdd-preflight.json`,
  and `openspec/` exist at init time. No product code has been written.
- All technical artifacts are in English.
