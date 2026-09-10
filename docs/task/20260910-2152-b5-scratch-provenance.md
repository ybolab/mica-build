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

Collecting corrective build gates while awaiting the two reviewed C handoffs.

## Dependencies

- **blocked by**: B4 reviewed source `733708c0cec6d4137fb4dfabbf8a6719dcd4a2a8` (satisfied).
- **blocks**: B6 reproducibility and B7 granted image/runtime acceptance.

## Notes

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
  through the existing artifact target; it is not yet joined to release metadata.
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

## Remaining ownership and handoff

- C public metadata: current source still installs the pre-handoff public set.
  Selection explicitly refuses an installed public file without an approved
  declaration. No old update compatibility or guessed C contract was added.
- Release provenance needs a mandatory runtime-report input and its validation in
  build/src/release-manifest.ts (FILES, ReleaseInputs, derived, assembleRelease)
  plus release-cli.ts (USAGE/main options/assembleRelease arguments only).
  This requires modifying the shared release-manifest.test.ts fixture and the
  C-owned shipped-CLI argument list at lines 225-228. Those files were not edited.
  L2 must obtain a precise non-overlapping boundary or reviewed C handoff before
  this join; sourceIdentity and its imports need no change.
- B7 owns actual install-closure, SquashFS/factory OCI roundtrip, matching signed
  components/debug exports, newest full image comparisons and fresh runtime
  acceptance. B6 owns cold reproducibility. Heavy grant remains zero.
- Task and plan intentionally remain in progress while these bounded B5 rows are
  open. No completion/close transition was bypassed. L2 D owns old-record/global
  reconciliation; no sibling or #313 task status changed.
