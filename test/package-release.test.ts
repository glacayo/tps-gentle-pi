// Release readiness tests: public npm metadata, the exact tarball surface, the
// no-dependency package verifier, and .gitignore hygiene. These tests read the
// repository files directly and never install dependencies; Node 24 executes
// them via native type stripping.
//
// Workflow (CI/publish) contract tests live in test/release-workflows.test.ts.
//
// Contracts under test:
//   - package.json public release metadata (author, repository/homepage/bugs,
//     engines, publishConfig, corrected optional Pi peer dependency, scripts).
//   - .gitignore additions while preserving .atl/.
//   - scripts/verify-package-files.mjs existence, wiring, and anti-recursion
//     (never a prepack hook that re-runs `npm pack`).
//   - the direct TypeScript/no-build 13-file tarball surface.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(p: string): string {
  return fs.readFileSync(path.join(root, p), "utf8");
}

const pkg = JSON.parse(read("package.json")) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// package.json public release metadata contract
// ---------------------------------------------------------------------------

test("package.json carries public release metadata for the GeoClawAgent repo", () => {
  assert.equal(pkg.name, "tps-gentle-pi");
  assert.equal(pkg.version, "0.1.0");
  assert.equal(pkg.author, "GeoClawAgent");
  assert.equal(
    pkg.repository && (pkg.repository as { url?: string }).url,
    "git+https://github.com/GeoClawAgent/tps-gentle-pi.git",
  );
  assert.equal(
    pkg.homepage,
    "https://github.com/GeoClawAgent/tps-gentle-pi#readme",
  );
  assert.equal(
    pkg.bugs && (pkg.bugs as { url?: string }).url,
    "https://github.com/GeoClawAgent/tps-gentle-pi/issues",
  );

  const engines = (pkg.engines ?? {}) as Record<string, string>;
  assert.equal(engines.node, ">=24.0.0");

  const publishConfig = (pkg.publishConfig ?? {}) as Record<string, string>;
  assert.equal(publishConfig.access, "public");
});

test("package.json uses the corrected `*` optional Pi peer dependency", () => {
  const peers = (pkg.peerDependencies ?? {}) as Record<string, string>;
  const meta = (pkg.peerDependenciesMeta ?? {}) as Record<
    string,
    Record<string, boolean>
  >;

  assert.equal(peers["@earendil-works/pi-coding-agent"], "*");
  assert.equal(
    meta["@earendil-works/pi-coding-agent"]?.optional,
    true,
    "peer dependency remains optional",
  );
});

test("package.json keeps the direct TypeScript/no-build 13-file surface", () => {
  const files = pkg.files as string[];
  assert.ok(Array.isArray(files), "files allowlist is present");
  for (const entry of ["extensions/", "src/", "README.md", "LICENSE"]) {
    assert.ok(files.includes(entry), `files includes ${entry}`);
  }
  // The verifier, tests, workflows, and runtime state must never leak into the
  // published tarball.
  for (const banned of ["test", "scripts", ".github", ".pi", ".codegraph"]) {
    assert.ok(
      !files.some((f) => f.includes(banned)),
      `files excludes ${banned}`,
    );
  }
});

test("package.json wires verify:package and release:check without a prepack hook", () => {
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;

  assert.equal(
    scripts["verify:package"],
    "node scripts/verify-package-files.mjs",
  );

  const releaseCheck = scripts["release:check"] ?? "";
  assert.ok(
    releaseCheck.includes("npm test") &&
      releaseCheck.includes("npm run verify:package"),
    `release:check runs tests and package verification (got: ${releaseCheck})`,
  );
  assert.ok(
    !releaseCheck.includes("npm publish"),
    "release:check never publishes",
  );

  // The verifier itself runs `npm pack`, so it must never be wired to prepack
  // (a prepack -> verifier -> npm pack cycle would recurse).
  assert.equal(scripts.prepack, undefined, "no prepack lifecycle hook");
});

// ---------------------------------------------------------------------------
// .gitignore contract
// ---------------------------------------------------------------------------

test(".gitignore ignores local/transient artifacts while preserving .atl/", () => {
  const gitignore = read(".gitignore");

  assert.match(gitignore, /^\.atl\/$/m, "preserves the existing .atl/ entry");
  for (const entry of [
    ".codegraph/",
    ".pi/",
    "node_modules/",
    "*.tgz",
    ".DS_Store",
  ]) {
    assert.ok(
      gitignore
        .split("\n")
        .map((l) => l.trim())
        .includes(entry),
      `ignores ${entry}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Package verifier contract
// ---------------------------------------------------------------------------

test("verify-package-files.mjs exists, is wired, and passes on this workspace", () => {
  const script = path.join(root, "scripts", "verify-package-files.mjs");
  assert.ok(fs.existsSync(script), "scripts/verify-package-files.mjs exists");

  const out = execFileSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
  });
  assert.match(out, /package verification PASSED/i);
  assert.match(out, /13/, "reports the 13-file tarball surface");
});
