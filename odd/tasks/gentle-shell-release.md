# Gentle Shell compatibility release
Integrate the approved feature chain and publish the agreed patch release without unrelated behavior changes.
Target: `github.com/glacayo/tps-gentle-pi` | Version: `0.2.2` | Tracker: PR #5 | Risk: item 5 (delivery/release).

## Specs
S1. "estamos listo para merge y release"
S2. "Autorizar merge y release, incluida publicación npm"
S3. "0.2.2 — parche (recomendado)"
S4. "Aceptar NPM_TOKEN existente para esta release"

## Tasks
T1 | S1-S4 | parent | done | Verify current gates, published version, workflow and explicit version/authentication decisions | commit: administrative evidence; job9 exit0, latest npm/GitHub0.2.1, PRs mergeable/checks successful, human decisions recorded.
T2 | S1-S2 | parent | done | Integrated children into tracker, preserved scopes374/281/195 and all branches | commit: #6 a5f2a6b95cf88645f82924e1aee5f487024d2572; #7 4a4fe3944dfce030cfe22d9eb2043c41bb087a73; #8 5fc70b0773db4a538ff938929088db915e76ab7e; checks and merged read-back PASS.
T3 | S2-S4 | parent + independent gentle-ai-verify | done | Set package version0.2.2 on the integrated tracker, run release checks and verify release metadata/workflow safety | commit: release work unit prepared here; exact SHA recorded after commit. Risk: item5 (release metadata). RED old version pin, corrected expectation, GREEN release:check and independent verification PASS.
T4 | S1-S3 | parent | in_progress | Validate complete tracker CI including secret scan, ready/relabel tracker appropriately and merge to main | commit: pending remote merge evidence.
T5 | S2-S4 | parent | pending | Create/push an annotated v0.2.2 tag at exact main and dispatch the unchanged Publish workflow once | commit: pending tag/workflow evidence.
T6 | S2-S4 | parent | pending | Observe publishing outcome, confirm registry identity/provenance and create/read-back GitHub release | commit: pending registry/release evidence.

## Log
L1. Original request, verbatim: "estamos listo para merge y release".
L2. Explicit operation selection, verbatim: "Autorizar merge y release, incluida publicación npm". Use the current gh session for the existing exact target; integration, necessary release preparation and workflow publication are authorized, not unrelated statistics changes.
L3. Version selection, verbatim: "0.2.2 — parche (recomendado)". Authentication selection, verbatim: "Aceptar NPM_TOKEN existente para esta release". This is a one-release exception to the workflow comment requesting trusted-publishing migration. Do not inspect, copy, rotate or replace credential values; do not change authentication/workflows or weaken gates.
L4. Fresh remote evidence job9 exit0: PRs5-8 mergeable, existing checks SUCCESS, no GitHub reviews registered; human explicitly authorized integration. Merge commits enabled; automatic branch deletion disabled. Latest GitHub/npm0.2.1. Publish workflow active, environment npm has no approval/branch rules. It requires an annotated tag equal to main and package version, reruns tests/package checks, rechecks drift, then publishes with provenance and latest for stable versions. A GitHub release alone does not dispatch it.
L5. Preserve existing source commits: #6 into tracker, retarget #7 to tracker after #6, then #8 after #7. Check exact head and additions+deletions before each merge; wait for any newly applicable CI. Do not merge all children backward and inflate later review diffs. Retain all branches and avoid force/rebase. Tracker final aggregate is deliberately the integration of already-reviewed slices; no new feature behavior is included.
L6. Package.json is the only version manifest; no lockfile tracked. Original implementation tests and independent lifecycle verification remain valid for unchanged source. New version metadata gets one independent item5 verification. Do not repeat provider smoke, change μ/p95/active, install/reload real profiles, or claim model speed gains. Accepted historical auth attribution remains unknown, not resolved by this release.
L7. Integration job10 exit1 after #6 successfully merged (a5f2a6b95cf88645f82924e1aee5f487024d2572) and its CI/read-back passed. gh2.46 pr edit for #7 failed on retired GraphQL projectCards. Do not replay job10 or merge6 again; reconcile #7 with a read-only REST GET, then complete only missing authorized base/body changes through REST. No package/version/tag/publication action occurred.
L8. Job11 confirmed the failed GraphQL edit made no #7 base/body change; job12 completed only missing retargets through REST and merged #7/#8. Original scopes stayed281/195, checks/read-back passed, no repeated #6 mutation. npm exact0.2.2 preflight HTTP404 (not published).
L9. Job13 exit0 fetched and fast-forwarded the local tracker to5fc70b; its tree exactly equals prior verified feature leafa9b402d. package.json alone now declares0.2.2. No meaningful behavior RED applies to version metadata. Job14 runs structural identity/version assertion and release:check with HOME/TMPDIR/npm cache isolated inside project; result pending, not claimed PASS yet.
L10. Job14 exit1: existing test/package-release.test.ts:38 pins0.2.1, rejecting the authorized0.2.2 metadata. Standalone package-check step after the failed suite was skipped by &&. Corrected only that assertion to0.2.2; no product behavior/test case removed. Job15 runs the corrected release:check, result pending. This supersedes the initial assumption that no existing version-specific RED would apply.
L11. Job15 release:check GREEN exit0 (250tests and exact15-file package surface), diff-check PASS. Independent verifier mwa2pss5-4-d87j T3/S2-S4 PASS: isolated250tests, zero failed/skipped/cancelled, package15files, only manifest version/test assertion changed and workflows identical. Known MaxListeners fixture warning advisory remains; no auth values inspected. Parent staged identity/version spot-check applies before commit.
