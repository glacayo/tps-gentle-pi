# Main-Agent Meter Specification

## Purpose

Provide live tokens-per-second (TPS) visibility for the Pi main agent in a compact panel above the editor, with bounded session statistics (12-turn sparkline, incremental mean, streaming p95). This capability is mandatory on every Pi session, with or without gentle-pi installed.

## Requirements

### Requirement: Live Streaming TPS Display

While an assistant response streams, the extension MUST display a live TPS rate and a gauge for the main agent. The live rate MUST be computed from observed output deltas and elapsed time since the first output delta. The extension MUST prefer provider-reported output usage when available; when usage is not yet reported, it MAY use a documented character-based estimate so the meter continues to move. The extension MUST NOT treat the streaming estimate as authoritative.

#### Scenario: Streaming updates the live rate

- GIVEN the extension is active in a TUI session
- WHEN the main agent emits assistant output deltas during a response
- THEN the panel shows a TPS value and gauge that change while output streams
- AND the elapsed-time base starts at the first observed output delta, not the message start

#### Scenario: Estimate fallback when provider defers usage

- GIVEN a provider that does not report output usage during streaming
- WHEN assistant output deltas arrive
- THEN the live TPS is computed from a documented character-based estimate
- AND the panel remains animated rather than stuck or blank

### Requirement: Authoritative Turn Finalization

When an assistant message completes, the extension MUST finalize the turn using the provider-reported final output usage when available, replacing any streaming estimate, and MUST record the finalized per-turn TPS into the session statistics. Per-message counters MUST be reset when a new assistant message begins.

#### Scenario: Final usage replaces estimate

- GIVEN a turn whose streaming rate used the character-based estimate
- WHEN the message completes with provider-reported output usage
- THEN the recorded per-turn TPS reflects the authoritative usage and measured elapsed time
- AND the streaming estimate is discarded for that turn

#### Scenario: New message resets counters

- GIVEN a completed previous assistant message
- WHEN a new assistant message starts
- THEN per-message token, character, and timing counters restart from zero
- AND session statistics retain the previous completed turn

### Requirement: Bounded Session Sparkline

The extension MUST maintain a sparkline of at most the 12 most recent completed main-agent turns. When a 13th turn completes, the oldest entry MUST be evicted. Sparkline storage MUST be bounded regardless of session length.

#### Scenario: Oldest entry evicted at capacity

- GIVEN a sparkline already holding 12 completed turns
- WHEN another assistant turn completes
- THEN the sparkline holds exactly 12 entries
- AND the oldest turn's value is no longer present

### Requirement: Incremental Session Mean

The extension MUST display a session mean TPS (`μ`) computed incrementally over completed turns without retaining individual turn values beyond the bounded sparkline.

#### Scenario: Mean updates incrementally

- GIVEN two completed turns with recorded TPS values
- WHEN a third turn completes
- THEN the displayed mean equals the arithmetic mean of all three completed turns
- AND storage used for the mean is constant with respect to turn count

### Requirement: Streaming p95 Quantile

The extension MUST maintain a p95 estimate of per-turn main-agent TPS using a bounded-memory streaming quantile sketch (P² or equivalent), updated when messages complete, not on render ticks.

#### Scenario: p95 updates only on message completion

- GIVEN an active session with a p95 sketch initialized
- WHEN render ticks occur without a completed message
- THEN the p95 value does not change
- WHEN a message completes
- THEN the p95 sketch is updated with the finalized per-turn TPS

#### Scenario: Bounded memory

- GIVEN a session with 1000 completed turns
- WHEN the p95 sketch is inspected
- THEN its memory footprint is bounded and independent of the number of turns

### Requirement: Phase and Tool Indication

The panel MUST indicate the main agent's current phase (waiting, streaming, or tool) and the active tool name while a tool executes. When the tool finishes, the phase MUST return to the appropriate waiting or streaming state and the active tool indicator MUST clear.

#### Scenario: Tool execution updates phase

- GIVEN the main agent is in a session
- WHEN a tool execution starts
- THEN the panel shows phase `tool` and the tool's name
- WHEN the tool execution ends
- THEN the active tool indicator is cleared and the phase is no longer `tool`

### Requirement: Model and Thinking-Level Label Refresh

The panel MUST refresh the displayed model label on `model_select` and any displayed reasoning-effort metadata on `thinking_level_select`, without waiting for another assistant message.

#### Scenario: Model change reflects immediately

- GIVEN the panel displays model `m1`
- WHEN the user selects model `m2`
- THEN the panel displays `m2` before the next assistant message starts

### Requirement: Session-Scoped Lifecycle with No Persistence

Main-agent tracking MUST initialize on `session_start` in TUI sessions, and `session_shutdown` MUST stop timers, remove the widget, and release session state. No main-agent statistics MUST be retained beyond the session or written to durable storage (in-memory only; temp files, if any, are covered by the `ipc-channel` specification).

#### Scenario: Shutdown releases all state

- GIVEN an active session with computed statistics
- WHEN the session shuts down
- THEN the widget is removed, the refresh timer is stopped, and no statistics survive in memory or on disk

#### Scenario: Restart starts fresh

- GIVEN a previous session ended normally
- WHEN a new TUI session starts
- THEN sparkline, mean, and p95 start empty
