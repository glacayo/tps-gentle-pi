# IPC Channel Specification

## Purpose

Transport current-state worker snapshots from isolated gentle-pi RPC children to the parent TUI process through a private, throttled, ephemeral, schema-validated temporary-file channel. The channel is a bounded, intentional exception to the project's in-memory preference: it exists only for cross-process visibility, holds no durable state, and is cleaned automatically.

## Requirements

### Requirement: Private, Unpredictable, Package-Owned Session Directory

The parent MUST create exactly one unique and unpredictable session directory under `os.tmpdir()` per session, expose its location to descendants only via environment inheritance, and MUST NOT write any data outside that package-owned directory. On POSIX systems the directory MUST be created with mode `0700` and snapshot files with mode `0600`; on Windows the channel MUST use the current user's temporary directory and inherited ACLs. No metric file MUST be treated as durable state.

#### Scenario: POSIX permissions are restrictive

- GIVEN a parent session on Linux or macOS
- WHEN the session directory and a worker snapshot are created
- THEN the directory is not readable, writable, or searchable by other users
- AND snapshot files are readable and writable only by the owner

#### Scenario: Windows relies on user ACLs

- GIVEN a parent session on Windows
- WHEN the session directory is created
- THEN it resides under the current user's temporary directory
- AND no attempt is made to apply POSIX permission modes

#### Scenario: Nothing is written outside the session directory

- GIVEN an active session
- WHEN any publication, aggregation, or cleanup operation runs
- THEN the only filesystem writes target paths inside the package-owned session directory

### Requirement: Throttled Publication

Child workers MUST publish at most one snapshot per 150–200 ms during streaming, plus immediate updates for significant state transitions (tool start/end, turn completion, worker completion). Rapid token deltas MUST NOT each produce a write.

#### Scenario: Rapid deltas are throttled

- GIVEN a worker streaming many output deltas per second
- WHEN snapshots are written
- THEN the write rate never exceeds the configured throttle interval of 150–200 ms
- AND significant state transitions are published without waiting for the throttle window

### Requirement: Snapshot Content Constraints

Snapshots MUST be small current-state packets limited to identity, model, thinking level, phase, active tool name, TPS, token counters, PID, and timestamps. Snapshots MUST NOT contain prompt text, task text, or generated output text.

#### Scenario: Packet contains no user or generated content

- GIVEN any produced snapshot file
- WHEN its fields are inspected
- THEN it contains only metric and state fields
- AND no prompt, task, or generated text is present anywhere in the packet

### Requirement: Schema Validation Before Aggregation

The parent MUST schema-validate every snapshot before aggregating it. Malformed, partially written, or unreadable snapshots MUST be skipped without raising an error and MUST NOT affect main-agent rendering or block the refresh loop.

#### Scenario: Truncated snapshot is skipped

- GIVEN a snapshot file containing truncated or invalid JSON
- WHEN the parent aggregates worker snapshots
- THEN that snapshot is ignored
- AND valid rows and the main-agent panel render normally

#### Scenario: Wrongly shaped snapshot is rejected

- GIVEN a snapshot file with valid JSON but fields violating the snapshot schema
- WHEN the parent validates it
- THEN it is rejected
- AND no subagent row is created from its contents

### Requirement: Partial-Read-Safe Publication

Publication MUST be partial-read-safe: a reader MUST never observe a torn write as a valid snapshot. Write-replace or equivalent atomicity MUST be used so that reads see either a complete valid snapshot or nothing usable.

#### Scenario: Concurrent read during write

- GIVEN a worker replacing its snapshot
- WHEN the parent reads at the same instant
- THEN the parent sees either the complete previous snapshot or the complete new snapshot
- AND never a half-written payload presented as valid data

### Requirement: Stale and Dead Worker Eviction

The parent MUST evict snapshots that are stale (older than a bounded, documented staleness window) or whose worker process is no longer alive, using PID-liveness checks where the platform supports them and timestamp expiry as the cross-platform fallback.

#### Scenario: Killed worker's snapshot is purged

- GIVEN a worker process terminated abruptly without unlinking its snapshot
- WHEN the parent detects the process is dead (or the snapshot exceeds the staleness window)
- THEN the snapshot file is removed
- AND no row is rendered for that worker

#### Scenario: Timestamp expiry works without PID support

- GIVEN a platform or environment where PID liveness cannot be established
- WHEN a snapshot's timestamp exceeds the staleness window
- THEN the snapshot is evicted regardless of PID checks

### Requirement: Automatic Cleanup with Ownership Boundaries

Children MUST unlink their own snapshot on normal shutdown. On `session_shutdown`, the parent MUST stop timers, remove the widget, and recursively remove only its own session directory; it MUST NOT remove anything outside that directory or directories owned by other sessions. A scavenging pass MAY remove only stale directories that positively match the package's ownership marker and schema, and MUST leave foreign or unrecognized directories untouched.

#### Scenario: Normal shutdown removes session state

- GIVEN an active session with worker snapshots
- WHEN the parent session shuts down normally
- THEN only the package-owned session directory and its contents are removed
- AND the rest of the temporary directory is untouched

#### Scenario: Scavenger skips foreign directories

- GIVEN stale temporary directories not created by this package (or lacking the package's ownership marker)
- WHEN the scavenging pass runs
- THEN those directories are preserved
- AND only verified package-owned stale directories are removed

### Requirement: Channel Failure Degrades Safely

If directory creation, publication, reading, validation, or cleanup fails (for example due to permissions or a removed directory), subagent rows MUST degrade to absent while main-agent tracking remains available, and the failure MUST NOT crash, hang, or block the Pi session.

#### Scenario: Session directory creation fails

- GIVEN a temporary location where the session directory cannot be created
- WHEN the parent session starts
- THEN the main-agent panel initializes and updates normally
- AND no subagent rows appear and no error escapes to the user session

### Requirement: Cross-Platform Node APIs Only

All channel operations MUST use cross-platform Node.js APIs (`fs`, `os`, `path`, process, and timer APIs) and MUST NOT depend on shell-specific commands or utilities. Identical behavior MUST hold on Linux, macOS, and Windows, with POSIX permission/mode handling skipped on Windows.

#### Scenario: Channel lifecycle on each supported OS

- GIVEN the test matrix on Linux, macOS, and Windows
- WHEN directory creation, publication, aggregation, eviction, and cleanup run
- THEN each operation succeeds with identical observable behavior on all three platforms
- AND no code path shells out to platform-specific commands
