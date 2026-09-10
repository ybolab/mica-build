# 20260910-2100-b4-runtime-selection Select explicit runtime payloads

- **status**: implementing
- **createdAt**: 2026-09-10 21:00
- **approvedAt**: 2026-09-10 21:00
- **relatedTask**: 20260910-2100-b4-runtime-selection

## Context

Source is exact reviewed L2 B `7508412cabddeea0ed2ac1fbba82a4ddd6ef9deb`,
merged without source changes. B0 S3/S6 defines the narrow call chains.
`rootfs/packages/resolve.sh` selects consumers; Debian lock records select
upstream installation inputs; installed `manifest.tsv` and dpkg lists identify
payload ownership. Current packing prunes a full install tree. No selector exists.

## Proposal

1. Add offline Python selection with per-consumer declarative runtime roots,
   recursive ELF/shebang closure and explicit helper/module/resource/state rules.
   Verify: real missing-dependency and path-refusal fixtures before implementation.
2. Preserve and compare bytes, numeric metadata, symlinks, hardlinks and xattrs
   including capabilities; emit file provenance beside existing rootfs reports.
   Verify: positive metadata roundtrip and deliberate loss fixtures.
3. Declare current runtime families without composition changes, classify the
   three assigned historical obligations and document B5 inputs/outputs here.
   Verify: focused fixture suite, required existing gates and pma-cr self-review.

## Risks

ELF closure cannot discover dynamic behavior. Rules must explicitly retain PAM,
NSS, TLS providers, generators, udev helpers, containers/radios and generated
state. Offline fixtures prove selection mechanics, not guest or board behavior.
Unknown/missing declarations and ambiguous paths/ownership must fail closed.

## Scope

Only `rootfs/runtime/`, `tests/rootfs-runtime-test.sh`, narrowly related fixture
support, one Makefile target, this task/plan and their own index rows.
No composition, package inventory wiring, lifecycle or C-owned changes.

## Alternatives

Copying whole packages or broad installed directories would hide unresolved
runtime roots. Executing target ldd/scripts would introduce host/target fallback.
Use offline metadata parsing and explicit declarations instead.

## Annotations

- Prior full-tier approval and B4 dispatch on 2026-09-10 satisfy the proposal gate.
- Keep S5 rejected: bash/GNU/outbound SSH and selected tooling remain roots.
- B grant: one L3, zero heavy builds. B7 owns runtime proof after an L1 grant.

## Implementation and B5 interface

The implementation is `rootfs/runtime/select.py`; declarations are
`rootfs/runtime/consumers.json`. There are 22 consumer keys, checked against the
existing `rootfs/debian/consumers.pkgs`. This is a runtime policy, not another
package/version/archive inventory or feature resolver. Only the names already
selected by `rootfs/packages/resolve.sh` activate declarations.

B5 calls the selector **after** offline configuration and approved transforms,
before scratch composition. All paths below are examples inside its scoped
packing workspace, not permission to mount a shared parent:

```bash
python3 rootfs/runtime/select.py select \
  --root /work/installed \
  --output /work/selected \
  --packages /work/selected.pkgs \
  --inventory /work/captured/manifest.tsv \
  --ownership /work/captured/info \
  --rules /work/runtime-consumers.json \
  --arch amd64 \
  --report /out/rootfs-report.runtime.json
python3 rootfs/runtime/select.py verify \
  --root /work/selected \
  --report /out/rootfs-report.runtime.json
```

- `--packages`: the existing resolver's newline-separated local package names,
  not a second board/profile/feature solver. `--arch` is `amd64` or `arm64`.
- `--inventory`: the existing three-column `#package/version/architecture`
  `manifest.tsv`, captured externally before dpkg purge. Package names and
  architectures must be unique/consistent. B5 retains the installed-input record
  and derives the shipped-contributor record through the existing release path.
- `--ownership`: captured native dpkg `info/*.list`, including native
  `name:architecture.list` filenames. No new ownership serialization is needed.
  Common directory ownership is explicitly shared; multiple file owners fail.
  Merged-usr aliases resolve inside the staged root, never against host `/`.
- `--rules`: defaults to the checked-in declarations. Each consumer has `roots`
  and `runtime_links`. Root fields are `paths`, `kind` (`executable`, `resource`,
  `directory`), `reason`, and optional `packages`, `generated`, `expect`.
  Package-scoped patterns match individual path components in captured dpkg
  ownership; `*` is never recursive, `**` is refused, every rule must match.
  A missing matched path fails instead of shrinking the selected set. Unscoped
  roots and generated paths are literal. A directory selects only that inode.
- Before invocation B5 must add the **exact** composition-generated outputs to
  the same consumer declarations: conditional public metadata from the approved
  C handoff, remaining postinst enablement/alternatives, generated state/template
  directories and their named producers. Do not infer origin from existence or
  add a blanket unowned-tree exception. B4 does not import C's unfinished public
  metadata work or hardcode its retired metadata contract.
- Preserve captured ownership before purge. If an approved transform deliberately
  removes a path matched by a runtime rule, reconcile that **specific** path with
  the reviewed transformation record; do not filter all missing paths. Existing
  static hwdb data/source/update-unit exclusions are named in this selector.
  B5 must compare all surviving operator executables to the selected report and
  resolve omissions without reviving the rejected S5 reduction.
- An explicit generated rule supplements package provenance when a package-owned
  path was changed. `expect` can require mode, numeric uid/gid, link target,
  SHA-256 or required xattr hex values, including `security.capability`.
- Runtime-only links require their exact target, named generator, ordering,
  acceptance test and concrete retained producer/resources. Only a specifically
  named `/dev/null` mask can have an empty producer list. This retains the
  intentional SSH mask and does not exempt arbitrary dangling symlinks.
- An empty output root and absent external report are required. Installation and
  source transformations must be finished and quiescent. Failed selection never
  publishes a successful report; a failed copy may leave a partial destination
  that B5 must discard within its own scratch scope. The source is never edited.

`rootfs-report.runtime.json` is a machine-readable companion to the existing
`rootfs-report.txt`, not an independent inventory authority. `inputs` contains
SHA-256 identities of selection, inventory, declarations and ownership lists.
Each `files[]` row contains the path, reasons, package/version/architecture or
named generated origins, file SHA-256/size, type, numeric uid/gid/mode, mtime,
xattrs, symlink target, selected hardlink group, and runtime-link contract where
applicable. Selection preserves bytes: this SHA-256 is both its input and output
file digest. B5 joins archive hashes and **earlier** transformation digests from
its existing lock/pool/release machinery; B4 does not claim archive-to-file
transformation evidence it cannot observe. Keep reports outside the selected
root to avoid circular inventory hashes.

`external_inputs[]` identifies boot, support/module-index/firmware and debug
inputs by path and metadata/digest without selecting or deleting them. B5 keeps
matching debug/build-id exports and independently signed support identities,
then binds them to the actual packed root through the existing export/release
machinery. Directories `/boot`, `/usr/lib/modules` and `/usr/lib/firmware` can
remain mountpoints; their payloads cannot enter the selected root. B4 neither
exports components nor changes module indexes.

B5 must run `verify` after each selection-preserving transfer, with the same
normalized timestamps established before selection. It checks exact paths,
bytes, metadata, all xattrs and hardlink partitioning. OCI/SquashFS transfers are
not performed here. Packing tools must preserve numeric owners, set-ID bits and
capabilities; this selector does not justify a metadata-losing scratch COPY.

### Loader and script boundaries

The offline parser reads ELF64 little-endian program headers and dynamic tables,
including sectionless binaries, PT_INTERP, recursive DT_NEEDED, RPATH inheritance,
non-inherited RUNPATH and `$ORIGIN`. It reads the target's current glibc 1.1
little-endian cache before default directories. Conflicting library identities,
foreign architectures, ambiguous ownership, broken/escaping/cyclic links,
unsupported executable formats and missing executable bits are refusals.
Cache hwcaps/multi-ABI entries, loader audit/filter/preload policy, NODEFLIB and
unknown loader tokens are explicitly refused instead of silently approximated.
No compatibility cache formats, host loader fallback or target execution exists.

Shebangs are recursive. `/usr/bin/env NAME` uses only the declaration's explicit
PATH; options, multiple words, missing commands and interpreter cycles fail.
Subprocesses, PAM/NSS, TLS providers, D-Bus, systemd/udev, containers and radio
resources remain explicit consumer roots. Text scanning is not represented as
proof of dynamic dependencies. B5/B7 must add an exact resource declaration when
an actual selected caller exposes a new helper; do not relax a missing-root test.

Loader references used for the implementation are the
[Linux loader contract](https://man7.org/linux/man-pages/man8/ld.so.8.html),
[execve interpreter contract](https://man7.org/linux/man-pages/man2/execve.2.html)
and glibc's
[cache structure](https://raw.githubusercontent.com/bminor/glibc/master/sysdeps/generic/dl-cache.h).

## Residual classification and ownership map

All current source below was revalidated at approved L2 source
`7508412cabddeea0ed2ac1fbba82a4ddd6ef9deb`. The old three task statuses were not
edited. L2 B owns coordination, B4 owns selector evidence, B5 owns composition
retention, B7 owns newly granted guest runtime evidence, and D3 owns historical
record reconciliation. No fresh-image, first-boot or hardware pass is inferred
from source/fixture evidence.

| Historical obligation | Current classification and actual evidence | Retained selector resources | Remaining acceptance / owner |
| --- | --- | --- | --- |
| System extension first boot (`20260908-2011-state-units-never-load`) | Old STATE pathname is superseded by DATA. The implementation exists: `rootfs/overlay/etc/systemd/system/mos-load-extensions.service` orders after DATA bind, daemon-reloads and starts multi-user without blocking. `rootfs/packages-src/system/Dockerfile` installs/enables it. `rootfs/scripts/pack-assert-extension-dir.sh` checks the bind directory/unit/link. `tests/file-ab-x64/runtime-build.sh:28-41` seeds a unit and `runtime.sh:122` checks its marker. These are current policy/fixture facts, not a fresh runtime pass. | Extension loader, systemctl, DATA bind unit/wants link and `/usr/local/lib/systemd/system`. B4 current-resource positive fixture compares the real committed bytes; deleting the loader or bind unit fails selection. | Valid and covered by B4/B5 packaging; B7 must prove the seeded system unit starts on the first boot of a fresh current image. |
| Quadlet ordering (same historical record) | Separately valid and still missing fresh proof. The extension loader orders after `etc-containers-systemd.mount`; the existing system-unit marker does not prove a Quadlet executes. The current conditional container policy is unchanged. | Selected `mos-podman` requires podman/crun, conmon, catatonit, netavark, aardvark-dns, Quadlet, its generator, configs and bind unit/destination. The real bind-unit fixture and deleting Quadlet/bind resources test selection. | B5 retains conditional enablement and private storage/tmp configuration; B7 needs a positive first-boot Quadlet case and a declined/disabled policy case. If current unit ordering fails that case, report the exact policy hunk to L1 before repair; it is outside B4. |
| SSH command-line listen/port conflict (`20260908-2011-ssh-generator-vs-image-policy`) | Mask policy is already implemented by the system package: `/etc/systemd/system-generators/systemd-ssh-generator -> /dev/null`. This supersedes an unmasked generator's intended runtime path, but does not prove the negative port-conflict case. | Exact mask target/producer exception; sshd/session helpers, SSH service/presets, outbound ssh/scp, PAM/NSS and account policy. Changing the mask target fails; the positive fixture preserves `/dev/null` without consulting host `/dev/null`. | B5 must preserve the mask. B7 must boot with `systemd.ssh_listen=` and prove no conflicting generator socket/listener. |
| SSH image-only authorized keys (same historical record) | The same mask and `/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf` implement the image policy. Mask source alone does not prove which keys authenticate. | The actual authorized-key policy bytes, SSH/PAM/NSS/helpers and numeric ownership survive selection. Deleting the policy file fails. Factory shadow and its ordered volatile generator remain required roots. | B5 preserves generated account/SSH directory ownership; B7 must independently exercise an image-policy-only key and the disallowed alternative. Any reconciler/policy fix requires L1 scheduling outside B4. |
| Login accounting bounds (`20260908-2011-wtmp-unbounded-append`) | Historical unbounded `/var/log` symptom is superseded by implemented volatile redirects: `pack-tree-surgery.sh` links wtmp/btmp/lastlog to `/run/mos`; `mos-var.conf` creates targets; `mos-init.rs:303` bounds `/run` at 32M and creates `/run/mos` at line 526. Repeated-login runtime proof remains valid and open. | All three exact links, real tmpfiles rule, tmpfiles executable/setup service, login/PAM/SSH and the whole-/var template/bind policy. Removing the generator resource fails; metadata roundtrip covers numeric ownership and modes. | B5 preserves these roots, whole-/var writable bounds, unlimited `/mos`/`/srv`/`/mos/containers`, private container bind and reset isolation. B7 verifies effective mount size/targets/permissions and repeated-login behavior. No selective read-only /var or new application quota is introduced. |

No out-of-scope policy repair has been demonstrated or attempted in B4. Missing
fresh runtime evidence stays assigned to B7; a runtime failure must be escalated
with its exact source hunk through L2 B before editing policy/native code.

## Evidence and verification

- RED before implementation: `timeout 120 bash tests/rootfs-runtime-test.sh`
  exited 1 (29 tests, selector absent). Log: `/tmp/mos-b4-gates-XP9wpM/red.log`.
- Additional RED mutations demonstrated lost ownership payload/copyright,
  loader cache and RPATH precedence, preload refusal and the intermediate
  symlink target before `..`; each was followed by a minimal implementation fix.
- Focused GREEN before final gates: 45 tests passed, including actual capability
  xattr and non-root numeric ownership. No capability/architecture check is
  skipped. Tiny amd64/arm64 ELF files are inspected offline; they are not guest
  execution evidence. No compiler/toolchain/network/image build is needed.
- Final required checks, source commit, log hashes and review result are recorded
  in the task after the gate run. All temporary fixtures are owned and cleaned.
