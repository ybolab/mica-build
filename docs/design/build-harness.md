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

cx3576 software checks precede the separate [physical bench sequence](../boards/cx3576-bench.md).
VM reset and deterministic I/O faults cannot establish physical eMMC power-loss
durability. Each acceptance result is bound to its artifact; remaining hardware gates are in
[support tiers](../boards/support-tiers.md#current-boards).

## 6. Documentation gates

`make docs-verify` checks catalog membership in both directions, relative links,
normative truth-status evidence, board dossiers and Chinese user-guide coverage.
`make docs-verify-test` proves failures on deliberately invalid fixtures.

Keep the catalog synchronized with the shipped design/user/website/BSP pages.
Engineering proposals belong in plan/task tracking. Product instructions must
describe the current contract; superseded operating procedures remain in Git
history rather than beside current instructions.

## 7. Development integration and acceptance workflow

Source integration and image qualification are separate. A reviewed source
change may merge to development main after its affected checks pass while
exact-image guest or board acceptance is still pending. A merge is neither a
release nor an acceptance pass; authentication, signature and release gates
are unchanged.

Each acceptance round uses one immutable candidate image:

1. Preflight the whole input set: package ownership, generated files, symlinks
   and masks, ELF/interpreter closure, pinned downloads, source identity, trust
   inputs and tool availability. Report every input defect before building.
2. Produce only changed packages or boot/kernel tools. Architecture-independent
   packages are produced once; architecture-dependent recipes keep separate
   amd64/arm64 outputs and receipts.
3. Compose the affected root from verified packages, run its closure and binary
   smoke checks, then sign components and assemble one candidate image.
4. Test isolated copies of that image for boot, reboot, shutdown,
   update/fallback, reset, storage, services and authenticated API behaviour.
   Bind each verdict to its source and artifact; keep the original image.

Generic development iterates on x64. An ARM-specific source change requires a
targeted ARM check; a consolidated ARM round follows a stable x64 baseline.

### Changes and invalidation

| Changed input | Work that must be reconsidered |
|---|---|
| Documentation or tracking only | Documentation checks; preserve artifact source labels |
| Package source, recipe, pin, toolchain or feature inputs | That producer and its consumers; preserve unrelated packages/kernels |
| Runtime selection or root composition | Affected input/closure tests and root onward; reuse unchanged verified packages |
| Native startup/shutdown or boot packaging | Affected native/boot outputs and dependent signing/image/guest checks |
| Kernel, device tree, firmware or boot trust | The affected board components and their actual consumers |
| Test transport or executor wrapper only | Prove the wrapper, then resume the failed check against the same immutable input |

Reuse follows the source, recipe, toolchain, configuration and trust contracts
and byte identities. A different main commit is not evidence that all
producers changed; matching architecture alone is not evidence of reuse. Do not
weaken freshness checks or rename old outputs to claim new production. A
recovered transport error or a successfully retried stage stays in history;
unresolved product failures remain failures.
