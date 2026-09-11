# 20260910-2152-b5-scratch-provenance Wire scratch runtime composition and shipped provenance

- **status**: in_progress
- **priority**: P1
- **owner**: b5/ekh6zunh
- **createdAt**: 2026-09-10 21:52

## Description

Implement approved B5 scratch composition and S6 shipped-file provenance for
campaign `mos-open-plans-20260910-100408`, L2 B `8t4ghqi6`, branch `bkd/ekh6zunh`.
Consume the B4 selector after disposable offline installation/configuration and
approved transforms. Preserve selected tools, resources, metadata and independent
boot/support/debug identities. No compatibility work or heavy builds.

## ActiveForm

Verifying the completed B5 software join before handing actual artifact acceptance to B6/B7.

## Dependencies

- **blocked by**: B4 reviewed source `733708c0cec6d4137fb4dfabbf8a6719dcd4a2a8` (satisfied).
- **blocks**: B6 reproducibility and B7 granted image/runtime acceptance.

## Notes

- 2026-09-11 continuation: both source/ownership handoffs are approved. Startup
  confirmed working/running, clean bkd/ekh6zunh at f170b4ba, its expected tree,
  and unchanged local B 733708c0 ancestry. The existing claim remains active;
  corrective count is 1. See the plan annotations for the exact additional scope.
  Separate C.D2 source transfer is 23a3414a8c82f86edbae4434cbf7dd0bd0066b7e.
  Imported helper: 100755/5998a76095938ba667351fe372c2cfa0daec7ee8;
  test: 100644/5f7fd4f4533b62bd0161764cd82cdb6f4005ec4b;
  build.sh after the sole staging hunk: 100755/09bd649f04276c3bb6514eb2be8357403b77a9f0.
  Original 104/412 successful gates, RED and accepted UI failure remain evidence;
  no full suite is rerun merely for this handoff.

- Full tier. Prior user approval explicitly covers the bounded proposal,
  implementation and local scoped commits; no repeated approval question.
- BKD reports working/running. Initial branch was clean at approved #313
  `5d0dca577a782aa707d9530779c4b23f2a7eda31`. Exact L2 source and tree verified;
  authorized merge is `d9b9a07b10f38a24c86c9054f7e1776243558746`, tree
  `ea69cc758ddf609552f30a468d73ec46501ebb2e`. #313, Git fix and B4 ancestry pass.
- [Plan](../plan/20260910-2152-b5-scratch-provenance.md).
- Task transitions use the PMA serializer. Only own index rows may change;
  L2 D owns global reconciliation. Historical residual task blobs stay untouched.
- C public-meta/verifier and four-file Git identity blocks remain reserved.
  Conditional public-meta provenance requires the exact approved C handoff.
- B L3=1, heavy=0. Actual root/kernel/image/QEMU/cold builds require L1 grants.

## Implementation and evidence

- Native capture retains selected.pkgs, manifest.tsv, dpkg info lists, source
  package/version identities, selected upstream lock rows and local pool records.
  Native alternative queries and deb-systemd-helper state have exact capture
  name lists; missing captures refuse rather than shrinking the output.
- The configured tree is hashed before the existing closed-stage transformations.
  A tar transfer preserves and compares numeric ownership, modes, xattrs,
  capabilities, symlinks and hardlink groups before pack transforms run.
- Final offline composition writes only explicit roots/closure into /runtime.
  The existing shipped manifest now lists actual non-directory contributors;
  build-only target packages remain in the exported input inventory. Copyright
  resources and native source identities stay attached to their contributors.
- The report joins configured and final file hashes with archive identities and
  checked debug counterparts. Transform script hashes and pack-tool versions are
  exported beside native input captures. Rootfs-report.runtime.json is exported
  through the existing artifact target and joined to release metadata by the mandatory runtime-report input.
- Native alternatives and conditional enablement supplement declarations with
  named producers and exact link targets. Preset removals carry their precise
  path/policy record. Only the already-approved systemd-hwdb and pam_getenv
  removals were added to the selector's exact exclusions. Unknown missing paths,
  selected build residues and omitted surviving operator executables refuse.
- SquashFS consumes /runtime; extraction verifies the exact selection report.
  Factory stage copying also has an exact report check before artifact export.
  Final OCI serialization, actual SquashFS transfers and installed closures have
  not run here and remain B7 acceptance. The old unsafe measurement script was
  not run, and there is no built _out tree in this isolated worktree.

## Verification

Initial RED: `timeout 120 python3 tests/rootfs-runtime/composition_test.py`
against committed selector/pack source `d9b9a07b10f38a24c86c9054f7e1776243558746`
exited 1: 60 tests, six failures and one error (missing composition entry and
pack wiring); the original 53 selector tests passed. Metadata:
`/tmp/mos-b5-red-nc3ga4/metadata.json`, SHA256
`8da25480b40d30e834672edc2a11dd41784ca50194cb0e4a7fc59c5dda2d01de`.

Additional actual RED cases exposed selected database residue, uncaptured public
metadata, lost native alternatives and measurement of source allocation instead
of destination allocation. The sparse-file RED was `98304 != 1146880`; after
copying, allocation is now measured on the selected destination. Intermediate
logs are `/tmp/mos-b5-residue-red.log`, `/tmp/mos-b5-native-red.log` and
`/tmp/mos-b5-measure-red.log`; these are intermediate worktree checks, not
separately committed source identities.

Focused GREEN: `timeout 120 bash tests/rootfs-runtime-test.sh` passed 73 tests,
no skips, including real tar/xattr/capability/hardlink roundtrips and current
policy resource bytes. Latest focused log: `/tmp/mos-b5-final-focused.log`.
Small fixtures are not current image, boot, memory or physical evidence.

Initial required-gate metadata is `/tmp/mos-b5-gates-DeLOZw/metadata.json`,
SHA256 `259bd21fd31f1e3f5bc1ace4dd5c9deb4a3a430b735853227a25eb02d7ff2809`.
It records exact source/file hashes, commands, UTC times, logs and exit codes.
Runtime (then 70 tests), manifest (46 checks, 22 reachable packages, 257
resolutions, six refusals), Debian (54 checks plus both architectures),
host-toolchain, docs and diff checks exited 0. Shell lint exited 2 solely for
the accepted unrelated baseline; aggregate exitCode remains 1:

```text
FAIL: pkgs/mosd/apid/ui/verify-ui-policy.sh:82: an early-exiting grep on the right of a pipe, in a file that sets pipefail: the pipeline reports failure when the pattern IS found. Use 'grep -c ... >/dev/null'
RESULT: FAIL (158/159 files clean, 159 scanned)
make: *** [Makefile:350: os-shell-pipefail-lint] Error 1
```

The final committed-source gates at
`75b77f3bb2b4c968a3f73a89610c5e3a7f1eae0e` finished at
`2026-09-10T22:24:42.737210+00:00`. Metadata:
`/tmp/mos-b5-final-gates-F5fkaJ/metadata.json`, SHA256
`83cfce935bdce4159e7c262547ce6dea8f377e1925c93b5c40e611fd4fb631d9`.
All nine log hashes were reverified during corrective round 1. Runtime (73),
manifest (46), Debian (54 plus dual-architecture locks), host, docs, verify
(646 tests, 6565 assertions, 21 files), and diff passed. Shell exited 2 for the
accepted baseline above. Build exited 2 with 397 passing and two failing tests,
1158 assertions across 26 files. Aggregate exitCode is 1, not a final gate pass.
The build failures are preserved in gate-7.log, SHA256
`b6c20937326cdfd60bc20ace6b1294275bd7e2a1035aeda5bcdc03c2dbbb6baa`:

```text
(fail) the assembly this tree actually ships > 90-pack defines all four of its internal targets, in the order it explains them
(fail) the assembly this tree actually ships > the factory-root export is taken from the PACKED tree, not from `closed`
make: *** [Makefile:222: os-build-test] Error 1
```

The expected four targets omit capture and factory validation, and the expected
`COPY --from=pack /rootfs/ /` names the disposable installation tree. L2 approved
corrective round 1 in this existing issue: update only these acceptance checks,
their immediate negative fixtures, and these records. No production policy or
shared C change is authorized. Original RED evidence remains intact.

The serializer-owned claim remains `in_progress`, owner `b5/ekh6zunh`; the plan
remains `implementing`. No state transition is needed or attempted. Corrective
evidence is collected under `/tmp/mos-b5-r1-614v4f9m/` in the existing persistent
shell `ekh6zunh-e65ae8`. Required checks are focused stages, then one complete
`timeout 900 make os-build-test`, docs and diff. Unchanged verify and the accepted
shell baseline are not rerun. The pinned repository runner enforces TypeScript
checking and nonzero tests; package.json has no format/lint/build scripts. No
dependencies, project configuration or global toolchains change.

Corrective RED: `timeout 300 bash build/run.sh src/stages.test.ts` at the clean
`75b77f3b` checkpoint exited 1 (89 pass, two fail, 188 assertions). Its metadata
and log are `red/metadata.json` and `red/gate-0.log` beneath that corrective
directory. The same command after the assertion correction exited 0 (104 pass,
zero fail, 236 assertions, no skips), including 13 negative controls. Metadata
is `focused/metadata.json`; log SHA256 is
`4f7bdfb947fe838ad93054070f187252cb4a4c36467427d161b3f10fc39d329d`.
The corrected stages.test.ts SHA256 is
`cc4a370f510808eeee1603fb287dbcb3a8fefcb0b73600ff1855f5d26dc4bb53`.

Assertions now require the exact eight named targets, scratch factory-root's
sole COPY from pack's /runtime, the offline verification of the copied candidate
against the same report, and all eight artifact exports from factory-checked.
Stage boundaries and comments are handled before comparison. Negative controls
reject installed/closed/transformed root substitution, inherited roots, extra
overlays, comments or later-stage decoys, verification of the wrong root/report,
removed or ignored verification, and an unchecked artifact. These are source
contract tests, not OCI/SquashFS or runtime proof. Production files are unchanged.

Corrective implementation commit is
`e07aac23913cc4c162e4de1a5af934d0c2e5ec3d`, tree
`a8698f346f93d175e570f42c2fcb2d2a7b720b94`. Its clean-source final run finished at
`2026-09-10T22:40:47.085049+00:00`, aggregate exitCode 0:

| Command | Result |
| --- | --- |
| `timeout 900 make os-build-test` | Exit 0; 412 tests, 1206 assertions, 26 files, no skips. Run once after correction. |
| `timeout 120 make docs-verify` | Exit 0; all five documentation checks passed. |
| `timeout 30 git diff --check 75b77f3bb2b4c968a3f73a89610c5e3a7f1eae0e HEAD` | Exit 0. |

Final metadata: `/tmp/mos-b5-r1-614v4f9m/final/metadata.json`, SHA256
`65575758523bce1da13084bccce6b7e9609907116cf0c340ff86293f6f32bded`.
All three final log hashes match. The full build log SHA256 is
`517fb4c6533a3ac19a989b98d20d6be724592abc599b47bee6f31c3f9e6b8bd6`.
The subsequent evidence commit changes only this task and its plan; final docs
and diff checks are recorded under `/tmp/mos-b5-r1-614v4f9m/record/` without
rerunning unchanged build tests. The original nine-gate aggregate remains 1;
the accepted UI failure is not reclassified by this corrective aggregate.

Independent correction is complete. Overall B5 status is partial, blocked by the
two handoffs below. There is no remaining detached build gate or new heavy grant.

## Local review

PMA-CR shared/Python review covered all changed source, fixtures and packing
call chains. The independent composition implementation has no remaining
high-confidence correctness finding in that bounded review. Completion remains
partial because of the explicit source/ownership and artifact-proof rows below.
No Rust, UI, native lifecycle, C public-meta/verifier or Git identity source was
changed. Review verdict for the independent diff: PASS (0 critical, 0 high,
0 medium, 0 low). This does not classify pending image or release work as done.

Corrective round 1 PMA-CR shared/TypeScript backend review covers the focused
test diff and the existing stage parser/export call chain. Verdict: PASS
(0 critical, 0 high, 0 medium, 0 low). No additional production defect or scope
need was demonstrated by these two failures. Python fixtures were not changed.

## Approved handoff continuation and S6 implementation

The C.D2 focused runner `timeout 300 bash build/run.sh src/public-meta.test.ts`
passed 61 tests and 133 assertions at the separate imported-source commit.
Evidence lives under `/tmp/mos-b5-s6-3zypj5yl/`, with source/UTC/command/log/hash
and exitCode in each subdirectory's metadata.json. No pause-only full rerun.

- `red/`: original release code accepted a missing report (exit 1 regression
  test); five composition cases errored because the mandatory public declaration
  did not exist. The original 73 composition tests passed.
- `red-join/`: 18 new runtime-report cases failed against the old release join,
  with real reports produced by the small Python composition fixture.
- `green/`: 78 composition tests passed. Release checks exposed marker rewriting:
  assembly sorted its domains, so release bytes differed from installed bytes.
  The implementation now retains the validated original marker; domain parsing,
  customer-channel refusal and signing policy are unchanged.
- `green-release/`: 46 release tests and 171 assertions passed, including the
  untouched ordinary/linked source-identity and read-only Git protections.
- `red-measurement/`: a forged RSS pass was accepted before explicit evidence
  status validation. The nanosecond negative control initially altered an external
  input rather than a selected file; its mutation now targets the selected files
  section, preserving the strict expected refusal.
- `focused-final/`: 78 composition tests and 109 release/public-meta tests
  (312 assertions) passed. Configured nanoseconds remain exact decimal strings
  in derived provenance, with original JSON bytes retained as an artifact.
- `red-public-directory/`: an unknown empty public metadata directory was silently
  omitted (exit 1, `AssertionError: 0 == 0`). The final rule rejects all unknown
  public paths, including empty directories, and requires captured regular parents.

The S6 join requires the current per-file report, exact native ownership captures,
archive/source records, contributor inventory, per-path metadata/origins, license
resources and debug mappings. It binds the measured verity image and geometry to
those already authenticated in update.mosupd. Build-only packages stay distinct
from actual shipped contributors. Missing input, mismatches, malformed/duplicate
JSON and invalid UTF-8 refuse before creating a release output. Derived records
are regenerated and compared by the release gate even after outer digests are
repinned. Per-file report/provenance reads have a 128 MiB bound; no root/image size
budget changed. The report is evidence from composition, not an independent
proof that an untrusted report describes all signed image bytes: B7 must extract
and verify the actual image against that exact report.

PMA-CR shared/TypeScript backend/Python review covers the new join, current public
closure and tests. No high-confidence unresolved finding remains in this bounded
software review (0 critical/high/medium/low). sourceIdentity/imports, Toolbox,
verifier, native lifecycle, storage, UI and all earlier gate histories are intact.
Final committed-source gates are pending collection before software completion.

## Remaining ownership and handoff

- Both external source/ownership blockers are resolved by the approved handoff.
  C.D2 source is isolated in 23a3414a; no other C source or branch was imported.
- B6/B7 release invocation now needs `--runtime-report FILE` pointing at the
  exact `rootfs-report.runtime.json` exported by that root build. Its matching
  `--package-manifest FILE` is the selected root's `/usr/share/mos/manifest.tsv`,
  not the build-inputs/manifest.tsv containing all installed build packages.
  `--baked-meta DIR` must have byte-identical current public manifest and optional
  nonempty marker. The report's verity image/geometry must match the signed root
  component included by `--update FILE.mosupd`. No older-input fallback exists.
- B7 owns actual install-closure, SquashFS/factory OCI extraction/report matching,
  signed component/debug/boot identity, fresh full images, memory/RSS and runtime
  historical-obligation rows. B6 owns cold reproduction. No heavy job was started;
  the future reserved milestone slot is not a B5 grant. Physical evidence remains
  separate. See the plan's unchanged artifact acceptance recipe.
- L2 D owns old/global reconciliation. No sibling or #313 statuses changed. Only
  B5 software obligations may be completed after the final relevant gates pass.


## Final S6 software acceptance

Implementation is `76616b95b42fa06868be583fc59bae29a5b9ba6f`, tree
`a15eee587874a21a906a1ce45c43e486dcf6ab59`. Its final eight-gate run completed
at 2026-09-11T00:57:13.758716+00:00. Metadata:
`/tmp/mos-b5-s6-3zypj5yl/final/metadata.json`, SHA256
`146a08942d9f05cf612bbd3d9fad5bb08b4db8583a1c3f6e1039642314618650`.
Runtime (79 tests), manifest (46 checks), Debian (54 plus dual-architecture
locks), host, docs and diff passed. Full `timeout 900 make os-build-test` passed
500 tests, 1451 assertions, 27 files, no skips. All eight log hashes match.
Shell lint exited 2 solely for the accepted UI baseline; aggregate remains 1:

```text
FAIL: pkgs/mosd/apid/ui/verify-ui-policy.sh:82: an early-exiting grep on the right of a pipe, in a file that sets pipefail: the pipeline reports failure when the pattern IS found. Use 'grep -c ... >/dev/null'
RESULT: FAIL (159/160 files clean, 160 scanned)
make: *** [Makefile:350: os-shell-pipefail-lint] Error 1
```

This was committed production source, but the test bridge generated one untracked
composition_test bytecode file. That cache was inspected and moved into the owned
external evidence directory with its digest verified; no unknown file was removed
or committed. The fixture now disables bytecode before importing its Python helper.
Its separate committed release-suite rerun must prove a clean checkout is retained;
production source stays identical to the full 500-test gate. The original run is
not described as a clean worktree, and its metadata retains the untracked status.
