# RFCT-001 Stage 1.0 - Introduce TypeAppliance and gate K8s in sequencer

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-05-09 00:00
- **claimedAt**: 2026-05-09 07:50
- **completedAt**: 2026-05-09 08:15

## Description

Make "do not run Kubernetes" a legal machine configuration without deleting any code yet. Introduce a new `MachineType` value `appliance` and route the boot/upgrade/reset/shutdown sequences down a K8s-free path when that type is selected. Refactor the v1alpha2 controller registration so the K8s/etcd/kubespan/kubeaccess/siderolink/kubeprism controllers are skipped under the appliance profile.

Acceptance criteria:

1. With a minimal machineconfig where `machine.type: appliance`, machined boots to a steady state running only system containerd plus the existing service set (apid, trustd, machined, syslogd, auditd, udevd, dashboard, containerd) - **no kubelet/etcd/cri/k8s controllers active**.
2. Existing `init`/`controlplane`/`worker` boot paths continue to work unchanged. Build and existing unit tests pass.
3. `talosctl upgrade` against an appliance node runs without attempting etcd lock acquisition or `ValidateForUpgrade`.

This stage touches but does not delete K8s code. Deletion happens in RFCT-002.

## ActiveForm

Wiring TypeAppliance through sequencer and controller profile.

## Dependencies

- **blocked by**: (none)
- **blocks**: RFCT-002

## Notes

See [PLAN-001](../plan/PLAN-001.md) for the design and the implementation deviations recorded under "Annotations".

### Completion notes (2026-05-09)

- Added `machine.TypeAppliance` (`appliance`) plus matching proto/pb.go/stringer entries.
- Validator skips cluster section under appliance and rejects it explicitly.
- Profile selection driven by `talos.profile=appliance` kernel cmdline (registered as `KernelParamProfile` constant). Controllers in `k8s.`/`etcd.`/`kubespan.`/`kubeaccess.`/`siderolink.`/`cluster.` namespaces and the K8s/etcd-specific `secrets/` controllers are skipped under that profile.
- Sequencer Reset/Shutdown/Upgrade/StageUpgrade/Reboot phases gate K8s drain/StopAllPods/LeaveEtcd on `machine.TypeAppliance`.
- `StartAllServices` only loads kubelet/cri/etcd/trustd for non-appliance machine types.
- `Server.Upgrade` skips etcd upgrade-mutex acquisition when machine type is appliance.
- `secrets.APIController` accommodates appliance (treated as worker for apid PKI) instead of panicking.

Verification:

- `go build ./...` clean
- `go test ./pkg/machinery/...` all green
- `go test ./internal/app/machined/pkg/runtime/v1alpha1/...` all green
- `go test ./internal/app/machined/pkg/runtime/v1alpha2/...` no test files
- `go test -run TestAPI ./internal/app/machined/pkg/controllers/secrets/...` green (non-test changes confirmed)
- Pre-existing `EncryptionSaltController` mount-permission failure is unrelated to this task.

Out-of-scope follow-ups (will be tracked in RFCT-002/RFCT-003 or new tasks if needed):

- Run `make generate` to regenerate the proto rawDesc binary descriptor for `TYPE_APPLIANCE`.
- Add an integration smoke test that boots an appliance image (depends on imager profile work).
- Imager profile that injects `talos.profile=appliance` into kernel cmdline at install/upgrade time.
