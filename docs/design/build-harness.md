# Build and verification entry points

Use the repository wrappers and pinned images. The [build guide](build.md)
defines component inputs and assembly; this page maps changes to checks and
explains execution prerequisites.

## 1. Execution model

`build/run.sh` and `verify/run.sh` orchestrate with Bun. Set
`MOS_BUILD_CONTAINER=1` or `MOS_VERIFY_CONTAINER=1` to select their pinned
container routes. Byte-producing tools run in their declared images through
`build/src/toolbox.ts`; orchestration does not install a host compiler.

`IMAGE_BUN_1` and `IMAGE_DOCKER_CLI_28` in `build-env/images.env` pin Bun and the
Docker CLI/buildx inputs. `build/Dockerfile` also provides Python and libcap
for transport and file-capability checks, recording resolved Debian versions
in `/etc/mos-build/build-tools.tsv`. Image pins do not freeze the Debian archive.

Keep outputs and caches under the project's ignored `_out/`, `tmp/` or `.tmp/`
directories. A sibling Docker container resolves volume sources on the daemon
host: use the actual host project path and mount only required directories.

## 2. Gate map

| Change | Entry point |
|---|---|
| Component/image/release producer | `MOS_BUILD_CONTAINER=1 make os-build-test` |
| Image verifier | `make os-verify-test` |
| Independent release gate | `make os-release-verify-test` |
| Rust services and native deployment tools | `make os-rust-gate` |
| Built-in dashboard | `bash pkgs/mosd/apid/ui/build.sh --check` |
| API contract expectations | `make os-apid-api-spec-pins` |
| Update server | `bun run --cwd update-server check` |
| Documentation | `make docs-verify docs-verify-test` |
| Host/toolchain boundaries | `make os-host-toolchain-lint os-host-toolchain-lint-test` |

The update-server command runs in its pinned Bun environment. Consult
`.github/workflows/check.yml` for the full CI gate set. Local success and remote
CI status are recorded separately; test counts belong to a dated delivery
record, not to the permanent invocation contract.

## 3. Rust workspaces

`tests/rust-gate.sh` runs the unmodified `hack/check.sh` in `pkgs/mosd` and
`pkgs/mos-deploy`. Each workspace checks formatting, strict clippy, nextest,
doctests and cargo-deny. The mosd gate also checks generated OpenAPI drift.

The local `mos-build-rust-check` image adds rustfmt, clippy, nextest, cargo-deny
and a real private D-Bus daemon to the pinned Rust builder. The image records
its versions; the wrapper prints them. Select one workspace with
`bash tests/rust-gate.sh mos-deploy` or `bash tests/rust-gate.sh mosd`.

The wrapper builds the embedded UI before entering the Rust check container and
supplies `MOS_APID_UI_DIST_DIR`. CI builds the pinned image family and calls the
same wrapper. It checks that the workspace MSRV declarations agree, but does
not run a separate compiler at that MSRV. The gate result attests the pinned
release compiler actually named in its log.

## 4. ARM64 execution

Building an ARM64 image under a buildx executor does not establish that a
direct `docker run --platform linux/arm64` can execute on the daemon host.
BuildKit's emulator and host binfmt registration are separate facilities.

Use the native pinned Rust builder's `aarch64-linux-gnu-gcc` for cross C test
helpers on an x64 host. The C-only builder is native-only. Use QEMU full-system
acceptance for the target kernel and service behavior. A qemu-user smoke
limitation, such as crun execution, is reported explicitly and does not become
a skipped full-system requirement.

## 5. Complete-image acceptance

Build the current package pool and compose the root, then produce signed root,
kernel/support and deployment artifacts with `build/run.sh --components`.
The `image` command assembles a new three-partition factory image. No test
upgrades an old-layout image into this layout.

Run `verify/run.sh --verify` with the explicit board, complete image and metadata
public key. The [API harness](../../pkgs/mosd/tests/apid-api/README.md) also
requires a complete image and public boot trust input. Its dry run checks
prerequisites without booting. Tests under `tests/file-ab-x64/` cover both UEFI
architectures, full services, updates, interruption, fallback and shutdown.

The API harness does not build its input image. Missing images, signing inputs
or emulation facilities are prerequisite failures, not evidence against the
guest. API observation tests must wait for admitted tasks; HTTP acceptance does
not prove a reconciler has finished.

cx3576 software checks precede the separate [physical bench sequence](../bsp/cx3576-bench.md).
VM reset and deterministic I/O faults cannot establish physical eMMC power-loss
durability. The [delivery record](../task/20260908-2229-file-ab-delivery-x64-first.md)
binds each result to its artifact and states the remaining hardware gates.

## 6. Documentation gates

`make docs-verify` checks catalog membership in both directions, relative links,
normative truth-status evidence, board dossiers and Chinese user-guide coverage.
`make docs-verify-test` proves failures on deliberately invalid fixtures.

Keep the catalog synchronized with the shipped design/user/website/BSP pages.
Engineering proposals belong in plan/task tracking. Product instructions must
describe the current contract; superseded operating procedures remain in Git
history rather than beside current instructions.

## 7. Development integration and acceptance workflow

The 2026-09-12 user direction separates reviewed source integration from image
qualification. With user authorization, a local development-main merge may proceed after source review
and affected integration checks, while exact-image guest or board acceptance
remains pending. A merge is neither a release nor an acceptance pass. This
supersedes earlier campaign instructions requiring all x64 guest results before
any source merge; authentication, signatures and release gates are unchanged.

Use one integration owner and one immutable candidate per acceptance round.
The owner continues the already-approved sequence without per-stage approval:

1. Preflight the entire selected input set: package ownership, generated files,
   symlinks and masks, ELF/interpreter closure, pinned downloads, source identity,
   trust inputs, and executor/tool/resource availability. Report all discovered
   input defects together before a root/image build.
2. Produce only changed packages or boot/kernel tools. Architecture-independent
   packages are produced once; architecture-dependent recipes share their source
   inputs but retain separate amd64/arm64 outputs and receipts.
3. Compose the affected root from verified packages, run its closure and binary
   smoke checks, then sign components and assemble one candidate image.
4. Test isolated copies of that image for boot, reboot, shutdown, update/fallback,
   reset, storage, services and authenticated API behavior. Bind each verdict to
   its actual source and artifact; retain the original immutable image.
5. Review new product changes and summarize acceptance separately. Routine
   collection and successful later stages do not trigger another source review.

Generic development iterates on x64. Only a concrete ARM-specific source change
requires a targeted ARM check. The consolidated ARM round follows the stable
accepted x64 baseline and includes the owed equal-input virt-arm64 cold-root
comparison. An early development source merge alone does not start that round.

### Changes and invalidation

| Changed input | Work that must be reconsidered |
|---|---|
| Documentation or tracking only | Documentation checks; preserve artifact source labels |
| Package source, recipe, pin, toolchain or feature inputs | That producer and its consumers; preserve unrelated packages/kernels |
| Runtime selection or root composition | Affected input/closure tests and root onward; reuse unchanged verified packages |
| Native startup/shutdown or boot packaging | Affected native/boot outputs and dependent signing/image/guest checks |
| Kernel, device tree, firmware or boot trust | The affected board components and their actual consumers |
| Test transport or executor wrapper only | Prove the wrapper, then resume the failed check against the same immutable input |

Reuse follows the implemented source/recipe/toolchain/configuration/trust
contracts and byte identities. A different main commit is not evidence that
all producers changed; matching architecture alone is not evidence of reuse.
Do not weaken freshness checks or rename old outputs to claim new production.
The separate package-repository proposal remains outside this workflow change.

### Ownership and recovery

Within the approved feature scope and existing resource grant, the execution
owner may fix the complete evidenced call chain, run RED/GREEN checks, and
continue. Reviewers inspect new source changes once. A corrected fixture,
recovered transport error or successfully retried stage remains in history but
does not require a separate coordinator approval solely because it once failed.
Unresolved product failures remain failures. Escalate actual scope decisions,
shared ownership conflicts, trust changes or resource expansion with concrete
choices; do not re-request authorization already supplied.

Keep one compact state record with current candidate, actual running job,
completed stages, failed stage/reason, next action and accumulated phase times.
Reuse verified receipts; only recompute them when their bytes or relevant inputs
change. Recover the same issue after checking its actual process and detached
jobs. Do not interrupt a live build because its coordinating turn is idle.

The existing half-hour L1 watchdog is the only periodic campaign scan. B reviews
real completion/failure events and continues the same B7 owner; remove its
redundant periodic scan. Completed A/C/D work is not reactivated for unchanged
snapshots. Background messages reach the user only for a concrete outstanding
decision; direct progress questions still receive a concise answer.

This section changes development workflow and scheduling. It does not claim
that a new unified build driver or per-package cache-key implementation exists.
