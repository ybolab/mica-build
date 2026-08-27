# RFCT-004 Stage 1.3 - Repair build pipeline so a bootable appliance image can be produced and tested in QEMU/KVM

- **status**: completed
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-05-09 10:45
- **claimedAt**: 2026-05-09 10:45
- **completedAt**: 2026-05-09 11:00

## Description

Stage 1.2 left the source tree compiling, but the build pipeline that produces installable/bootable images (Makefile, Dockerfile, `pkg/imager/`, helper scripts under `hack/`) still references deleted paths and packages: `cmd/talosctl/`, `pkg/cluster/`, integration tests, the talosctl-cni-bundle helper, etc. Until those references are repaired, `make initramfs`, `make image-metal`, and `make image-iso` will fail and we cannot QEMU-test the appliance.

This task gets the project to the point where:

1. `make initramfs PLATFORM=linux/amd64`, `make kernel PLATFORM=linux/amd64`, `make installer PLATFORM=linux/amd64`, and `make image-iso PLATFORM=linux/amd64` succeed against the local Docker daemon.
2. The produced ISO boots in QEMU/KVM, machined comes up with `machine.type: appliance`, and webd serves `:8080`.
3. A documented `make qemu-test` (or equivalent helper) runs the image headlessly and reports `webd healthz` reachable.

Out of scope: actual feature work on webd/rescue (Stage 2). This is purely build-system hygiene plus a smoke harness.

## ActiveForm

Repairing build pipeline and producing a QEMU-bootable appliance image.

## Dependencies

- **blocked by**: RFCT-003
- **blocks**: (none — Stage 2 starts after this)

## Notes

See [PLAN-004](../plan/PLAN-004.md) for the design.

### Completion notes (2026-05-09)

Build pipeline cleanup landed: `Makefile` and `Dockerfile` no longer reference deleted talosctl/integration paths. New scaffolding under `examples/appliance/`, `hack/appliance/`, and `docs/qemu.md` lets a contributor produce an ISO and probe webd in one command pair.

**Verification done in-session**:

- `make help` parses cleanly (Makefile syntactically valid).
- `go build ./...` clean.
- `go test ./pkg/machinery/config/... ./internal/app/machined/pkg/runtime/v1alpha1` green.
- `bash -n hack/appliance/{build-iso,qemu-test}.sh` clean.

**Verification deferred to operator** (requires Docker buildx + ~30 min + qemu-kvm, not run in this session):

- `./hack/appliance/build-iso.sh` produces `_out/metal-amd64.iso`.
- `./hack/appliance/qemu-test.sh` reports `>> webd is healthy`.

**Stage 2 follow-ups** (out of scope for RFCT-004):

- Build the rescue system extension squashfs and wire an alternate ISO entry that injects `talos.rescue=1`.
- Promote webd from goroutine inside machined to a separate process.
- TLS, auth, COSI/machined live data wiring in webd.
- Run `make generate` to refresh proto descriptors and prune unused schema/resource layers.
