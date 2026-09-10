# Panel Rendering Specification

## Purpose

Render the main-agent meter and active subagent rows as a compact, responsive, width-safe panel above the Pi editor, using deterministic pure helpers so layout is verifiable without a live terminal.

## Requirements

### Requirement: Above-Editor Panel Placement and Lifecycle

The extension MUST render the meter as a widget placed above the editor (`aboveEditor` placement) in TUI sessions, and MUST remove the widget on `session_shutdown`.

#### Scenario: Widget appears above the editor

- GIVEN an active TUI session
- WHEN the first refresh occurs after `session_start`
- THEN the meter panel is visible above the editor

#### Scenario: Widget removed on shutdown

- GIVEN a displayed panel
- WHEN the session shuts down
- THEN the widget is cleared and nothing remains rendered

### Requirement: Bounded Refresh Interval

The panel MUST refresh on a bounded interval (canonical default: every 200 ms) rather than per event or per token delta. Session statistics MUST be updated by message/tool events, not recomputed on render ticks; idle refreshes with no new events MUST NOT change sparkline, mean, or p95.

#### Scenario: Idle refresh does not perturb statistics

- GIVEN a session whose statistics were finalized after a completed turn
- WHEN several render ticks pass with no new messages
- THEN the rendered panel repeats the same statistics
- AND the underlying sparkline, mean, and p95 are unchanged

### Requirement: Responsive, Width-Safe Layout

Rendering MUST adapt to the terminal's available width and MUST remain width-safe at narrow (approximately 60 columns), standard, and wide widths: no rendered line MUST exceed the available width. Truncation and column hiding at narrow widths SHOULD be deterministic and documented rather than incidental.

#### Scenario: Narrow terminal clamps every line

- GIVEN a terminal 60 columns wide
- WHEN the panel renders a main-agent row and worker rows
- THEN every emitted line fits within 60 columns
- AND layout decisions are stable across repeated renders

#### Scenario: Wide terminal uses available space without overflow

- GIVEN a terminal 160 columns wide
- WHEN the panel renders
- THEN every emitted line fits within the available width
- AND fields are not padded to an incorrect fixed width that hides live data

### Requirement: Gauge and Sparkline Visualization

The main-agent panel MUST include a live gauge representing current TPS and a sparkline of recent completed turns, and SHOULD visually distinguish rate levels so degradation is recognizable at a glance.

#### Scenario: Gauge reflects current rate level

- GIVEN an active streaming response
- WHEN the live TPS changes level
- THEN the gauge fill and rate presentation change accordingly

#### Scenario: Sparkline shows recent turn history

- GIVEN several completed turns
- WHEN the panel renders
- THEN the sparkline displays the most recent completed turns in order, oldest first

### Requirement: Pure, Deterministic, Testable Rendering Helpers

Rendering logic SHOULD be implemented as pure, exported helpers producing string-array content, so layout, truncation, and formatting are unit-testable without a terminal harness. Layout output MUST depend only on explicit inputs (statistics, rows, theme, available width) and MUST NOT read ambient mutable global state.

#### Scenario: Helper output is reproducible in tests

- GIVEN fixed statistics, fixed worker rows, and a fixed width
- WHEN the rendering helpers are invoked twice with a mock theme
- THEN both invocations return identical string arrays

#### Scenario: Text content is safe for terminal display

- GIVEN agent labels or tool names containing control or formatting characters
- WHEN rows render
- THEN emitted lines contain no characters that corrupt terminal rendering or exceed the allocated column span

### Requirement: TUI-Only Rendering

Rendering MUST happen only in the parent TUI role. Worker-role instances running in RPC mode MUST perform no rendering and make no widget calls (enforced jointly with the `subagent-rows` child-publication requirement).

#### Scenario: RPC child renders nothing

- GIVEN the extension in worker role inside a `pi --mode rpc` process
- WHEN any event fires
- THEN no panel content is produced and no `ctx.ui` rendering call occurs
