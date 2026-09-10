// Release workflow contract tests: the CI and publish workflows, their
// least-privilege posture, and the trusted-publishing tag validation. These
// tests read .github/workflows/*.yml directly and never install dependencies;
// Node 24 executes them via native type stripping.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(p: string): string {
  return fs.readFileSync(path.join(root, p), "utf8");
}

test("ci.yml runs tests and package verification on Node 24 with least privileges", () => {
  const ci = read(".github/workflows/ci.yml");

  assert.ok(ci.includes("pull_request:"), "runs on PRs");
  assert.ok(ci.includes("push:"), "runs after pushes to main");
  assert.ok(ci.includes("node-version: 24"), "uses Node 24");
  assert.ok(ci.includes("npm test"), "runs the test suite");
  assert.ok(ci.includes("npm run verify:package"), "runs package verification");
  assert.ok(
    ci.includes("contents: read"),
    "declares least-privilege contents scope",
  );
});

test("publish.yml enforces first-publication token bootstrap + provenance safeguards", () => {
  const publish = read(".github/workflows/publish.yml");

  assert.ok(publish.includes("workflow_dispatch"), "manual dispatch only");
  assert.ok(publish.includes("id-token: write"), "OIDC token for provenance");
  assert.ok(
    publish.includes("environment: npm"),
    "gated by an npm environment",
  );
  assert.ok(publish.includes("--provenance"), "publishes with npm provenance");
  assert.ok(publish.includes("concurrency:"), "serializes publish runs");
  assert.ok(
    publish.includes("contents: read"),
    "declares least-privilege contents scope",
  );
  assert.ok(publish.includes("cat-file"), "enforces the annotated tag check");

  // The caller input tag must be bound to an env var once, never interpolated
  // into arbitrary shell code.
  const interp = publish.split("${{ inputs.tag }}").length - 1;
  assert.equal(
    interp,
    1,
    `\`\${{ inputs.tag }}\` appears exactly once (env binding), found ${interp}`,
  );
  assert.ok(
    publish.includes("RELEASE_TAG"),
    "shell references the env-bound RELEASE_TAG",
  );

  // Dist-tag is derived internally (latest/next), not taken from the caller.
  assert.ok(publish.includes("DIST_TAG"), "derives the dist-tag internally");

  // First-publication token bootstrap, not trusted publishing: the granular
  // automation token publishes v0.1.0 with provenance; npm trusted publishing
  // is the documented follow-up that removes the token.
  assert.ok(
    !publish.includes("trusted publishing only"),
    "renamed the misleading 'trusted publishing' claim",
  );
  assert.ok(
    publish.includes("token bootstrap"),
    "describes the first-publication token bootstrap",
  );
  assert.ok(
    publish.includes("NODE_AUTH_TOKEN"),
    "uses NODE_AUTH_TOKEN for the initial publish",
  );
  assert.ok(
    publish.includes("secrets.NPM_TOKEN"),
    "reads the granular NPM_TOKEN secret",
  );
  assert.ok(
    publish.includes("remove NODE_AUTH_TOKEN"),
    "documents removing the token after v0.1.0 exists",
  );
  assert.ok(
    publish.includes("trusted publishing"),
    "documents npm trusted publishing as the follow-up",
  );
});

test("publish.yml accepts stable and prerelease tags but rejects malformed or leading-zero cores", () => {
  const publish = read(".github/workflows/publish.yml");

  const regexes = [...publish.matchAll(/grep -Eq '([^']+)'/g)].map((m) => m[1]);
  assert.ok(
    regexes.length >= 2,
    `found shape and leading-zero regexes (got ${regexes.length})`,
  );

  const shapeRe = new RegExp(regexes.find((r) => r.startsWith("^v"))!);
  const zeroRe = new RegExp(regexes.find((r) => r.includes("0[0-9]"))!);

  const validTags = [
    "v0.1.0",
    "v1.2.3",
    "v0.1.0-beta.1",
    "v10.20.30-rc.2",
    "v1.0.0-alpha",
  ];
  for (const tag of validTags) {
    assert.match(tag, shapeRe, `accepts ${tag}`);
  }

  const invalidTags = [
    "v0.1",
    "0.1.0",
    "v0.1.0+build.1",
    "v0.0",
    "x0.1.0",
    "v1.2",
    "v0.1.0-1..2",
  ];
  for (const tag of invalidTags) {
    assert.doesNotMatch(tag, shapeRe, `rejects ${tag}`);
  }

  for (const core of ["0.1.0", "0.0.0", "1.2.3", "10.0.0"]) {
    assert.doesNotMatch(
      core,
      zeroRe,
      `allows core without leading zero: ${core}`,
    );
  }
  for (const core of ["01.0.0", "0.01.0", "0.0.01", "00.1.0"]) {
    assert.match(core, zeroRe, `rejects leading-zero core: ${core}`);
  }
});
