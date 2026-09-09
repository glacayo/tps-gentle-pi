# Pre-Proposal Decision Gate: Live TPS Meter

Status: ready-for-proposal

## Confirmed product intent

- Primary runtime: gentle-pi on Pi Agent.
- MVP: live TPS for the main agent and one row per active gentle-pi subagent.
- Compatibility: main-agent metrics continue to work on vanilla Pi; subagent rows disappear gracefully.
- Distribution: public npm package discoverable through pi.dev/packages.
- Process: SDD/OpenSpec with automatic phase routing and a 400-line review budget.

## Evidence ready for proposal

- `openspec/changes/live-tps-meter/explore.md`
- Pi package and extension documentation inspected.
- Locally installed gentle-pi runtime inspected by the exploration phase.

## Research lane

Formal external SDD research is unselected. Existing code and documentation evidence is sufficient for the MVP proposal.

## Confirmed decisions

1. The public npm package name is `tps-gentle-pi`.
2. Private, throttled, ephemeral temporary files are accepted for accurate cross-process subagent TPS, with restrictive permissions and automatic cleanup.
3. The MVP MUST support Linux, macOS, and Windows through cross-platform Node.js APIs.

The proposal may proceed.
