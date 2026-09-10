#!/usr/bin/env node
// Deterministic, no-dependency release verification for tps-gentle-pi.
//
// It checks the public release metadata and the exact npm tarball surface by
// invoking `npm pack --dry-run --json` once. It is intentionally NOT wired to
// a `prepack` lifecycle hook, because `prepack -> verify -> npm pack` would
// recurse. Run it directly via `npm run verify:package` or `release:check`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pkg;
try {
  pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
} catch (error) {
  console.error(
    `package verification FAILED: cannot read/parse package.json (${error.message})`,
  );
  process.exit(1);
}

const failures = [];
const passed = [];

function check(condition, message) {
  if (condition) passed.push(message);
  else failures.push(message);
}

// --- Public release metadata -------------------------------------------------
check(pkg.name === "tps-gentle-pi", `name is tps-gentle-pi (got ${pkg.name})`);
check(
  pkg.author === "glacayo",
  `author is glacayo (got ${JSON.stringify(pkg.author)})`,
);
check(
  pkg.repository?.url === "git+https://github.com/glacayo/tps-gentle-pi.git",
  `repository.url is the glacayo GitHub repo (got ${pkg.repository?.url})`,
);
check(
  pkg.homepage === "https://github.com/glacayo/tps-gentle-pi#readme",
  `homepage is the README anchor (got ${pkg.homepage})`,
);
check(
  pkg.bugs?.url === "https://github.com/glacayo/tps-gentle-pi/issues",
  `bugs.url is the issue tracker (got ${pkg.bugs?.url})`,
);
check(
  pkg.engines?.node === ">=24.0.0",
  `engines.node is >=24.0.0 (got ${pkg.engines?.node})`,
);
check(
  pkg.publishConfig?.access === "public",
  `publishConfig.access is public (got ${pkg.publishConfig?.access})`,
);

// --- Corrected optional Pi peer dependency ----------------------------------
check(
  pkg.peerDependencies?.["@earendil-works/pi-coding-agent"] === "*",
  `peerDependency @earendil-works/pi-coding-agent is "*" (got ${pkg.peerDependencies?.["@earendil-works/pi-coding-agent"]})`,
);
check(
  pkg.peerDependenciesMeta?.["@earendil-works/pi-coding-agent"]?.optional ===
    true,
  "peerDependency is optional",
);

// --- Scripts / anti-recursion ------------------------------------------------
check(
  typeof pkg.scripts?.test === "string",
  `scripts.test is present (${pkg.scripts?.test})`,
);
check(
  pkg.scripts?.["verify:package"] === "node scripts/verify-package-files.mjs",
  `verify:package is wired (got ${pkg.scripts?.["verify:package"]})`,
);
const releaseCheck = pkg.scripts?.["release:check"] ?? "";
check(
  releaseCheck.includes("npm test") &&
    releaseCheck.includes("npm run verify:package"),
  `release:check runs tests + package verification (got ${releaseCheck})`,
);
check(!releaseCheck.includes("npm publish"), "release:check never publishes");
check(
  pkg.scripts?.prepack === undefined,
  "no prepack hook (no recursive npm pack)",
);

// --- Exact 13-file tarball surface ------------------------------------------
const expectedFiles = [
  "LICENSE",
  "README.md",
  "extensions/index.ts",
  "package.json",
  "src/channel-guard.ts",
  "src/channel.ts",
  "src/correlation.ts",
  "src/format.ts",
  "src/graphics.ts",
  "src/render.ts",
  "src/stats.ts",
  "src/tracker.ts",
  "src/types.ts",
];

let packed = [];
try {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  packed = JSON.parse(raw);
} catch (error) {
  failures.push(`npm pack --dry-run --json failed: ${error.message}`);
}

let entryCount = null;
if (Array.isArray(packed) && packed.length > 0) {
  const [result] = packed;
  entryCount = result?.entryCount;
  const actual = (result?.files ?? []).map((f) => f.path).sort();
  const expected = [...expectedFiles].sort();
  const same =
    actual.length === expected.length &&
    actual.every((p, i) => p === expected[i]);
  check(
    same,
    `packed file set matches the 13-file surface (got ${actual.length} files)`,
  );
  if (!same) {
    failures.push(`  expected: ${JSON.stringify(expected)}`);
    failures.push(`  actual:   ${JSON.stringify(actual)}`);
  }
}

if (failures.length > 0) {
  console.error("package verification FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

for (const line of passed) console.log(`  ✓ ${line}`);
console.log(`entry count: ${entryCount ?? "unknown"}`);
console.log("package verification PASSED");
