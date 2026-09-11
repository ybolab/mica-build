# 20260910-1014-a4-cx3576-integrated-acceptance CX3576 integrated artifact and board acceptance

- **status**: completed
- **priority**: P1
- **owner**: bkd/1zjiu5h5
- **createdAt**: 2026-09-10 11:38

## Description

Verify the reviewed A1/A2/A3 CX3576 changes as one coherent compiled kernel and
artifact candidate, correct the bounded board evidence collector for the current
signed-file contract, and record software results separately from unavailable
physical bench qualification. Absorb the approved S905X5M artifact evidence
without relabelling its dirty-stamped build or duplicating implementation.

## ActiveForm

Completed collector and coherent kernel evidence; implementing the separately L1-authorized load-adapter recovery before unchanged smoke. Physical qualification remains blocked.

## Dependencies

- **blocked by**: Physical acceptance requires an identified bench, current flashed image, console/API route, target medium and power rig.
- **blocks**: Workstream A integration review and workstream D final reconciliation.

## Notes

### Authorized composition continuation — 2026-09-10

Phase state: adapter recovery authorized on 2026-09-11, owned by
`bkd/1zjiu5h5`. Historical automatic retries remain 2 of 2; the case-specific
`l1AuthorizedAdapterRecovery=1` is separate, with no automatic fourth recovery.
The completed task/index
status above preserves the earlier collector/kernel delivery; it does not claim
that this new candidate exists or passes. The PMA serializer has no reopen
operation, so this continuation is a content update under the explicit L1/L2
handoff, not an invented status transition or a second task. Composition began
with recovery count 1. The subsequently authorized archive-acquisition recovery
below consumes recovery retry 2, the existing maximum; no automatic retry 3.

The exact L1 source/input handoff delivered through L2 authorizes a new CX3576
development root and signed-file composition using existing recipes read-only.
The clean branch was fast-forwarded to local L2 commit
`9d1218e2689eb5e3fce99ad1736f3a1fdc8c8801`, tree
`0a1c2b4ddd86945961da16cc6d4d268e636f2273`, identical to the previous A4 final
tree. No main, sibling or remote branch was imported. The earlier root/native-init
input blocker is resolved by this authorization to build the current root and
reuse the explicitly selected source-equivalent native init; the two rejected
old roots remain rejected and their historical audit below remains unchanged.

Immutable, self-contained checkout and staging:
`/srv/station/work/tmp/mos/1zjiu5h5/composition-20260910-2026-z2Ljld/`.
`source/` has its own Git object database, no alternates, exact HEAD/tree above
and a clean tracked/untracked state. `evidence/source-files-before.txt` records
all tracked modes/blob identities (SHA-256
`79f1af52e60640a0fa772ea6a0d632e4a61cf39f5c8ab9b08f78b817040d8b33`).
The only public defaults input is `inputs/meta/updates/manifest.json`, copied
byte-identically from this commit, SHA-256
`a30e535b37d8ab32d62d21f118dd610d102584c214375cf229353e0ab474ce00`.
There is no GENERATED marker, endpoint override or signing key in that input.

Existing pools report stamps `git5c61f7fbb558.dirty-1` (approved S905 snapshot),
`git97bb466792ca-1` (original main output), and `gitd64b23a7d92a.dirty-1`
(CX storage-display snapshot). `rootfs/build.sh` requires the pool's one stamp
to equal this checkout's `git9d1218e2689e-1`; these archives cannot be copied or
renamed into a passing current pool. Only the selected producers will be
rebuilt, serially, without weakening stale-source/index/ownership checks.

First package gate: the five selected architecture-independent producers
`system`, `profile`, `ca-trust`, `wifi`, `bluetooth`, then `board-cx3576` for
ARM64. Existing `build-env/deb/preflight.sh --producer NAME` and
`build-env/deb/build.sh --producer NAME --arch all|arm64` remain unchanged.
Their `all` outputs also populate the private amd64 pool by recipe; that is one
archive exported twice, not an x64 build matrix. The remaining selected native
producers, new root, support/FIT/records/image and exact-candidate gates follow
serially after result collection. No full-image or hardware pass is implied by
this first partial pool.

The passed kernel remains bound to `38a362cd`, not the documentation/source
sync commit. The selected native init remains the original development binary
`33e66fbc63ee8353f0ddcee33cd53fdc504ec146824f9ad02d3d3d9329fffd5d`
with approved #313 source-content equivalence. Firmware and signing input
admission follow the exact handoff; no key generation or firmware rebuild is
authorized. A-baseline composition does not include pending B/C product changes.

PMA Bun/Rust acceptance baselines apply to package provenance, pinned tools,
compiled dependencies and artifact checks; unchanged product code is not being
refactored or declared production-ready. New executable product behavior is
absent in this phase, so new product RED/GREEN is not applicable; the earlier
collector RED/GREEN is retained. All 38 mandatory CX physical rows, S905 physical
obligations and original-device reboot remain unqualified. A coordinates and A4
integrates; device/operator/endpoint/current-image/power inputs are unconfirmed.
Historical D5 remains optional and nonblocking. D owns global reconciliation.

Checkpoint review: pma-cr local review of the actual two-document delta and
external gate/resource wrapper found zero reportable issues (PASS). Product
source is unchanged. `bash -n` passed for both external scripts; all six existing
producer preflights passed (23 examined inputs total); `make docs-verify` and
scoped `git diff --check` passed. The documentation log is
`evidence/docs-composition-checkpoint.log`, SHA-256
`8a05e614b6a6f3057988dc2ab915a7d38c1dca9b9fb13c021799786872185216`.

Prepared command: `bash /srv/station/work/tmp/mos/1zjiu5h5/composition-20260910-2026-z2Ljld/package-policy-gate.sh`.
Script SHA-256: `6ad5386d2a3cf895db6d982c40dad99f85692671402479aa9b52513a0a9bc108`;
invocation-only Docker wrapper SHA-256:
`e9625db5b77d4d9d4cf59c784261c9605e301cdd0a2e6396b8f942126b8937d8`.
The persistent-shell session is `1zjiu5h5-a3c184`; authoritative live/final
metadata will be `evidence/package-policy-gate.json`, with PID, UTC times,
source/tree, command, script hash and exitCode. Full output is
`evidence/package-policy-gate.log` plus per-producer logs. This is prepared-gate
metadata, not a claim that the package build has already passed. No old resource
was deleted; the prior kernel evidence and build image remain preserved.

### Policy package result and native package continuation

The policy gate completed at 2026-09-10T20:31:34Z (started 20:29:32Z), exit 0.
Its full log is 57,787 bytes / 853 raw newline lines, SHA-256
`f43bf9eb5c4ac74ea0fdd78899ca42ce69d5799ed2d6d5b19e9482cdc68ac3bc`.
Metadata and final `GATE_EXIT_CODE=0` agree; PID 1460571 is absent and the
persistent shell has no unfinished child. A4 revalidated every entry in
`evidence/policy-package-SHA256SUMS` (manifest SHA-256
`a521e69191d90bc1899edfb23bcf623634cd851776b1313b92294611f272565c`),
the clean source/tree, archive metadata and the actual packed layout script.
The source, logs, eight ARM64-pool archives and seven identical `all` exports in
the private amd64 pool are preserved. Native-gate preparation saves the old
indexes separately before adding new archives and regenerating the current
ARM64 index; no passed producer is rebuilt.

| Policy archive | SHA-256 |
|---|---|
| mos-system | `6f4d2a45f4be398de573f0df332d4f163aa3065749a63311dbd828a4118c31cd` |
| mos-board-cx3576 | `205120d096dcd6481597061195f834fb0e9bf00e119d89c80cbf23907ae517eb` |
| mos-ca-trust | `95d85a6475d12e6d8102f672cf7759c393de9d634c4c5552c72a54d7e0c1e65d` |
| mos-profile-dev | `92062c50a4a1dbeafa737c953227c445537bd3aec96ba7c80bb7a3f15e6979f8` |
| mos-profile-prod (emitted, not selected for the dev root) | `4b1c93bc64563d0858e866d40ae00d901ab1de3ad27b04cabe0f358633b72705` |
| mos-wifi | `58789c7038191c68cf356dd0b2c415a12fb85b09ce1564b761f9e6c6c36c9d3d` |
| mos-wifi-ap | `b73154791419f6c628875267e47e3f355d5a71d8d54456adbc90e3d4b98c9f75` |
| mos-bluetooth | `20c324b2430a9072d77ab723a984e779b22a83807df7d295d326f977e0a256c4` |

All versions are `0.1.0+git9d1218e2689e-1`; only the board package is ARM64,
the others are `all`. Full fields/Depends/content listings are preserved at
`evidence/native/policy-archives-fields-and-contents.txt`, SHA-256
`908f0a4bcfd0b3d93f77db5c4c2de617b9cf5455defa7ee355c715b1d5b4c930`.
This partial pool is not a complete selected-pool, root or image pass.

The next gate serializes the remaining selected producers `busybox`, `deploy`,
`mosd`, `mqtt`, `podman`, all at `--arch arm64`, through the unchanged
`build-env/deb/build.sh`. Rust builds use the existing pinned builder, locked
dependencies, producer-private targets and four compile jobs; the APID producer
builds its UI with the pinned Bun image and embeds that actual output. The
unchanged UI is not a new UI implementation or a new broad UI-policy pass.

The container-engine binaries are reused from the approved #313 snapshot at
`/srv/mos/tmp/s905x5m-current/source/pkgs/podman/out-arm64`, with no new upstream
compile. A4 checked all 15 recorded `pkgs/podman/` source hashes against the
immutable approved source record and current checkout, the seven binary hashes,
their AArch64 ELF headers, and their byte identity to the original approved
`mos-podman_5.8.6+git5c61f7fbb558.dirty-1_arm64.deb` (SHA-256
`eebb5681924737cf46f2028add1b3666e17bc682a8c84db7b28918f481de5e1b`).
The versions-lock digest is
`89c2b2b5934ab24205dbbf6f614f36c87ea33666f7cd928ff60bb2111707de98`.
Only these binary outputs and their original manifests were copied into the
private output directory; no source or old Debian archive was imported.
The new package will retain this explicit inherited binary provenance while
packaging the current configuration at the new exact source stamp.

Input audit: `collect-policy-and-native-inputs.sh`,
2026-09-10T20:38:19Z..20:38:24Z, exit 0; log
`evidence/native/input-audit.log`, SHA-256
`8516b9018828fc13411bbee1f78672f368abd97ef3e19ca9708148ff9cb5ee36`.
Four generic producer preflights passed, and the selected ARM64 podman hook
reports 8 examined inputs, 0 missing, 0 warned. No native-init fallback was used.

The prepared next command is `bash /srv/station/work/tmp/mos/1zjiu5h5/composition-20260910-2026-z2Ljld/package-native-gate.sh`.
Its authoritative metadata/log are `evidence/native/package-native-gate.json`
and `evidence/native/package-native-gate.log`; the same persistent-shell session
is reused. The gate checks selected archive stamp, ELF/loader/NEEDED metadata,
non-directory ownership across all 14 resolved CX dev packages, and unchanged
source/tool identities. Runtime dependency resolution still belongs to the new
root build and smoke gate. `tests/deb-package-gate.sh` has no selected-board or
single-architecture mode: its all-board/two-architecture reproducibility matrix
is not claimed by this scoped package inspection and is not weakened or edited.
No root, FIT, signed records, full image or physical result exists yet.

Checkpoint review: pma-cr shared policy, PASS with zero high-confidence findings
in the three-document delta and task-owned gate orchestration. No product or
collector behavior changed, so no new RED/GREEN result is claimed. Shell syntax
checks passed for the native gate, Docker wrapper and input-audit script;
`make docs-verify` passed at 2026-09-10T20:47:26Z..20:47:28Z, exit 0, log
`evidence/native/docs-native-checkpoint.log`, SHA-256
`8a05e614b6a6f3057988dc2ab915a7d38c1dca9b9fb13c021799786872185216`.
Scoped `git diff --check` passed. Native gate script SHA-256:
`d8f8210f4be530cc89b6440374785c5cce31338b54565c841c1b40e067d7fd4c`;
invocation-only wrapper SHA-256:
`06937c5684ce5609ca80827db639bc1bd7eb5e267f53d6e37b8723ae90bbbfd5`.

### Native package result and current root continuation

The native gate completed at 2026-09-10T20:57:03Z (started 20:48:22Z), exit 0.
A4 revalidated the full log (71,933 bytes / 1,491 raw newline lines, SHA-256
`0f2909d425c12eccb59c2fd1dc71932fb9125080a56160badb4dfd4c15311db4`),
script/metadata agreement, every entry of `evidence/native/native-pool-SHA256SUMS`
and the unchanged `9d1218e2` checkout. That checksum manifest is
`0eeb2f7f828004358d4e24cb10bec84934348801e9e92fb88fb6d8a6ac6493db`;
`native-pool-manifest.txt` is
`ef2a2f9e0d8e7dd94e15607f721b0ac6e9c008625e9b83cb0f8f32a43b749afc`.
There are 15 archives, with exactly 14 selected for the CX dev root; the extra
prod profile is not installed. No selected non-directory ownership collisions
were found. The native ELF/control/dependency record is
`evidence/native/native-archives-fields-and-elf.txt`, SHA-256
`22098d3abde7ab6215769332e552304798899fa1cbff849f9a8f4b0f8f1417d3`.

| New ARM64 archive | SHA-256 |
|---|---|
| mos-busybox | `ee631f2bd99bb69bb5f3966bf8038b0e07ca4e5f168482e5a13198bfa26d06eb` |
| mos-deploy | `3076c9fb30df3e396c087f50a40f8a7a12dab53436ec01769a42b4df681620ca` |
| mosd | `7fc6d71f6e7c276adbcdc1a1ad3f797ddcb1b48c478605110df5315b9b32bf9f` |
| mos-apid | `c683efe0c532cc995355cee4e0d1a512814197b49de7a14d6b3eae45167561cf` |
| mos-mqttd | `25525c029d3fa3ac696ed6c39e5037a8257fd8c4fa50b5577cd7b45f44438ec4` |
| mos-mqtt-broker | `1565103a51b1af1c784c79ce65919f8141e9a35831cf95987ceee9fe832b9e61` |
| mos-podman | `7c99640f84705350229d7a05d69ebfa797b12eae03a414d74c5e8cc4863c213a` |

All carry stamp `git9d1218e2689e-1`; podman's upstream version is `5.8.6`,
the other package versions are `0.1.0`. The original seven container-engine
binaries retain their explicitly inherited provenance above. The compiler
record reports target `aarch64-unknown-linux-gnu`, ELF architecture `aarch64`
and embedded commit `9d1218e2689e`; its SHA-256 is
`24f98efc3a892f4ef6d7dbe7482d6ce1d520cd612ac9d4d1ce7aba5b424fc603`.
The actual UI-output checksum manifest is
`a4c3b5665e4413c27672ee5fa4bdb8affcdd64af3f79ea3ca29aa6aafb074f03`.
Neither record establishes root execution or physical behavior.

Warnings retained, not converted into a zero-warning claim: busybox packaging
reported two `dpkg-shlibdeps: warning: diversions involved - output may be incorrect`
lines for libc6's `/lib/ld-linux-aarch64.so.1` diversion. Podman packaging
reported `dpkg-shlibdeps: warning: couldn't parse dynamic symbol definition: no symbols`,
preceded by objdump's `catatonit: not a dynamic object` / relocation diagnostics.
Actual root loader/dependency execution remains a following gate.

The next command is `bash /srv/station/work/tmp/mos/1zjiu5h5/composition-20260910-2026-z2Ljld/root-gate.sh`.
It runs the unchanged `make os-rootfs-cx3576` / `rootfs/build.sh` with
`MOS_BOARD=cx3576 MOS_PROFILE=dev WITH_MOSD=1 WITH_CONTAINERS=1`, the committed
`wifi bluetooth` selection and only `inputs/meta` as public defaults. There is
no size-budget override, feature decline, stale pool bypass or smoke opt-out.
The immutable source remains `9d1218e2`; no package or kernel rebuild is needed.
Fresh root output is `source/_out/cx3576/`, with recipe-owned local Debian cache
under `source/_out/debian-base/`. Root gate metadata/log are
`evidence/root/root-gate.json` and `evidence/root/root-gate.log`; the build log
is `evidence/root/root-build.log`. The gate checks source/pool immutability and
retains root, verity, composition, debug and OCI records for final collection.

Bun 1.4.0 is copied mechanically into `tools-root/bun` from the committed
`IMAGE_BUN_1` digest, rather than installed globally. Binary SHA-256:
`33d56b070be6a9e3da0ab013038b43d1645d0534ca811ecdba4472599117eb4b`.
Docker invocations carry task labels/names and narrow mounts. The existing
shared factory-root alias is preserved: a separate `evidence/root/load-copy/`
OCI archive changes only index name annotations to
`ai-agent/mos-a4-factory-root:cx3576-9d1218e2`. Original output bytes stay intact;
manifest/layer content digests, both archive hashes and annotation mapping are
checked/recorded. The existing smoke verifier still identifies and executes the
image by the original content digests, with its original failure semantics.
The task wrapper's metadata-only archive operation passed a focused host fixture;
that fixture is not a root, loader, device or hardware test.

Actual new-root inspection must still establish the packed layout hash
`683ce0839962ae2cf8f016e05f7d6fcde27bc6ffe39dda58b42bdbd676ae3414`,
whole writable bounded `/var`, zero byte/inode application limits, private
container storage/tmp binds, reset isolation, authenticated tty2, installed
units/tools and loader closure. Support/FIT/signatures/fresh records/full image
and candidate-specific negative/readback/offline checks remain subsequent work.
The pending reviewed C.D4 endpoint verifier is a separately identified tool for
this actual candidate after L1's exact handoff, not a dependency of root
construction or a reason to import C payload. Its S905 sample cannot qualify
this candidate. All physical rows and NPU ownership remain unqualified; optional
historical D5 remains nonblocking. Earlier completed collector/kernel tracking
and the composition phase's in-progress state are preserved.

Root checkpoint review: pma-cr shared-policy review of the actual three-document
delta and private orchestration, PASS with zero high-confidence findings.
No product or collector behavior changed; new product RED/GREEN is not claimed.
`bash -n root-gate.sh bin-root/docker` and the metadata-only archive fixture
passed. `make docs-verify` passed at 2026-09-10T21:10:00Z..21:10:02Z, exit 0,
log `evidence/root/docs-root-checkpoint.log`, SHA-256
`8a05e614b6a6f3057988dc2ab915a7d38c1dca9b9fb13c021799786872185216`.
Scoped `git diff --check` passed. This review does not pre-approve root results
that do not yet exist; gate startup and terminal metadata remain separate.

### Root acquisition failure and authorized recovery retry 2

The first root gate ran at exact `9d1218e2` from
2026-09-10T21:11:38Z to 21:21:41Z, exit 2. The 15-archive pool and 14-package
CX dev resolution passed, but the first missing runtime archive acquisition
hit the unchanged 600-second ceiling:

```text
debian-base: error: download exceeded the 600s ceiling and was killed: https://snapshot.debian.org/archive/debian/20260905T000000Z/pool/main/a/adduser/adduser_3.152_all.deb
make: *** [Makefile:70: os-rootfs-cx3576] Error 1
```

No root installation, pack, smoke or signed candidate completed. This is an
acquisition failure, not a demonstrated package, kernel or hardware defect; the
evidence does not distinguish network delay from a stalled download process.
The full `evidence/root/root-gate.log` is 1,158 bytes / 28 raw lines, SHA-256
`277d9af70aa8492387077de85a07a1d2b6609929ba25056a33bb5723972d72f9`;
`root-build.log` is 802 bytes / 22 raw lines, SHA-256
`f9e6adc21ef42c604c563666acbf7521585ad1c48232e2f876fe113434daa788`.
Original script, wrapper, terminal metadata and logs remain unchanged, bound by
`evidence/root-recovery-2/failed-gate-SHA256SUMS`. The three partial output files
(package selection and public-meta copies) are preserved, with their paths and
hashes recorded, by moving only the owned `source/_out/cx3576/` directory to
`evidence/root-recovery-2/failed-root-output/`. Nothing from an external cache
was moved or deleted; the private cache's original helper is preserved.

The L2 recovery dispatch explicitly authorizes retry 2 in this same issue and
requires a changed input condition. The current manifest renderer selects 172
ARM64/all runtime archives plus one debootstrap helper. All 173 exact inputs
were found and verified before copying: 172 from
`/srv/mos/tmp/s905x5m-current/source/_out/debian-base/debs/`, plus the already
valid helper in the private cache. The other two allowed cache locations were
not needed for recovery. Validation checks current-lock SHA-256, Package,
Version and Architecture. The strict lock schema has no separate size field;
after cryptographic identity verification, actual byte sizes were measured and
required equal at the destination. Total selected bytes: 53,411,310.

The failed `adduser` input is version `3.152`, architecture `all`, 190,932 bytes,
SHA-256 `e50984d2e1ef6300e3fd51303839842189a077b10cb5cadff1923df10c61c493`.
Its current `rootfs/debian/packages/adduser.json` hash is
`8249577c1771167a46649d522108d9a4d043e242577904b4c24ec8fce6dee520`.
Only validated Debian upstream archives were copied to the existing supported
`source/_out/debian-base/debs/<sha256>.deb` locations, under the cache lock.
No old MOS package, root, image, source or signing input was imported or relabelled.

Recovery evidence under `evidence/root-recovery-2/`:

| Evidence | Result / SHA-256 |
|---|---|
| `cache-recovery.log` | `timeout 45 bash cache-recovery-2.sh`, 2026-09-10T21:34:58Z..21:35:04Z, exit 0; `3f851b0f2f21c5cf287aa5226054569664a000bf9f15a1be0600c3a1d27110b7` |
| `cache-copy-map.tsv` | 173 per-archive source/destination/lock/version/architecture/hash/size mappings; `e34b9ce84d35dd6d0b51599b1fbefc9fe5766cb2106b87449385f2ed2a6ae2e8` |
| `recovered-cache-SHA256SUMS` | All destination hashes revalidated; `e7468fd99b57c19d748c4fe80e69d77ca5094e9afd16a1ed32ab9e05c0674112` |
| `cache-verify.log` | Original `rootfs/debian/docker.sh verify --arch arm64 --packages evidence/native/resolved-packages.txt`, pinned labeled container, network disabled, 21:35:41Z..21:35:43Z, exit 0; `e469e9166d1797f2f2d9740650ae9e31f9f1b6be5afc7ed8d3d5c4fc6f33aca1` |

The unchanged verifier reports 172 runtime packages and also checks the helper.
This is a complete acquisition-input pass, not a root or runtime pass. No blind
network replay was needed; the original snapshot/version/hash pins and 600s
ceiling remain unchanged. Policy/native/kernel gates remain valid and unrerun.

Prepared recovery command:
`bash /srv/station/work/tmp/mos/1zjiu5h5/composition-20260910-2026-z2Ljld/root-recovery-2-gate.sh`.
Fresh metadata/log/build log are `evidence/root-recovery-2/root-gate.json`,
`root-gate.log`, and `root-build.log`; the new wrapper's load-only OCI copy also
lives under that recovery evidence directory. The root recipe, source identity,
selected packages, dev/radio/public-meta inputs, size/smoke gates, shared-tag
safety and single-heavy-job limit are unchanged. Additional pre/post guards
verify the recovered cache and immutable failed-attempt evidence. The new root
still requires actual artifact semantics, smoke-row classification and later
support/FIT/records/image gates. All physical/NPU rows and optional D5 retain
their prior classifications; C.D4's exact tool handoff remains a later scan input.

Recovery checkpoint review: pma-cr shared policy, PASS with zero high-confidence
findings in the actual three-document delta and private cache/gate orchestration.
The input recovery changes no product behavior; the recorded RED is the real
acquisition gate above, while the cache verification is GREEN only for inputs.
`bash -n` passed for all three recovery scripts. `make docs-verify` passed at
2026-09-10T21:38:19Z..21:38:20Z, exit 0, log
`evidence/root-recovery-2/docs-recovery-checkpoint.log`, SHA-256
`8a05e614b6a6f3057988dc2ab915a7d38c1dca9b9fb13c021799786872185216`;
scoped `git diff --check` passed. The recovery gate script is SHA-256
`9a802f299105624a16e5bff70629ec5bfbdca9086ff1b0cc3fefe5f210b0607e`,
and its invocation wrapper is
`a1fc7e2561139a0c51839c36a3dc84b6766ed35bc7b52fd970a027798ee57929`.

### Recovery retry 2 terminal collection — composition blocked

The recovery root gate ran at immutable source
`9d1218e2689eb5e3fce99ad1736f3a1fdc8c8801`, tree
`0a1c2b4ddd86945961da16cc6d4d268e636f2273`, from
2026-09-10T21:39:53Z to 21:48:19Z, exit 2. Command:
`bash /srv/station/work/tmp/mos/1zjiu5h5/composition-20260910-2026-z2Ljld/root-recovery-2-gate.sh`.
The script hash remains `9a802f299105624a16e5bff70629ec5bfbdca9086ff1b0cc3fefe5f210b0607e`.
Its metadata and actual final `GATE_EXIT_CODE=2` agree. Under
`evidence/root-recovery-2/`, `root-gate.log` is 88,886 bytes / 1,357 raw lines,
SHA-256 `ffaa21625a4b9f65a0a648e8cc71ea67e8f4402c418c197cd731a8a49e2cdb1b`;
`root-build.log` is 88,530 bytes / 1,351 raw lines,
SHA-256 `f73c15a4905ece781335abe494d9258fcde8d6a6f64fbc4a4093ce7fed011c44`.
PID 1651526 is absent. This is a terminal RED, not a successful root gate.

Cache recovery did work: the original recipe reports 172 packages verified,
zero archives downloaded, 68 bootstrap packages installed, and 14 local packages
composed into a 186-package root. Both `10-compose` and `90-pack` emitted
outputs; their stage content hashes are respectively
`6196ed100a05dae8933fe89f031a12442118ad6bf855620eeac585b20458e335` and
`c54d255aadd41069f633a9d312abb4cd5b259d18e68c4d6497613cfb28a2f796`.
The recipe passed its 254 MB installed-size / 400 MB budget check, then the
mandatory smoke path stopped before executing any packed binary:

```text
error: docker load -i .../source/_out/cx3576/factory-root.oci exited 2: tar: Skipping to next header
tar: Exiting with failure status due to previous errors
make: *** [Makefile:70: os-rootfs-cx3576] Error 1
```

#### Emitted bytes, not a signed or runtime-qualified root

Read-only terminal evidence is under `evidence/root-terminal-collection/` in
the same private composition directory. The eight-file
`emitted-artifact-SHA256SUMS` has SHA-256
`591ab92e2308b1d2c9dc070c96dcd73a505405d19fc2625c787aa4a7c2071b5d`.
The original archive, failed copy, scripts and full logs were rehashed before
and after inspection; no failed evidence, cache, pool or source was overwritten.
The source remains tracked-clean; its post-collection tracked-file manifest is
byte-identical to `source-files-before.txt` (`79f1af52...d8b33`).

| Emitted artifact / member | Bytes | SHA-256 |
|---|---:|---|
| `source/_out/cx3576/factory-root.oci` | 87,746,048 | `d23db6942e49b002aee615d60027a962eaf4752097d09755a7eae55529365f5f` |
| `source/_out/cx3576/rootfs-verity.img` | 76,947,456 | `1ff6626307d43294aa6c01777ce1e2a8c0478e06d9630e9f890a87545f662569` |
| Squashfs prefix of that image (not a separately emitted file) | 76,337,152 | `00f9ef0994a2249c65f353e040f0e4de5abaae46842a47949b8006f4efad1f0a` |
| OCI manifest blob | 566 | `1cfe2b6af1505f84fca72a956407de0ede9ea451a687e88abdabfe6277934e5c` |
| OCI config blob | 519 | `e792668a72fda93591ea7391175b88e2d9cfcc00e6d175a3d8af02f622de380d` |
| OCI gzip layer blob | 87,738,135 | `b81521445d696de35197f123a526fc98d7a716911ae7efad16f93de61a1e95f1` |

All three original blob hashes and descriptor sizes match. The layer's observed
uncompressed digest `30f90114a0d5c02b03a9ef4c9b770358ad29752f3057b76bd4b2a03f3521fa71`
matches the OCI config; its labels bind ARM64/Linux content to source `9d1218e2`.
The verity record reports SHA-256, 4,096-byte data/hash blocks, 18,637 data blocks,
hash start block 18,637, 149,096 data sectors and fixed salt ending `0001`.
Recorded root hash:
`1282f27ad8be31cc941b43baccb180602a53827443f88a3ae623422ce06e28df`.
This is emitted geometry/root-hash evidence, not a content signature, fresh
deployment record, runtime verity test or complete SYSTEM image.

The completed pack log records CJK, build-residue, disposable-var,
extension-directory, shadow-chain and privileged-file assertions, boot export,
debug splitting and verity generation. Twelve of 1,050 ELF files were stripped
and their debug files exported. Retained diagnostics include mksquashfs
`Unrecognised xattr prefix system.posix_acl_access` and
`system.posix_acl_default`, plus Docker `InvalidDefaultArgInFrom` warnings;
these are not a zero-warning pass. The earlier three dpkg-shlibdeps warnings
also remain open for actual root loader/runtime assessment.

Selective extraction from the original OCI, without executing its files,
confirmed the current `mos-data-layout` hash
`683ce0839962ae2cf8f016e05f7d6fcde27bc6ffe39dda58b42bdbd676ae3414`.
Its project 100/102 byte and inode limits are zero; project 101 bounds variable
data to 32..256 MiB and 2,048..16,384 inodes. Installed `var.mount` binds the
whole `/var` privately from DATA. The separate private container bind uses
DATA/containers, graph storage `/mos/containers/storage` and image-copy tmp
`/mos/containers/tmp`. These installed settings support the intended isolation;
actual mounts, quota enforcement and reset isolation are not runtime-verified.
The actual public manifest matches input hash `a30e535b...74ce00`. Installed
logind reserves tty2 with `NAutoVTs=0`; the extracted getty template invokes
agetty/login without autologin. No login or VT switch was executed.

The 16 extracted files have checksum manifest `packed-file-SHA256SUMS`, SHA-256
`7b6cf661942693499dc49ccf77bbc4b850d963a653850c5cce1a0ae73f34d0e1`.
Actual packed ELF hashes are: mosd
`c51f63b2cfcd3ea385ed454d457eb3bfae2c43ba0bd7cccbfc5bf310fec570c5`, apid
`8ebf33df0f439ebcb384c2cd3f560825084e2330d1a9504b8e326fb7118d29ef`, and mos-mqttd
`44961a4f53b1d702e7450cc6cb4c3c3a010343ff46f0ac361cc38e06566e23f0`.
Readelf identifies all three as ELF64 AArch64 with interpreter
`/lib/ld-linux-aarch64.so.1` and NEEDED libc, libm and libgcc_s. Reading those
fields is not loader resolution, execution or the pending C.D4 endpoint scan.

#### Adapter failure boundary and proposed recovery (not implemented)

The original OCI lists all seven members with exit 0 and valid header checksums.
It contains only two directories and five regular files, including the three
content-addressed blobs; there are no outer links or sparse members. The failed
load-only copy is 87,746,560 bytes, SHA-256
`83e4c61d449047d3b01e40707ce6cff680f4755155ca6ea293eabd4340fafa27`.
Its `tar -tf` exits 2. Read-only byte comparison proves:

- The first difference is byte 87,735,808 (512-byte block 171359), inside the
  gzip layer, before the requested index edit. That original block is absent
  from the copy; the following bytes through the config move 512 bytes earlier.
- The unchanged layer header still declares 87,738,135 bytes. Reading that
  declared payload from the copy hashes to
  `98c375c82c2618eddb81c34ddbeeb5b41136578ecbd34923cb9b741b7b1aae81`, not its
  content-addressed name. The config header moves from block 171370 to 171369,
  inside the preceding member's declared span, so tar misses it as a member.
  The config bytes at their shifted position still hash to the correct digest.
- The original index was removed and the 651-byte replacement is present at
  block 171374. No `members-*` or final checksum file was produced. With the
  wrapper's `set -e`, this places failure in the edit/append path before its
  final validation and real `/usr/bin/docker load` at line 62.

The implicated owned adapter is `bin-root-recovery-2/docker:48-50`: copy,
`tar --delete`, then `tar --append`. GNU tar is 1.34. The original archive has
171,379 blocks (19 modulo 20), while the failed copy has 171,380. These measured
boundaries locate the corruption; they do not establish the internal tar
implementation cause or prove product-root corruption. The previous small
namespace fixture did not cover this emitted archive boundary and did not
protect against this failure. Full raw headers and slice-equality results are
in `tar-boundary.json` and `tar-relations.json`; the latter has SHA-256
`54e34f9093311c5d31d3e26d144f6d2a6b67f20bf0f023558d767fcd511a00e4`.

Minimal proposal for L1 through L2: replace only the task adapter's in-place
edits with a fresh load-only archive reconstructed from this readable original,
preserving every original member's content and metadata except the two approved
index tag annotations. Before any load, compare member sets, header validity,
descriptor sizes, all blob hashes, unchanged annotation fields and original
archive hash. Use the actual large-member/tail boundary as the RED fixture,
then prove reconstruction GREEN; a tiny regular-tar fixture is insufficient.
This is structurally suitable for the observed simple seven-member OCI, but
Docker acceptance remains untested. If approved, run the unchanged smoke entry
against the original root record with content-digest identity and task-only tag
isolation; refuse tag-only identity as exact evidence. No package, kernel or
root rebuild is justified by this adapter defect. No correction, new archive,
Docker load, smoke run or retry was performed during terminal collection.

Composition is BLOCKED: retries 2 of 2 are exhausted, and L1's concrete recovery
decision must arrive through L2 before further execution. Root smoke, actual
loader/service/device closure, signed root/support/FIT, fresh records, full-image
layout/signature/negative/readback gates and the exact C.D4 candidate scan remain
open. All mandatory CX/S905/original-device hardware rows remain unqualified;
A coordinates, A4 integrates, and physical operator/bench/current-image inputs
are still missing. NPU ownership is OPEN; historical optional D5 is nonblocking.
Heavy jobs: zero. The idle persistent shell 1460561 / `1zjiu5h5-a3c184` and all
source, package, cache, build, archive and failed evidence resources are preserved.
No running labeled container was observed; nothing was deleted or retagged.
D's history note is this partial packed-root milestone and adapter blocker,
not completed composition or a hardware qualification.

Terminal review: pma-cr shared-policy review of the actual three-document delta
is PASS, with zero new documentation findings. The separate owned adapter has
one confirmed HIGH data-integrity finding at `bin-root-recovery-2/docker:49-50`
(WARNING); it remains explicitly unfixed pending L1, and the earlier fixture
PASS is not an actual-archive acceptance. No new executable change or GREEN
recovery is claimed. `timeout 30 make docs-verify` passed on
2026-09-10T22:14:20Z..22:14:22Z, exit 0; terminal evidence log
`docs-terminal.log` SHA-256
`8a05e614b6a6f3057988dc2ab915a7d38c1dca9b9fb13c021799786872185216`.
Scoped `git diff --check` passed. This review/gate qualifies documentation only.

### L1-authorized adapter recovery — 2026-09-11

L1 approved the concrete `b071e6b5` / terminal `review.md` recovery proposal
after the user's instruction to fix this original-scope adapter defect. This
resolves the preceding decision blocker without erasing either failed gate or
granting an automatic retry. The clean own branch fast-forwarded to exact local
L2 `de482086b0f3edbf7f09d28648e0694dc1acddfe`, identical tree
`55e086dc78a86c4a214a281e8b98826ffd7e6f96`. Artifact source stays `9d1218e2`;
passed kernel, packages and emitted root must not be rebuilt for this defect.

New task-owned work is isolated at
`/srv/station/work/tmp/mos/1zjiu5h5/composition-20260910-2026-z2Ljld/adapter-recovery-20260911-edC647/`.
The approved fix streams a new load-only OCI archive, preserving member/PAX
semantics and content-addressed identities while changing only the two approved
index tag annotations. The original and corrupt copies remain immutable.
Actual large-layer RED, original positive control, reconstructed GREEN and
pma-cr Python/shared review must precede real loading. Then run the existing
`verify/run.sh --smoke --board cx3576 --builder mos-rauc-arm64` at the original
source, never `make os-rootfs-cx3576`, with task-only Docker resources and
content-digest identity. Smoke outcomes are not pre-approved.

The exact C tool handoff is now supplied and checked: commit
`48acef7f1a3683b1f3bb6261911b1a5123197da2`, tree
`553c1e7af96203315f79e7ea61e862f7a753e3a5`, reviewed delivery manifest hash
`380dcfacb6d366e8fd1280e21d4be74196cc2e40afad26fbb54f8cbf76c2ca3c`.
Its two verifier blob IDs match L2's handoff. It will be used separately as a
read-only tool, not imported into this candidate. The actual native-endpoint
obligation scans mosd, apid and **mos-deploy**, not mos-mqttd; the earlier MQTT
hash remains true but does not satisfy that third-file obligation. The later
authenticated full-image scan and candidate identities are still pending.
No C suites, sibling payload or source changes are needed for this adapter fix.

Pre-load result (2026-09-11T00:38:02Z..00:39:43Z): original positive control
`timeout 20 python3 oci_check.py ORIGINAL` exited 0. The same command on the
preserved actual broken archive exited 1 with the large gzip layer hash
mismatch; `actual-red.log` SHA-256
`ce718ce16155003e922099c1d55023c96748a843094b2bf9cbb95c4debb014af`.
`timeout 25 python3 rebuild_oci.py ORIGINAL NEW_COPY` and independent
`timeout 20 python3 oci_check.py NEW_COPY ORIGINAL` exited 0. Seven focused
host tests passed, including PAX metadata/size round-trip and unsafe/duplicate/
existing-output refusal. No image binary or Docker load ran for these tests.

The fresh `factory-root-load.oci` is 87,746,560 bytes, SHA-256
`e33b3b158204161bdae4f2cce3f35da7b79f50e6f32fceacd08b8b4cb54f1f12`.
Its seven-member GNU tar listing passes; config remains at block 171370, index
is 520 bytes and oci-layout moves to block 171376. Original manifest/config/
layer digests, member content and effective metadata remain exact, including
PAX semantics. Only the two permitted index annotation values and consequent
index bytes/size differ. `independent-green.json` SHA-256 is
`c2b1730d149739dfc13857e699a1eb8e32f1fe8eb56cf2779cb6fac83925fdd3`;
`unit-green.log` is `5f45df6dd67d7cf2786478bdaf3cb345190a8191bb0b3a9e9375bafdc83d9e16`.

The actual required third ELF was now extracted read-only from the original
OCI: `/usr/bin/mos-deploy` SHA-256
`fa8b7c9e1f3732a3c9a325442f17febe982a766981efbd8fb4554ced8ded3857`,
ELF64 AArch64, interpreter `/lib/ld-linux-aarch64.so.1`, NEEDED libc/libgcc_s.
The mosd/apid hashes match the earlier terminal collection. Their three-file
manifest `candidate-required-ELF-SHA256SUMS` has SHA-256
`da73f13d3be6b3486f9019e069d221425df04de89864b3a697d1ba1291dc2499`.
This corrects the candidate-input mapping; no C scan or loader PASS is implied.

Pre-load pma-cr shared/Python review of the actual new adapter, harness,
invocation wrapper and gate is PASS with zero outstanding findings; the old
HIGH finding is addressed by streamed construction and actual-archive evidence.
`pre-load-review.md` retains the review boundaries. The wrapper rechecks hashes
and original content IDs before loading and refuses shared-tag-only identity;
all real Docker resources are task-labeled and isolated. Syntax checks pass.

Prepared next command:
`bash /srv/station/work/tmp/mos/1zjiu5h5/composition-20260910-2026-z2Ljld/adapter-recovery-20260911-edC647/smoke-gate.sh`.
Gate script SHA-256 `2636c6f09ec9b5bc22fb5f658ea147c146c0c506e975e8e667b6bb26e91211c8`.
The gate directly runs unchanged `verify/run.sh --smoke` with the original
record and pinned Bun; its own 1,800-second ceiling does not relax any existing
per-operation timeout. Live/final `smoke-gate.json`, `smoke-gate.log` and
`smoke.log` retain source, documentation checkpoint, PID/session, command,
timestamps and exit. The persistent shell is reused only after an idle check.
No root/package/kernel rebuild, signing or physical execution is claimed by
this adapter GREEN. L2 collects the detached smoke result before continuation.

### Original collector/kernel tracking

- Campaign: `mos-open-plans-20260910-100408`; issue: `1zjiu5h5`; coordinator: `6064wf7l`.
- Full-tier approval and scoped local commits were supplied by the campaign dispatch. Compatibility, migrations, RAUC, raw-slot and old-package support are excluded.
- Required upstream `bkd/6064wf7l` at `a39807d8392f0838e6e5438e3e57518f9b1bdd81` was merged before investigation; the exact upstream is an ancestor of this branch.
- Write scope is this task/plan pair and index entries, `docs/bsp/cx3576-bench.md`, `docs/bsp/cx3576-bench-collect.sh`, and focused tests under `tests/cx3576-bench/`.
- Product, shared verifier, lifecycle, packaging, sibling records, global indexes and changelog remain read-only. Failed product gates are reported to L2 rather than repaired here.
- Hardware rows cannot pass without a confirmed current-image bench. Historical, simulated and other-board evidence remains separately classified; historical display row D5 is optional and superseded by current serial-only console policy.

## Collector correction

Collector v3 binds every operational stage to a canonical public identity file
containing the exact source commit/tree, image name/hash, verification record,
profile, board/radio revision and operator-identified system block device. It
refuses missing or changed run bindings and has no API or block-device default.
API URL and dry-run mode are also immutable within a run; each invocation keeps
a new capture directory. The same run retains optional failed-unit names while evaluating only the
current required-health set over a 180-second window, captures the current quota
and container-isolation contract, uses RockUSB/maskrom recovery rather than a
rescue image, and reports all 39 logical rows. Historical D5 remains optional,
superseded and unable to block later stages.

Reviewed A3 commit `209982d98f83ef149d2c3850adc63debc42f4c5a`
replaces A2's earlier init-only/no-redraw software baseline. Its host fixtures
were source-level evidence before the coherent ARM64 build recorded below;
that build has now passed, while D1-D4 still require exact-image observations.

## Software evidence before coherent kernel build

| Check | Result | Evidence |
|---|---|---|
| Collector RED | expected failure, exit 1 | `timeout 30 bash tests/cx3576-bench/collector-test.sh`, 2026-09-10T11:49:03Z; 11 assertions exposed guessed identity/API/media, obsolete health/storage/recovery behavior and missing 39-row coverage; `/srv/station/work/tmp/mos/1zjiu5h5/collector-red.log` SHA-256 `60505cc0ed2a1d49bb6d0f0ec3a268533aff5f11e2ef35258470d4c35245083c` |
| Collector GREEN before interruption | passed, exit 0 | Syntax plus focused explicit-binding, immutable-run-binding, required-health, optional-failure, 180-second call, recovery/storage and exact 39-row checks; 2026-09-10T12:21:31Z..12:21:32Z; `/srv/station/work/tmp/mos/1zjiu5h5/collector-green.log` SHA-256 `ee19f8e5dc9a9415c4b777e1503f1004bd0626489606a5fe040ff8a7fae858b1`. |
| U-Boot watchdog guard | passed, exit 0 | Pinned `ece349ade2973e220f524ce59e59711cc919263f` source with the applicable committed patch effects; driver probe, both clock gates, arm/feed/refusal and RockUSB servicing passed. Log `/srv/station/work/tmp/mos/1zjiu5h5/uboot-watchdog.log`, SHA-256 `822efc78421aba2776aa4081255c909c567bb56086bced2a1652645dcea765dc`. |
| Netavark kernel policy | passed, exit 0 | `make os-netavark-kernel-test`, 155/155 assertions; `/srv/station/work/tmp/mos/1zjiu5h5/os-netavark-kernel-test.log` SHA-256 `482b49db7b7e7a9c5fe818e9af939c0a822994d6340ac0a3e7ed1706531612b3`. |
| Documentation before interruption | passed, exit 0 | `make docs-verify`, 2026-09-10T12:21:32Z..12:21:34Z; `/srv/station/work/tmp/mos/1zjiu5h5/docs-verify-precommit.log` SHA-256 `567fab99a3d4b4529298d6701e16adfe8060a6b68747bec265d0ed151facda62`. |

### Recovery checkpoint and scoped review

Recovery retry 1 preserves the original owned delta and claimed records. The
previous execution exited 137 / SIGKILL at 2026-09-10T12:52:08.215Z; its cause is
unknown. No coherent kernel gate had launched, and that process exit is neither
a kernel failure nor a hardware result.

Actual local-diff review used the shared pma-cr policy for shell/documentation;
no language-specific pack applies to the changed files. Four introduced
evidence-integrity defects were reproduced before correction: stale health logs
hid a currently unavailable API; a run could change API; dry-run mode was not
bound; repeated captures overwrote previous snapshots. The corrections add
live GetState and healthz probes before/after the 180-second window, immutable
API/mode binding and unique capture directories. An additional fixture checks
API loss after the window. Host stubs do not constitute elapsed board health.
The resulting scoped review had no remaining findings. At that checkpoint,
full kernel and physical verification were pending and not covered by the
collector review; the completed kernel result is recorded separately below.

Recovery evidence root: `/srv/station/work/tmp/mos/1zjiu5h5/recovery-1/`.

| Check | Result and exact evidence |
|---|---|
| Recovery RED | `timeout 30 bash tests/cx3576-bench/collector-test.sh`, expected exit 1 with four assertions at 2026-09-10T19:04:33Z; `collector-red.log` SHA-256 `c2193b7af20e04adced1eaa411d85bb5c9bbb95f14850f5ccc17db0edd8694e6`; `.started` / `.exit` preserve available metadata. |
| Recovery GREEN | `timeout 45 bash tests/cx3576-bench/collector-test.sh`, exit 0, 2026-09-10T19:10:39Z..19:10:43Z; `collector-green.log` SHA-256 `ee19f8e5dc9a9415c4b777e1503f1004bd0626489606a5fe040ff8a7fae858b1`; `collector-green.json` records command/time/base identity and the owned uncommitted delta. |
| Current cheap guards | Collector syntax, `make os-netavark-kernel-test` (155/155), `bash boards/cx3576/bsp/uboot/tests/watchdog.sh /srv/station/work/tmp/mos/1zjiu5h5/uboot-watchdog-fixture`, and `make -C boards/cx3576/bsp source-check` all exit 0 at 19:10:39Z..19:10:43Z. Individual logs and JSON metadata use `syntax`, `netavark`, `watchdog`, `source-check` stems. The watchdog fixture contains only the four applicable pinned source files, not a full U-Boot build. |
| Final documentation and scope | `timeout 45 make docs-verify`, exit 0; `docs-final.log` SHA-256 `8a05e614b6a6f3057988dc2ab915a7d38c1dca9b9fb13c021799786872185216`, exact UTC times in `docs-final.json`. Test-script `bash -n` and the owned non-patch delta whitespace check also pass. This does not assert whole inherited patch-file whitespace. |

## Inherited S905X5M artifact evidence

The following read-only identities were re-hashed locally. They are inherited
from #313/L1, not tests executed by A4:

| Item | SHA-256 / identity |
|---|---|
| Approved committed source | commit `5d0dca577a782aa707d9530779c4b23f2a7eda31`, tree `a8b079edc67010b6662b2243a5647950eb7176ef`, mapped source SHA-256 `5eab1647263866e310b98999e9d5df063aa6bbe3248fc8a0bd7ee7a907c75b42` |
| `source-record.json` | `cacf0f2b2b2054b0b3227055aa298c33b785eaaec3ef42e80a46b12c2a00cd53` |
| `committed-source.json` | `ce4330ed3845acf77e5e7f061d62255761eed80d21172211139ca7dc6180cd7c` |
| `SHA256SUMS` | `98d6b7c5f6041d8339cded9f6faeae46295b1b662e61db29817bfd63cba831f7` (the inherited 56 entries were verified by L1) |
| SD image | `image/mos-s905x5m-20260910-100627.img` = `f7f3c7076b3ef345dc07ba5203029bca9695fccdaa3cbb9a0df9b685c745b30a` |
| Paired boot0 firmware | `image/firmware.bin` = `1cb9f846112a2ae0e6fbec98426d754bb98ddee002e2c23667bec69fe8d8fbc8`; paired `image/firmware.json` must remain beside the image |
| Recovery image | `recovery/update.img` = `09486dc6d8453e621ac8efda05148887c0018b6b6fb47ccb4a84fd403bda431d` |
| Signed update | `s905x5m-dev-3.mosupd` = `93436da3f8cf67d836379aeef7119914983c9a0c4d4fbedc2f86c139eea391b5` |

These are development artifacts stamped
`0.1.0+git5c61f7fbb558.dirty-1` / `5c61f7fbb558-dirty`. The immutable mapping
proves source-content equivalence to the approved commit; it is not a clean
rebuild. `BOARD_RELEASE_TARGET=0`, the SD image requires its paired firmware in
unique eMMC boot0, and no physical board was flashed.

## Exact-image physical acceptance state

No confirmed bench endpoint, current flashed image, storage identity or power
rig exists. Consequently no mandatory physical row is complete:

Coordination is assigned to L2 A #315 (`6064wf7l`); A4 #325 (`1zjiu5h5`)
integrates execution/evidence. Issue assignment does not identify a physical
operator. For S905X5M, valid obligations from PLAN-910/911/912/915/916 and
RFCT-932/934/944/945 use only the approved #313 signed-file contract and immutable
identities above. No old card installer, raw slots, full eMMC OS installer or new
application/fleet platform is included.

| Surface | Current result | Exact admission evidence still required |
|---|---|---|
| CX3576 install, first boot and 180-second health | blocked | A clean-source newest complete signed image and public verification record; authorized CX3576-Z/AIC8800D80 unit; explicit RockUSB target and system medium; full flash readback; serial from reset through five cold 180-second required-health windows. |
| CX3576 reboot and power-off | blocked | Authenticated admission plus complete serial exitrd teardown; three warm boots and a separate power-off/later physical power-on, each bound to new boot IDs and 180-second health. |
| CX3576 watchdog handoff | blocked | A supported pre-PID-1 hang point and uninterrupted U-Boot arming, Linux takeover, PID 1 ownership and expiry trace. The collector deliberately does not invent this mechanism. |
| CX3576 watchdog expiry | blocked | Confirmed local bench watchdog, external timing/serial/power trace, spent native attempt and readable reset cause after post-PID-1 hang. |
| CX3576 recovery | blocked | Authenticated recovery/reset survivor digests, refusal of unsupported destructive actions, induced invalid/exhausted native records, observed RockUSB selection and exact-image maskrom reflash/readback. |
| CX3576 HDMI/VT | blocked | Named sink/connector/mode and USB keyboard; connected boot, authenticated tty2, return-to-logo and headless late-attach observations on the exact image. A3 host fixtures do not establish board pixels or kernel lock scheduling. |
| Historical D5 panic screen | superseded / optional observation | No pass is required and it blocks no stage. A screen state may be recorded during the existing watchdog crash, but no additional crash or renderer is authorized. |
| CX3576 accelerators | blocked | Named versioned NPU model/runner/input/digest, encoder input/codec/output check and decoder bitstream/frame check; repeated hardware use with MMIO/IOMMU, binding, clocks, resets, power and error evidence. NPU MMIO ownership and both VENC cores remain explicit obligations. |
| CX3576 network, radio, USB/CAN, RTC and thermal | blocked | Both Ethernet mappings and traffic; controlled AIC8800D80 AP/regulatory evidence; named Bluetooth peer/profile; isolated local CAN peer plus USB host/gadget; ten-minute RTC loss; enclosure-bound sustained load/cooldown. |
| CX3576 storage/update/power cuts | blocked | Current namespace quota/write/isolation evidence; signed root-only, kernel-only, combined, failed-health and firmware cases; externally timed physical cuts at every publication/record boundary. |
| S905X5M paired install and boot0 selection | blocked | Named S905X5M unit and target, exact dirty-stamped image plus adjacent `firmware.json`, verified paired firmware install/readback to unique eMMC boot0 and real recovery selection. The SD image cannot boot with stock firmware alone. |
| S905X5M startup/display/input | blocked | Cold/warm boot on the named image, uninterrupted serial at 921600 baud, HDMI and USB-keyboard observations. |
| S905X5M watchdog and peripherals | blocked | Real watchdog handoff/expiry/cause plus Ethernet, USB, Wi-Fi, Bluetooth, audio, panel and RTC fixtures and checked operation. |
| S905X5M controlled peer and MQTT | blocked | Named controlled BLE peer, profile/workload and expected exchange; the existing MQTT path's confirmed broker/endpoint, credential admission, topics and payload/result fixture. Record networking, peer and workload inputs separately; offline suite results establish none of these physical rows. |
| S905X5M storage/runtime | blocked | Actual DATA growth, `/var` persistence and current quota/isolation measurements; native crun on capable hardware because the inherited QEMU case was executor-limited. |
| S905X5M update interruption and shutdown | blocked | Signed-file update/fallback on the paired image, real storage-power cuts with external boundary evidence, and authenticated shutdown/power return. Automated fault injection is not physical power-loss proof. |
| Original-device apid reboot | blocked | A coordinates this obligation, but the original device identity, current image, authenticated endpoint and operator/serial trace are missing. Another device or board cannot substitute for the original-device result. |

## Coherent compiled milestone

The kernel gate passed on clean source commit
`38a362cd3ce46bab6d1f04489503dca9b92b664c`, tree
`b3bb2b0e3fe90bba5f93fe346589ba627af4fd33`. Subsequent documentation commits
are not kernel rebuild identities. The complete six-patch series was applied to
vendor commit `c6157104418d012823413c02f9222f3fe123dd25`; release is `6.1.115`.
The labeled equivalent of the recorded `make cx3576-kernel` recipe used the
existing digest-pinned Ubuntu builder and retained target `build` for objects.
The explicit public verity certificate was
`/srv/mos/_out/boards/cx3576/verity-trust/101209c31085b09853c688d64c374d899ab904d508a4f69f0ae9b676c4ea0212/signer.cert.pem`,
SHA-256 `101209c31085b09853c688d64c374d899ab904d508a4f69f0ae9b676c4ea0212`.
No private key was used for this build.

Evidence base `E` below is
`/srv/station/work/tmp/mos/1zjiu5h5/recovery-1/`.

| Gate record | Actual result |
|---|---|
| Command / lifecycle | `bash /srv/station/work/tmp/mos/1zjiu5h5/recovery-1/kernel-gate.sh`; 2026-09-10T19:16:56Z..19:31:44Z, exit 0; gate PID 1358217; persistent-shell tmux `1zjiu5h5-a3c184`, shell PID 1358207. Final `kernel-gate.json` and `GATE_EXIT_CODE=0` agree. |
| Complete gate log | `kernel-gate.log`, 378252 bytes, SHA-256 `5573248d7d764a89a182c4f9bf950b0b0aaea774bab4e35e46de3fa6b0a5cef1` |
| Complete build log | `kernel-build.log`, 372502 bytes, SHA-256 `8518b988ee65b1ab182901e9e68f4fbba96cd7cf89227bc4ae83e42f8d6fce5e`; actual kernel/module MODPOST and final vmlinux link completed. |
| Immutable output manifest | `compiled/SHA256SUMS`, SHA-256 `9aab7b62df43ed349728e4f24d4041b557392d28c16a20fd7ef001eee349af0e`; all 42 artifact/object/ELF/source entries revalidated. |
| Collection audit | `timeout 60 bash E/collect-final.sh`, 2026-09-10T19:52:56Z..19:53:01Z, exit 0; `collection.log` SHA-256 `a4dd91a084d9274dc1b729be34433936cfc737b1e0c271f3a3fb198cc92db3fc`; `collection.json` records command/source/time/exit. |
| Retained builder | `ai-agent/mos-cx-a4-kernel:38a362cd`, identity `sha256:2da9f07e885f4ddff2f0a66493782a6f62cc241cf11de170ad0c27f5ca78d3cb`; labels bind task and source. Contains complete patched `/ksrc` for review. |

### Final kernel and support inputs

Paths are relative to `E/compiled/artifact/`. `modules.tar` is the compiled
support input, not a signed support component or a complete root.

| Artifact | SHA-256 |
|---|---|
| `Image` (44687872 bytes) | `f0380b3ca03d61943a4aa6ace2c0378cd057ee82ff408a764dc0b19f4976519c` |
| `rk3576-src.dtb` (284944 bytes) | `912d6091cf22c6ce110eefa53b39fd8e53e64ddfb3c1a0a382559ecf1d3de39c` |
| `.config` | `b558db2876d9eacf14c547597913fd552bc923ca372053684dc15570949edf8b` |
| `modules.tar` (5529600 bytes) | `d2a760ef015217e8ab2b6fb75bf65891862025eb1f18faee2e72a311e4e3e479` |
| `regdb-certs.pem` | `a6a84c88b61d65e275549627c36d52d6ff78f57466ec1dd3ec8d6319cbaf8d2e` |
| `kernel.release` | `157ec590c0eeaa193c9f22b60379c343d9b60e12adf52db15932995c4001444e` |
| `System.map` | `f3d0352854b6eae213763a3d67719245f1406a176008e7298fe2092f31e71200` |
| `vmlinux` | `8225f314a3c8c3c386d02ae42b70d370045adacd0d7ad6a082d35892e1da7325` |

The resolved config has built-in LOGO/CLUT224, DRM/ROCKCHIP/fbdev/fbcon and
disabled deferred takeover. Forced command line retains serial-only ttyFIQ0,
required verity signatures, centered single logo and disabled cursor. These
compiled settings are not a newly signed FIT command-line verification. Current
source still reserves authenticated tty2, without tty1 getty or autologin.

### Actual objects and semantics

Objects are under `E/compiled/objects/` at their original kernel-relative paths;
full symbol/relocation/readelf reports are under `compiled/elf/`.

| Kernel-relative object | SHA-256 |
|---|---|
| `drivers/video/rockchip/mpp/mpp_rkvenc2.o` | `1f2e616c620898e5a59df48ccda38ed08f3afe3d7c8fd3ca3c42e0d121a0e625` |
| `drivers/video/logo/pnmtologo` (x86-64 host generator) | `5a8a0473a33b8613870c7d053530e4de60915cf2852217e900d8482585a970e7` |
| `drivers/video/logo/logo.o` | `4fa8fc0f0f47bd88aadcceb825c9289f8f1f814146ae72f78e6c6505b8675dc4` |
| `drivers/video/logo/logo_linux_clut224.o` | `0e095412751af8f729f4aab607cb9cdfbf2b718305237de9de4f0f4b0d29a28a` |
| `drivers/video/fbdev/core/fbmem.o` | `097af50d064a1c8a72010e00d942de1e071bf8e92cb9780016a73553bd46a2c0` |
| `drivers/video/fbdev/core/fbcon.o` | `f84fe9c94b76a07c4a0b415495af8e776694aac55c2c05247b174fd33d6a3d44` |
| `drivers/gpu/drm/rockchip/rockchip_drm_fb.o` | `6e9adbe8773ae5b15e391992c9c6fdf179deed7422ba4ea8da8e2909e3254108` |

All six target objects and vmlinux identify as AArch64. `fb_find_logo` is in
ordinary `.text`; descriptor/data/CLUT occupy permanent `.rodata`, with symbol
sizes 32/291600/669 bytes (292301 total before alignment), without init-section
references in the two logo objects. `fbcon_show_idle_logo` was inlined into
`fbcon_switch`: actual CALL26 relocations at 0x3e68 and 0x3e94 reach
`fb_prepare_logo` and `fb_show_logo`. `rockchip_drm_output_poll_changed` has a
CALL26 at 0x1c0 to `fbcon_update_vcs` with the visible-update argument set.
The encoder object retains the fixed-rate diagnostic and the guarded OPP call
chain; its integrated source hash remains A1's expected
`4ca030244b13f6355c802ecc7f941142565650cac85be93a7a74d8c3d5c9fe8f`.

The full patched-source A1 fixture passed, A3 passed 30 behavioral plus three
host ELF section assertions, and the new DTB fixture passed both encoders and
the decoder's fixed clock/reset contracts. Logs and SHA-256:

- `compiled/encoder-fixture.log`: `4fb23638dd200dd636a66de2feebe1aefc070f6ea4d212070cbd3dde31845abc`.
- `compiled/display-fixture.log`: `a651e5f2619a6678d0c5747750e3ba5c4714f6503c3e941f1b0b4e5aaa68d8e1`.
- `compiled/resource-dt.log`: `57eec2662605420d574febb5afcf98dfe2a6840e024440e008cf297af636d88b`.

NPU overlapping IOMMU/MMIO ownership remains OPEN. Neither these fixtures nor
whole-kernel compilation establishes scheduling/lock behavior, login execution,
physical display, accelerator workloads or support for framebuffer growth beyond
the original allocation. MODPOST found no section mismatch or unresolved symbol.
Preserved warning limits: 12 package-install missing-manpage warnings, vendor
`drivers/gpu/drm/rockchip/dw-dp.c:3199` `%d`/`size_t` format warning, and Docker's
`InvalidDefaultArgInFrom` advisory for the deliberately explicit base-image arg.
This is not a warning-free build and no product repair was attempted.

## Current A-baseline composition input audit

This audit does not wait for future B/C implementation. It found an actual
missing current-contract CX root, so no new complete image was composed and
candidate-only FIT negatives, image offline checks and flash readback were not
run against an old image. Two known packed roots were read with a narrow,
read-only, labeled container; `packed-root-audit.log` SHA-256
`5712ad5511caffea23f58aa301b5f113472c1475a75ce462ac52d2567c3b541e`,
with exact times/exit 0 in `packed-root-audit.json`.

| Input | Availability / exact boundary |
|---|---|
| Current CX root | **Missing admissible artifact.** `/srv/mos/.tmp/cx-storage-display/source/_out/cx-storage-display/components/root/rootfs.img` SHA-256 `2a4eb3d442592bb36c32586ff38576b9e7710b6689bc3f091e4a99b9eae62147`, component `4d8f0bb540d4e4f7a32c362c198e84c2303e3a83268ee3d0deada5eac469c776`, still has bounded projects 100/102. Its packed layout script hash is `be1d586be333f8dede0c7e7f3d3f262e59fdb3ac681ac9d8da2c0021618ea193`; current source is `683ce0839962ae2cf8f016e05f7d6fcde27bc6ffe39dda58b42bdbd676ae3414` with zero limits. The prior unlimited-data task explicitly did not rebuild the image. |
| Other known CX root | `/srv/mos/_out/cx3576/rootfs-verity.img`, SHA-256 `c7acdbb0f7eaabb7ad0293ba000024dcc6b2907f60489ea537beafc049ea2165`, is older `git97bb466792ca-1` package output; its packed script still bounds project 100 and lacks the separate container project. It is also inadmissible. |
| Native init | The old CX input at the storage-display snapshot's `_out/cx-storage-display/inputs/mos-init` has SHA-256 `92ef814981a692274bd8b1263d943ef87c338a051c47a0f872e2473c798b67f2`, attributed to `0209c4bf...`; six relevant deployment source files differ from the accepted A baseline. Do not silently reuse it. Approved #313 evidence has the newer `/srv/mos/tmp/s905x5m-current/init/mos-init` hash `33e66fbc63ee8353f0ddcee33cd53fdc504ec146824f9ad02d3d3d9329fffd5d` and build log; its original source equivalence is retained, not relabelled a clean A rebuild or used to substitute an S905 root. |
| Firmware candidate | Storage-display snapshot `_out/cx-storage-display/firmware/u-boot-rockchip.bin` SHA-256 `1386f1ce5263fa66b04ee3cab2f40d19802dac923f477f4691968b31c6a1af05`; signed `firmware.json` hash `46f83d67458ffc78d7b2889209685e428fe655bdb5ec0e3cd7cc7b553164866a`. The three core recorded CX boot source hashes match current source. This remains the inherited development firmware candidate, not a new firmware build or newly paired FIT acceptance. |
| Support | New modules and exported regdb trust are available above; the five board radio files were hashed from the committed source in `collection.log`. No new signed `support.img`/descriptor was published. Reusing old support would discard the current kernel modules and is not allowed. |
| Signing/public trust | Existing storage-display snapshot `.tmp/content-signing/signer.cert.pem` matches the compiled verity anchor. Its content private key, `.tmp/signing/boot/signer.key.pem` and `.tmp/signing/updates/signer.key.pem` exist; only existence was checked, with no private-key reads, generation or signing. Public boot certificate SHA-256 `c9cd2241cc47266b302aceae71a280c4892f9bcaf32026c96f361cde42aad74b`; metadata public-key-file hash `0eb4c0e03777d6f416660023e74457b888c71bd246956b3b53caaaa80e856ff6`. Therefore “signing keys absent” is not the composition blocker. |
| Packaging tooling | Read-only audit pinned existing FIT tools image `sha256:d75165f107b50d2c1cc0e9d07b49802ed78cc6b066f6b63595f7b38290145380`; its fit/initramfs/regdb script hashes match the accepted A source. This is tool/input inspection, not consumption of a new B3/C payload. |
| FIT / deployment records | No FIT, kernel/support component ID or fresh factory deployment envelopes exist for this new Image. Old generations 11/12 reference the old root/kernel and cannot be relabelled. New records and candidate-specific offline/signature/readback gates require an admissible current CX root and the explicitly selected source-bound init/trust/firmware combination. |

Required handoff through L2/L1 to the shared root/packaging owner: a newly
composed CX3576 root on the accepted A baseline (or a separately approved exact
source), including package/source manifest, rootfs-verity image/parameters and
digests, with zero quotas on `/mos`, `/srv`, `/mos/containers`, bounded writable
whole `/var`, private container paths and current authenticated tty2. Confirm the
native init artifact's source/content identity alongside that root. This is a
specific artifact dependency, not a request for speculative product changes or
a blanket dependency on later B3/C work. The one passed kernel needs no rebuild.

A later combined milestone requires L1's exact reviewed B/C handoff: B3 owns
native shutdown and bounded kernel-payload plumbing; C owns public-meta/verifier
and release/sourceIdentity/Toolbox changes. None is imported here. Board flashing
also independently requires confirmed hardware admission.

## Final review and disposition

Final local review covers the entire owned collector/test delta from the
authorized L2 base, plus this artifact/input documentation update. No product
source or sibling records were edited. Stale logs cannot replace the live
required-health probes; optional-unit failures remain diagnostics; dry-run
results are downgraded in both report tables; API/image/media/mode rebinding is
refused; repeated boot IDs are not extra cycles. Operator reports still require
raw external evidence review and do not turn simulated data into hardware proof.

| Review severity | Remaining findings |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

Verdict: PASS for the bounded local change. Final cheap-gate commands, UTC times,
exit identities and hashes are retained in `E/final-delivery.log` and
`E/final-delivery.json`. Original RED and all intermediate logs remain intact.
No fresh executable behavior was changed in this result-collection turn.
The completed task is the collector/kernel/input evidence deliverable; signed
image composition and every mandatory physical obligation above remain blocked.

The completed gate uses no active heavy token. Retain the labeled builder image,
full patched source, compiled artifacts, source snapshot and logs for L2 review;
no existing owner artifact or shared cache is removed. The idle task tmux shell
was removed after confirming it had no child process. The short input
audit container was read-only and used `--rm`; no bench interface was touched.

Change-history handoff for D through L2: this task/plan pair and the scoped bench
delta supersede only the collector gaps, distinguish reviewed A3 software from
the older A2 investigation baseline, retain historical optional D5, and map A/A4
coordination separately from missing physical inputs. No sibling, historical
task status, global index history or changelog is reconciled here.

- complete: Completed bounded collector, coherent kernel and input-provenance evidence; current CX root composition and all mandatory physical rows remain explicitly blocked. No hardware completion is claimed.
