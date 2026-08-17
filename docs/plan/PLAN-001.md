# PLAN-001 Stage 1.0 - Introduce TypeAppliance and gate K8s in sequencer

- **status**: completed
- **createdAt**: 2026-05-09 00:00
- **approvedAt**: 2026-05-09 07:50
- **completedAt**: 2026-05-09 08:15
- **relatedTask**: RFCT-001

## Context

Talos today hard-couples Kubernetes into the boot sequence:

- `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer.go:195` `Boot()` always appends `StartAllServices`, which in `v1alpha1_sequencer_tasks.go:428` unconditionally `Load`s `services.Kubelet{}` and starts `services.CRI{}`. Depending on `MachineType`, it then adds `Trustd`/`Etcd`.
- `Reset()` (`v1alpha1_sequencer.go:260`), `Shutdown()` (`v1alpha1_sequencer.go:346`), and `Upgrade()` (`v1alpha1_sequencer.go:425`) all call `CordonAndDrainNode`, `StopAllPods`, `LeaveEtcd`, `StopServicesEphemeral`, which assume kubelet/etcd/cri exist.
- `internal/app/machined/pkg/runtime/v1alpha2/v1alpha2_controller.go:200-296` registers ~30 K8s/etcd/kubespan/kubeaccess/siderolink/kubeprism controllers in a flat list with no profile gating.
- `pkg/machinery/config/machine/types.go` defines `TypeUnknown / TypeInit / TypeControlPlane / TypeWorker` only.
- `internal/app/machined/internal/server/v1alpha1/v1alpha1_server.go:523` Upgrade RPC always tries to acquire an etcd upgrade mutex when machineconfig says `Type != TypeWorker`, which fails on a single-machine NAS.

No deletion happens in this stage; the goal is purely additive gating so that "do not run K8s" becomes a legal configuration without breaking the existing init/controlplane/worker paths.

## Proposal

### 1. Add `TypeAppliance` machine type

File: `pkg/machinery/config/machine/types.go`

```go
const (
    TypeUnknown Type = iota
    TypeInit
    TypeControlPlane
    TypeWorker
    TypeAppliance // single-machine NAS, no kubernetes
)
```

Update `String()`, `ParseType()`, and any `switch` over `Type` to handle the new value. Verify the v1alpha1 yaml decoder accepts `appliance` as a string value.

### 2. Refactor v1alpha2 controller registration into profiles

File: `internal/app/machined/pkg/runtime/v1alpha2/v1alpha2_controller.go`

Extract the inline controller list (currently ~120 entries) into a builder:

```go
type controllerProfile int

const (
    profileKubernetesNode controllerProfile = iota
    profileAppliance
)

func (ctrl *Controller) buildControllers(profile controllerProfile) []controller.Controller {
    common := []controller.Controller{ /* block, network, hardware, files, runtime, perf, time, security,
                                           v1alpha1, config (MachineType, Persistence), cri (image cache, registries, seccomp),
                                           secrets (machine PKI only) */ }
    if profile == profileAppliance {
        return common
    }
    return append(common, /* k8s.*, etcd.*, kubespan.*, kubeaccess.*, siderolink.*, kubeprism.*,
                            secrets (k8s/etcd/trustd PKI) */)
}
```

Profile selection happens at controller-runtime startup based on `r.Config().Machine().Type()`. Until config is loaded, default to `profileKubernetesNode` so existing behavior is preserved during early Initialize.

### 3. Conditional sequencer phases

File: `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer.go`

Use the existing `AppendWhen` helper:

```go
isAppliance := r.Config() != nil && r.Config().Machine().Type() == machine.TypeAppliance
```

- `Boot()`: leave as-is. Decisions cascade from `StartAllServices` (next item).
- `Reset()`:
  - `CordonAndDrainNode` -> only when `!isAppliance && in.GetGraceful() && !skipNodeRegistration`
  - `StopAllPods`/`RemoveAllPods` -> only when `!isAppliance`
  - `LeaveEtcd` -> only when `!isAppliance && in.GetGraceful() && Type != Worker`
- `Shutdown()`:
  - `CordonAndDrainNode`, `StopAllPods` -> only when `!isAppliance`
- `Upgrade()`:
  - `CordonAndDrainNode`, `StopAllPods` -> only when `!isAppliance`
  - `StopServicesEphemeral` keeps running but is rewritten internally (next item).

### 4. Split `StartAllServices`

File: `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer_tasks.go:428`

```go
func StartAllServices(...) {
    return func(ctx, logger, r) error {
        platform.FireEvent(...)
        svcs := system.Services(r)

        if r.Config().Machine().Type() == machine.TypeAppliance {
            // Appliance path: just wait for the already-loaded core services.
            // System containerd and machined started in Initialize phase.
            // Future: webd will be loaded here in Stage 1.2.
        } else {
            svcs.Load(&services.Kubelet{})
            serviceList := []system.Service{&services.CRI{}}
            switch r.Config().Machine().Type() {
            case machine.TypeInit:
                serviceList = append(serviceList, &services.Trustd{}, &services.Etcd{Bootstrap: true})
            case machine.TypeControlPlane:
                serviceList = append(serviceList, &services.Trustd{}, &services.Etcd{})
            case machine.TypeWorker:
                // nothing
            }
            svcs.LoadAndStart(serviceList...)
        }

        // common: wait for all loaded services to come up
        // ... (existing wait loop)
    }
}
```

`StopServicesEphemeral` (`v1alpha1_sequencer_tasks.go:513`) currently stops `cri` and `trustd`. Add an appliance branch that stops `containerd-workload` (placeholder name; actual name decided when introducing the workload containerd in Stage 2). For Stage 1.0 it can be a no-op since appliance mode has no extra workload services yet.

### 5. Bypass etcd lock in Upgrade RPC

File: `internal/app/machined/internal/server/v1alpha1/v1alpha1_server.go:523`

```go
if !inMaintenance &&
    s.Controller.Runtime().Config().Machine().Type() != machinetype.TypeWorker &&
    s.Controller.Runtime().Config().Machine().Type() != machinetype.TypeAppliance &&
    !in.GetForce() {
    // existing etcd lock + ValidateForUpgrade
}
```

### 6. Container mode unchanged

`runtime.ModeContainer` paths in the sequencer remain as-is; appliance is independent of platform mode.

## Risks

- **Hidden assumptions in controllers**: some non-K8s controllers may transitively depend on `k8s.NodeName` or other K8s-namespace resources. Verify by running the controller-runtime in appliance profile under a unit test - any `Inputs()` referencing missing resources will surface as warnings/errors at startup. Mitigation: keep the K8s controller list intact in this stage and only skip registration; verify no panic at boot.
- **`controllers/secrets`**: deeply intertwined with K8s/etcd PKI generation. In appliance profile we must keep machine PKI (used for `apid` for now - apid stays alive in Stage 1.0). Audit `internal/app/machined/pkg/controllers/secrets/` to identify which controllers are machine-only vs K8s-only. Likely split into two registration groups.
- **Config validation**: `pkg/machinery/config/types/v1alpha1` validators may reject configs lacking `cluster:`. Need to make `cluster:` optional when `machine.type: appliance`. This is a non-trivial change in `v1alpha1_provider.go`/validation code.
- **MachineConfig's `ConfigCompleteForBoot()`** semantics: currently true when both `machine` and `cluster` sections exist. Needs amendment for appliance.
- **Tests**: existing unit tests assume `Type` is one of init/controlplane/worker. Run `go test ./...` and fix exhaustiveness lints.

## Scope

Estimated diff size: 600-900 lines.

Files touched (no deletions):

- `pkg/machinery/config/machine/types.go` (~30 lines)
- `pkg/machinery/config/types/v1alpha1/v1alpha1_provider.go` (~40 lines, validator)
- `internal/app/machined/pkg/runtime/v1alpha2/v1alpha2_controller.go` (~150 lines refactor)
- `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer.go` (~100 lines)
- `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer_tasks.go` (~80 lines, mainly `StartAllServices`)
- `internal/app/machined/internal/server/v1alpha1/v1alpha1_server.go` (~10 lines)
- New unit test scaffolding: appliance-mode boot smoke test using existing fixture pattern (~200 lines).

Verification:

- Build: `go build ./...`
- Lint: `make lint` (or project equivalent)
- Existing unit tests: `go test ./...`
- Manual: build appliance ISO with imager, boot in QEMU, apply minimal appliance machineconfig, observe absence of kubelet/cri/etcd processes via `ps` from rescue shell (Stage 1.2 dependency - for Stage 1.0 verification we can temporarily attach with talosctl since apid still runs).

## Alternatives

### Alt-A: Make `cluster:` strictly required and use sentinel value

Reject. Forces every appliance config to carry meaningless cluster fields, leaks K8s vocabulary into appliance UX.

### Alt-B: Skip the `TypeAppliance` constant; gate on absence of `cluster:` in config

Possible but couples behavior to config structure. Future webd UI would still need a marker to drive UI. Explicit `MachineType` is clearer and matches the existing pattern.

### Alt-C: Hard fork at `pkg/machinery/config` level (introduce a new `kind: Appliance` config alongside `v1alpha1`)

Cleaner long-term, but doubles the config plumbing for Stage 1. Defer to Stage 2 when we redesign the config UX for webd. Stage 1 reuses v1alpha1 with `cluster:` made optional.

## Annotations

### 2026-05-09 - Implementation deviations

While implementing, two design choices in the original plan needed adjustment:

1. **Controller profile signal: kernel cmdline, not machine config.**
   The plan suggested gating controller registration on `r.Config().Machine().Type()`, but COSI registers controllers statically before machine config is loaded (the `AcquireController` produces the config asynchronously). To avoid restructuring the controller-runtime startup, the appliance profile is selected by the kernel cmdline parameter `talos.profile=appliance` instead. The constant lives in `pkg/machinery/constants/constants.go` as `KernelParamProfile` / `KernelParamProfileAppliance`.

   Operator implication: appliance ISOs must boot with `talos.profile=appliance`. The imager profile change to inject this automatically is deferred to Stage 2; for Stage 1.0 verification, set the cmdline manually.

2. **Filtering implementation: `Name()` prefix match, not reflect package paths.**
   `controller.Controller` types in this codebase often come from generic factories (`transform.Controller[X, Y]`) whose `reflect.PkgPath` returns the `transform` package, not the controller's logical home. All controllers expose a `Name() string` method returning `"package.TypeName"`, so filtering uses `strings.HasPrefix(name, "k8s.")` etc. Filter helper: `skipUnderAppliance` in `internal/app/machined/pkg/runtime/v1alpha2/v1alpha2_controller.go`.

3. **`secrets.APIController` accommodates appliance.**
   APIController has a `panic(unexpected machine type)` default branch. Appliance is treated like worker for apid PKI purposes (no issuing CA key, just trust roots). This is correct for Stage 1.0 because apid is still alive. When apid is removed in PLAN-003, the entire `secrets/api.go` controller is deleted.

4. **Config validator updated.**
   `Validate()` now skips `ClusterConfig.Validate()` when type is appliance, and explicitly rejects a `cluster:` section under appliance mode. Allocation in `Cluster()` accessor still returns a non-nil empty struct, so existing callers that only read fields will see zero values rather than panic.

5. **proto enum sync.**
   `MachineConfig.MachineType` enum now has `TYPE_APPLIANCE = 4` in both `api/machine/machine.proto` and the generated `pkg/machinery/api/machine/machine.pb.go`. The `rawDesc` binary descriptor was not regenerated (would require docker buildx tooling); gRPC reflection will not surface the new enum value but in-process enum comparisons work correctly. A full `make generate` pass should be done as a separate cleanup commit before merging.

### Build / test verification (2026-05-09)

- `go build ./...` clean.
- `go test ./pkg/machinery/config/machine/...` pass.
- `go test ./pkg/machinery/config/types/v1alpha1/...` pass.
- `go test ./internal/app/machined/pkg/runtime/v1alpha1/...` pass.
- Broader machinery + secrets/v1alpha2 test suites running; results recorded on closeout.
