# PLAN-004 Stage 1.3 - Repair build pipeline; produce a QEMU-bootable appliance image

- **status**: completed
- **createdAt**: 2026-05-09 10:45
- **approvedAt**: 2026-05-09 10:45
- **completedAt**: 2026-05-09 11:00
- **relatedTask**: RFCT-004

## Context

Stages 1.0-1.2 left the source tree compiling but never re-validated the build pipeline. After Stage 1.2 the following references in build artifacts were stale:

- `Makefile` `all` target listed `talosctl` and `talosctl-image` (deleted in Stage 1.2)
- `Makefile` had the per-OS/arch `talosctl-*` targets, `talosctl-cni-bundle`, `cloud-images`, `uki-certs`, `integration-images-list`, `cache-create`, `e2e-%`, `provision-tests*`, `installer-with-extensions`, `kubelet-fat-patch`, and `hack-test-%` recipes; all of these reference deleted code (cmd/talosctl, internal/integration, hack/test)
- `Makefile` `push` and `image-list` listed `talosctl` and `talosctl-all` images
- `Dockerfile` had ten `talosctl-*-build` stages plus the `talosctl-all` aggregator and a `talosctl` entrypoint stage that all `WORKDIR /src/cmd/talosctl` (deleted)
- `Dockerfile` `docs-build` stage and `talosctl-cni-bundle` stage referenced talosctl
- `Dockerfile` had `ARG PKG_TALOSCTL_CNI_BUNDLE` and the matching `pkgs-talosctl-cni-bundle` import

These prevented `make help`, `make all`, and `make image-iso` from running. Stage 1.3 fixes the build pipeline and adds a tiny smoke-test harness so the next contributor can reach a "boots in QEMU" milestone within minutes.

## Proposal

### Build-pipeline cleanup

- `Makefile`:
  - Drop `talosctl` and `talosctl-image` from the `all` target (`all: initramfs kernel installer imager talos`)
  - Drop `talosctl-image`, `talosctl-all-image`, `talosctl-all`, `talosctl-linux-*`, `talosctl-darwin-*`, `talosctl-windows-*`, `talosctl-freebsd-*`, and the dispatcher `talosctl: talosctl-$(OPERATING_SYSTEM)-$(ARCH)`
  - Drop `talosctl-cni-bundle`, `cloud-images`, `uki-certs`, `integration-images-list`, `cache-create`, `e2e-%`, `provision-tests*`, `installer-with-extensions`, `kubelet-fat-patch`
  - Drop `hack-test-%` (`./hack/test/` is gone)
  - Remove the `INTEGRATION_TEST` / `INTEGRATION_TEST_PROVISION_DEFAULT_TARGET` / `TALOSCTL_DEFAULT_TARGET` / `TALOSCTL_EXECUTABLE` / `PKG_TALOSCTL_CNI_BUNDLE` variables
  - Update `push` and `image-list` to drop the talosctl images

- `Dockerfile`:
  - Delete the ten `talosctl-*-build` and `talosctl-*` stages plus `talosctl-all`, `talosctl-targetarch`, and the `talosctl` entrypoint stage (lines 506-639 of the pre-edit file)
  - Delete `ARG PKG_TALOSCTL_CNI_BUNDLE` and the corresponding `FROM ${PKG_TALOSCTL_CNI_BUNDLE}` import
  - Replace the `docs-build` and `talosctl-cni-bundle` stages with empty `FROM scratch AS docs` / `FROM scratch AS talosctl-cni-bundle` placeholders so the Makefile's `docs` target does not error out

### New scaffolding for QEMU testing

- `examples/appliance/appliance.yaml` — minimal v1alpha1 appliance machineconfig (no `cluster:` section, hostname `appliance-test`, install disk `/dev/vda`).
- `hack/appliance/build-iso.sh` — invokes `make installer-base`, `make imager`, then runs the imager container with `--embedded-config-path` and `--extra-kernel-arg talos.profile=appliance`. Default output is `_out/metal-amd64.iso`; pass `metal` to get a raw disk image.
- `hack/appliance/qemu-test.sh` — boots the artifact under `qemu-system-x86_64` with KVM if `/dev/kvm` is present, forwards host port 8080 to guest 8080, and polls `webd /healthz` until it answers (or `QEMU_TIMEOUT` elapses).
- `docs/qemu.md` — operator-facing runbook explaining prerequisites, the two scripts, and how to inspect a running guest manually.

## Risks

- **Cold build is slow**: the first `make installer-base` pulls many hundreds of MiB of `ghcr.io/siderolabs/tools` and `ghcr.io/siderolabs/pkgs/*` images and runs ~30-60 minutes on a 4-core/16GB host. Documented in `docs/qemu.md`.
- **Kernel arg ordering**: `talos.profile=appliance` must reach the guest. Achieved by passing `--extra-kernel-arg` to the imager. If the operator uses a custom imager profile they need to remember to inject this.
- **webd HTTP exposure**: webd listens on `:8080` plaintext. The QEMU smoke test uses `hostfwd=tcp::8080-:8080` to make it reachable from the host; do not expose this beyond a development laptop.
- **Default install disk**: the example config uses `/dev/vda` (QEMU virtio disk). On bare-metal the operator must edit the YAML.
- **No `talosctl`**: there's no remote management once the appliance is up. Smoke test relies on plain `curl`. Real management is webd's job (Stage 2).
- **Imager compatibility**: I did not re-run a full image build in this session; the changes are static-analyzable but a real `make image-iso` run is the only way to confirm there is no implicit talosctl dependency in the imager pipeline. Operator should run `./hack/appliance/build-iso.sh` to validate.

## Scope

Estimated diff: small (Makefile -80 lines, Dockerfile -135 lines, +200 lines of scripts/docs).

Files touched:

- `Makefile` (large deletion)
- `Dockerfile` (large deletion)
- `examples/appliance/appliance.yaml` (new)
- `hack/appliance/build-iso.sh` (new)
- `hack/appliance/qemu-test.sh` (new)
- `docs/qemu.md` (new)
- `docs/plan/PLAN-004.md`, `docs/task/RFCT-004.md` (new tracking)

Verification gates:

- `make help` parses cleanly (no Makefile syntax errors).
- `go build ./...` clean (regression check).
- `go test ./pkg/machinery/config/... ./internal/app/machined/pkg/runtime/v1alpha1` pass.
- `bash -n hack/appliance/build-iso.sh hack/appliance/qemu-test.sh` (shellcheck if available).
- Manual: operator runs `./hack/appliance/build-iso.sh && ./hack/appliance/qemu-test.sh` and observes `>> webd is healthy`. Not run inside this session because it needs Docker buildx + ~30 minutes; the scripts are the deliverable.

## Alternatives

### Alt-A: Vendor the kernel + initramfs build into a Go program

Rejected. Talos's existing pipeline reuses `siderolabs/tools` and `siderolabs/pkgs` which already produce reproducible kernels. Forking that toolchain is far out of scope.

### Alt-B: Skip the image build and ship `qemu-system` with kernel + initramfs from the upstream Talos release

Rejected. Upstream Talos initramfs starts apid/kubelet which we removed. The appliance fork has no compatible release yet, so we must build our own.

### Alt-C: Use `make image-iso` directly (no wrapper script)

Possible, but it requires the operator to remember to pass `--embedded-config-path`, `--extra-kernel-arg talos.profile=appliance`, and `console=ttyS0`. The wrapper script makes the contract obvious.

## Annotations

(Pending review; this plan was authored and implemented in the same session as the cleanup. Operator validation of an end-to-end QEMU boot is required before marking complete.)

## Post-rebase note (2026-08-17)

`hack/appliance/build-iso.sh` referenced above exists only on the pre-rebase
lineage (tag `archive/fork-pre-rebase` in the talos repo). On the current
upstream-gated lineage the equivalent flows are the talos repo make targets
(`make image-cx3576` for the cx3576 board per PLAN-009/B2; upstream imager
targets for amd64). This plan is retained unmodified above as a historical
record.
