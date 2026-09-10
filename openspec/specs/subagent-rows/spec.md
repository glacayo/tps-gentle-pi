# Subagent Rows Specification

## Purpose

Show exactly one live row per active gentle-pi subagent, combining metrics calculated inside the isolated RPC worker with identity/model metadata observed in the parent, while never guessing an identity and never breaking vanilla Pi sessions.

## Requirements

### Requirement: Role Detection at Session Start

On `session_start`, the extension MUST select either parent TUI behavior or child RPC worker behavior based on the Pi context mode and the gentle-pi child marker, and MUST start only the resources appropriate to that role.

#### Scenario: TUI session selects parent role

- GIVEN a Pi session with `ctx.hasUI` in TUI mode and no gentle-pi child marker
- WHEN `session_start` fires
- THEN the extension initializes parent aggregation, the refresh timer, and the above-editor panel

#### Scenario: gentle-pi RPC child selects worker role

- GIVEN a `pi --mode rpc` process with the gentle-pi child marker set and the channel location inherited
- WHEN `session_start` fires
- THEN the extension initializes child-side metric tracking and publication
- AND starts no TUI widgets, intervals for rendering, or parent aggregation

### Requirement: Child-Side Metric Publication with UI Suppression

A worker-role extension instance MUST compute its own live TPS from local Pi events (`message_start`, `message_update`, `message_end`, tool-execution events, `agent_end`) and publish small current-state snapshots to the inherited channel location. It MUST NOT call TUI widget or notification APIs, so RPC protocol output stays clean.

#### Scenario: Worker publishes current-state snapshots

- GIVEN the extension detected worker role with an inherited channel location
- WHEN the worker's assistant output streams and tools execute
- THEN snapshots describing the worker's current state (model, phase, active tool, live TPS, cumulative tokens, timestamps) appear in the session directory

#### Scenario: Worker never touches TUI APIs

- GIVEN the extension detected worker role
- WHEN any Pi event fires in the worker session
- THEN no `ctx.ui.setWidget`, notification, or other TUI-only call is made
- AND the RPC stdout stream contains no widget or UI output

### Requirement: One Row Per Active Worker

For each active gentle-pi worker that publishes valid snapshots, the parent panel MUST render exactly one row showing the worker's identity when determinable, model, current state or active tool, gauge, and live TPS. One worker MUST NOT produce zero or multiple rows while active.

#### Scenario: Two workers produce two rows

- GIVEN two active gentle-pi workers publishing valid snapshots
- WHEN the parent panel refreshes
- THEN exactly two subagent rows are shown, one per worker, each with its own live TPS

### Requirement: Deterministic, Never-Guessed Worker Identity

The parent MUST derive a worker's gentle-pi identity only from deterministic correlation evidence: observed Gentle Agents tool calls (`subagent_run`, `subagent_continue`, `subagent_cancel`, `subagent_send_message`) and their public `tool_result` `details.gentleAgents` metadata. When correlation evidence is missing or ambiguous, the parent MUST omit identity fields rather than guess, and MUST still render the row's live metrics. Correlation MUST remain correct for concurrent launches, continuation, cancellation, and background-task completion.

#### Scenario: Correlated identity shown

- GIVEN a `subagent_run` tool call for agent `scout` and its tool result carrying `details.gentleAgents` metadata
- WHEN the corresponding worker snapshot is aggregated
- THEN that worker's row displays agent `scout` and the observable model

#### Scenario: Ambiguous concurrent launch omits identity

- GIVEN two concurrent `subagent_run` launches whose snapshots cannot be deterministically matched to task metadata
- WHEN the parent aggregates worker snapshots
- THEN both rows render their live metrics with identity fields omitted
- AND no invented agent name is assigned to either row

#### Scenario: Continuation, cancel, and background flows stay consistent

- GIVEN an existing correlated task
- WHEN `subagent_continue`, `subagent_cancel`, or background-task completion events occur
- THEN the affected row keeps or clears identity only where deterministic evidence supports it
- AND finished tasks cease to appear as active rows

### Requirement: Completed, Dead, and Stale Workers Are Removed

Rows for completed, cancelled, dead, or stale workers MUST be removed from the panel rather than retained as history.

#### Scenario: Completed worker row disappears

- GIVEN a worker row displayed while its task runs
- WHEN the worker completes and its terminal state is observed
- THEN the row is removed from the panel
- AND no historical row remains in the widget

#### Scenario: Dead or stale worker row disappears

- GIVEN a worker whose process died without a graceful unpublish
- WHEN the parent detects the worker is dead or its snapshot is stale
- THEN the row is removed on the next aggregation

### Requirement: Vanilla Pi Operation Without gentle-pi

On vanilla Pi (gentle-pi not installed, no Gentle Agents tools observed, or children that never load the extension), the extension MUST NOT render subagent rows and the main-agent panel MUST remain fully functional.

#### Scenario: Session with no gentle-pi installed

- GIVEN a vanilla Pi installation without gentle-pi
- WHEN assistant responses stream and complete
- THEN the main-agent live TPS, sparkline, mean, and p95 work exactly as specified
- AND no subagent rows are shown and no errors are raised

#### Scenario: One-off parent extension flag does not fake rows

- GIVEN the extension loaded only via a one-off parent `pi -e` flag that gentle-pi does not propagate to children
- WHEN gentle-pi workers run without loading the extension
- THEN no subagent row appears for those workers
- AND the main-agent panel continues to function

### Requirement: Subagent Collection Failures Degrade Safely

Failure of optional subagent collection (no channel, publication failure, aggregation failure, corrupted snapshots) MUST NOT crash or block a Pi session and MUST NOT disable the main-agent meter.

#### Scenario: Aggregation failure keeps main meter alive

- GIVEN an active subagent aggregation that encounters a failure
- WHEN the failure occurs during a refresh
- THEN the main-agent panel continues to update correctly
- AND no exception escapes to the Pi session

### Requirement: Consumed-Surfaces Boundary

The extension MUST NOT import, patch, mutate, or require gentle-pi internals (`AgentRunner`, the private task store, transcripts, or the gentle-pi widget). All subagent metadata MUST come from public Pi events, and all subagent metrics MUST come from the child-side publisher.

#### Scenario: gentle-pi internals absent or private

- GIVEN a gentle-pi release whose task store remains an unexported closure
- WHEN a worker runs
- THEN row metrics and identity rely solely on Pi events and published snapshots
- AND the extension raises no error from attempting to access gentle-pi internals
