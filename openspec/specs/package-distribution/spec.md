# Package Distribution Specification

## Purpose

Ship `tps-gentle-pi` as a public, zero-build TypeScript Pi package that loads directly in vanilla Pi, is discoverable through pi.dev/packages, runs cross-platform with the Node built-in test runner, and collects no telemetry.

## Requirements

### Requirement: No Build Step

The package MUST ship TypeScript sources that Pi loads directly, and MUST NOT introduce any compilation, bundling, transpilation, or generated runtime artifacts into the runtime workflow.

#### Scenario: Fresh checkout loads directly

- GIVEN the package sources with no build step executed
- WHEN Pi loads the extension
- THEN the extension activates without requiring any prior `tsc`, bundler, or code-generation run
- AND no generated runtime artifacts exist in the package

### Requirement: Tests Run on the Node Built-in Runner

Package tests MUST execute via `npm test` using Node's built-in `node --test` runner over TypeScript test files (native type stripping), with no external test framework and no pre-test build step.

#### Scenario: npm test runs TypeScript tests natively

- GIVEN a fresh install of the package's dev environment on Node 24
- WHEN `npm test` is executed
- THEN the TypeScript test suite runs through `node --test`
- AND the suite passes without compiling the sources first

#### Scenario: Cross-platform test parity

- GIVEN the package checked out on Linux, macOS, and Windows
- WHEN `npm test` runs on each platform
- THEN the suite passes identically on all three platforms
- AND no test path depends on shell-specific commands

### Requirement: Vanilla Pi Extension API Surface Only

The extension MUST consume only the public vanilla Pi `ExtensionAPI`/`ExtensionContext` surface (`pi.on`, `ctx.mode`, `ctx.hasUI`, `ctx.ui`), and MUST NOT import, require, or depend at runtime on gentle-pi. The optional peer dependency, if declared, MUST remain optional.

#### Scenario: Loads on Pi without gentle-pi

- GIVEN a Pi installation where gentle-pi is absent
- WHEN the extension is loaded
- THEN loading succeeds
- AND no gentle-pi module or global is referenced

### Requirement: Public Package Metadata and Discovery

The published npm package MUST be named `tps-gentle-pi`, MUST include a `pi` manifest entry targeting `./extensions`, MUST carry the `pi-package` and extension-discovery keywords required by pi.dev/packages, and SHOULD declare an optional peer dependency on `@earendil-works/pi-coding-agent`.

#### Scenario: Package is discoverable via pi.dev metadata

- GIVEN the `package.json` of the published package
- WHEN discovery metadata is inspected
- THEN the name is `tps-gentle-pi`
- AND the `pi` manifest targets `./extensions`
- AND the `pi-package` keyword is present

#### Scenario: Package documents install and fallback behavior

- GIVEN the published package
- WHEN its documentation is read
- THEN it documents package-based installation for child visibility, vanilla Pi behavior, the temporary-file lifecycle, and supported platforms (Linux, macOS, Windows)

### Requirement: Session-Scoped Data with No Telemetry

The extension MUST keep all metrics session-scoped: it MUST NOT persist throughput history, MUST NOT upload telemetry or analytics, and MUST NOT run a network service or daemon. Temporary channel state is the only sanctioned on-disk artifact and is governed by the `ipc-channel` specification.

#### Scenario: No network or durable storage usage

- GIVEN a running session on any supported platform
- WHEN metrics are computed, published, aggregated, or rendered
- THEN no network connection is opened
- AND no metric data outlives the session except nothing at all

#### Scenario: Removal restores a clean state

- GIVEN a user removes the package and restarts Pi
- WHEN the system restarts
- THEN no residual files, configuration migrations, or state from the extension remain
