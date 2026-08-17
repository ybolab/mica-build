# PLAN-002 Stage 1.1 - Delete K8s/etcd/cluster/provision/integration code

- **status**: completed
- **createdAt**: 2026-05-09 00:00
- **approvedAt**: 2026-05-09 07:50
- **completedAt**: 2026-05-09 09:30
- **relatedTask**: RFCT-002

## Context

Stage 1.0 (PLAN-001) makes the appliance path runnable without exercising any K8s code. Stage 1.1 then permanently removes that code so the project no longer carries Kubernetes as latent functionality. This is a one-way commitment: after this stage, the codebase cannot be configured to run K8s without reverting the deletion.

Why now: keeping dead K8s code around inflates the binary, confuses future contributors, prolongs CI, and forces every refactor to consider compatibility with paths that will never be reachable. Get rid of it before building webd on top.

Stage 1.0 must be merged before this stage starts. RFCT-001's tests continue to be valid here (they boot in appliance mode which does not touch any of the deleted code).

## Proposal

Removal happens in dependency order to keep the tree compilable after each step. Each numbered group is one logical commit.

### Step 1: Remove K8s controllers

Delete:

- `internal/app/machined/pkg/controllers/k8s/` (entire directory)
- `internal/app/machined/pkg/controllers/etcd/`
- `internal/app/machined/pkg/controllers/kubespan/`
- `internal/app/machined/pkg/controllers/kubeaccess/`
- `internal/app/machined/pkg/controllers/siderolink/`

Update `internal/app/machined/pkg/runtime/v1alpha2/v1alpha2_controller.go`:

- Remove imports of the deleted packages.
- The `buildControllers` function from PLAN-001 collapses: `profileKubernetesNode` no longer has anything to add over `profileAppliance`. Delete the profile concept entirely; keep only the appliance controller list. Rename `buildControllers` -> direct inline registration.

### Step 2: Remove K8s/etcd services

Delete:

- `internal/app/machined/pkg/system/services/kubelet.go`
- `internal/app/machined/pkg/system/services/cri.go`
- `internal/app/machined/pkg/system/services/etcd.go`

Update `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer_tasks.go`:

- Delete the `else` branch in `StartAllServices` from PLAN-001 (the K8s path). Inline the appliance-only path as the only behavior.
- Delete tasks: `CordonAndDrainNode`, `StopAllPods`, `RemoveAllPods`, `LeaveEtcd`, `KubeletConfig`-related tasks (verify by grep).
- `StopServicesEphemeral` becomes a no-op or stops only future workload-containerd (TBD in Stage 2). Keep the function signature for now to minimize sequencer churn.

Update `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer.go`:

- All `AppendWhen(!isAppliance, ...)` calls from PLAN-001 collapse to no-op; remove those lines entirely.
- `Reset()`, `Shutdown()`, `Upgrade()` lose drain/leave phases.

### Step 3: Remove K8s machine.proto RPC implementations

File: `internal/app/machined/internal/server/v1alpha1/v1alpha1_server.go`

Replace bodies of these RPCs with `return nil, status.Error(codes.Unimplemented, "kubernetes-related RPC removed in appliance mode")`:

- `Bootstrap`
- `EtcdLeaveCluster`, `EtcdMemberList`, `EtcdRemoveMember`, `EtcdSnapshot`, `EtcdRecover`, `EtcdAlarmList`, `EtcdAlarmDisarm`, `EtcdDefragment`, `EtcdStatus`, `EtcdForfeitLeadership`
- `KubeconfigRaw`
- The K8s namespace branches inside `Containers()`

Do not delete `.proto` definitions yet; those are removed in a later proto cleanup pass alongside webd API definition (Stage 2).

### Step 4: Remove K8s installer hooks

File: `cmd/installer/pkg/install/install.go`

- Remove image cache pre-pull paths that reference `k8s.io/kubelet`, `pause` image, etc.
- Remove kubelet-related META values handling.

File: `internal/pkg/install/install.go`

- Trim mounts for kubelet directories.

### Step 5: Remove cluster/provision/kubeconfig/kubernetes packages

Delete:

- `pkg/cluster/`
- `pkg/provision/`
- `pkg/kubeconfig/`
- `pkg/kubernetes/`

These are talosctl-side helpers; safe to delete after Steps 1-3 since machined no longer references them. Note: `cmd/talosctl/` itself still imports these - that's fine because talosctl is removed wholesale in PLAN-003. To keep the tree compilable, delete the offending talosctl subcommands (`cluster`, `kubeconfig`, `bootstrap`, etc.) in this step too:

- `cmd/talosctl/cmd/talos/cluster*.go`
- `cmd/talosctl/cmd/talos/kubeconfig.go`
- `cmd/talosctl/cmd/talos/bootstrap.go`
- `cmd/talosctl/cmd/talos/etcd*.go`

### Step 6: Remove K8s-shaped resource types

Delete:

- `pkg/machinery/resources/k8s/`
- `pkg/machinery/resources/etcd/`
- `pkg/machinery/resources/kubespan/`
- `pkg/machinery/resources/kubeaccess/`
- `pkg/machinery/resources/siderolink/`

Verify no remaining import via grep.

### Step 7: Remove K8s config types

File: `pkg/machinery/config/types/v1alpha1/`

Delete:

- `v1alpha1_clusterconfig.go`
- `v1alpha1_apiserverconfig.go`
- `v1alpha1_admissionplugin.go`
- `v1alpha1_authorizaationconfigauthorizer.go`
- `v1alpha1_cniconfig.go`
- `v1alpha1_controllermanagerconfig.go`
- `v1alpha1_discoveryconfig.go`
- `v1alpha1_etcdconfig.go`
- `v1alpha1_externalcloudproviderconfig.go`
- `v1alpha1_inlinemanifest.go`
- `v1alpha1_kubernetestalosapiaccess.go`
- `v1alpha1_proxyconfig.go`
- `v1alpha1_schedulerconfig.go`
- corresponding test files

Update `v1alpha1_clusterconfig.go`'s callers in `v1alpha1_provider.go` to remove all `Cluster()`-returning methods. Make `cluster:` field disappear from the schema entirely (no longer optional, just gone).

### Step 8: Trim secrets controllers

File: `internal/app/machined/pkg/controllers/secrets/`

Audit each controller. Delete those whose sole purpose is K8s/etcd PKI:

- `kubernetes.go`, `kubernetes_dynamic_certs.go`
- `etcd.go`
- `api.go` (if it generates apid PKI - keep for now since apid still runs in Stage 1.1; deletion happens in PLAN-003)
- `kubelet.go`
- `trustd.go` (delete in PLAN-003)
- `maintenance*.go` (audit case-by-case)

Keep:

- `machine_id.go` and any controller producing machine identity / hostname certificates that webd may need.
- `root.go` if it produces a root CA used by self-signed UI certs (assess).

### Step 9: Remove integration tests and CI

Delete:

- `internal/integration/`
- `hack/test/`
- CI workflows referencing removed paths (`.github/workflows/*`)

CI must still build and run remaining unit tests. Replace integration job with a placeholder (smoke test that boots an appliance ISO in QEMU and pings webd - implemented in Stage 2).

### Step 10: Final sweep

- `grep -r "kubernetes\.io\|kubeconfig\|etcd\.Client\|siderolink\|kubespan" --include="*.go"` should return zero hits outside `vendor/` and any deliberately preserved test fixtures.
- Update `README.md` and any top-level docs to reflect the appliance-only scope.

## Risks

- **Compilation breakage between steps**: each step may cascade. Mitigation: do all 10 steps on a single branch with one commit per step; rebase as needed; only push once `go build ./...` passes at every commit.
- **Hidden third-party consumers**: `pkg/machinery/*` is published as a Go module that downstream tooling imports. Removing entire packages breaks SemVer. Decision: this fork is now an appliance project, not Talos; bump module path or version 2.0 to make the break explicit. Document in commit message.
- **secrets/machine PKI surface**: incorrect deletion will break apid (still alive in this stage). Test by booting after Step 8 and confirming apid health.
- **Imager profile**: `pkg/imager/` references some K8s-specific images. Audit and prune in this stage to keep installer container builds working.
- **META tag space**: `pkg/machinery/meta/constants.go` has reserved tag values for K8s scenarios (e.g. encryption configs that reference K8s secrets). Don't reuse those numeric values; mark them as deprecated/reserved to preserve forward compat with existing META blobs.
- **Volumes**: `pkg/xfs/`, `pkg/makefs/`, `controllers/block/` are heavily used and **must remain**. Don't accidentally delete anything tagged `k8s` that is actually generic block management.

## Scope

Estimated diff: -40000 to -60000 lines (mostly deletions, including generated proto and tests).

Touch points: ~60 directories deleted, ~15 files modified.

Verification gates after each step:

| Step | Gate |
|------|------|
| 1 | `go build ./...` |
| 2 | `go build ./...`, machined boots appliance config |
| 3 | `go build ./...`, apid still serves non-K8s RPCs |
| 4 | installer container build succeeds |
| 5 | `go build ./...`, talosctl basic commands (logs/dmesg) still work |
| 6 | `go build ./...` |
| 7 | `go build ./...`, machineconfig parser accepts appliance YAML and rejects K8s YAML |
| 8 | apid health check passes; machine PKI controllers continue producing certs |
| 9 | CI green |
| 10 | grep clean; manual smoke test |

## Alternatives

### Alt-A: Keep K8s code under build tag `kubernetes`

Rejected. Build tags add maintenance overhead and the appliance project will never re-enable Kubernetes.

### Alt-B: Mark code dead but keep the files

Rejected. Half-deleted code rots faster than fully present or fully absent.

### Alt-C: Defer to a separate "Stage 1.1.5" later

Rejected. The longer K8s code stays, the more new code (webd) accidentally depends on shared types. Cut it before building.

## Annotations

### 2026-05-09 - Scope adjustment

The original plan called for deleting K8s schema/resource types alongside the runtime code. During implementation that scope proved too invasive — the v1alpha1 config schema is deeply wired into the proto vtproto generated code and the public `pkg/machinery/config/config` interface, and removing it cascades into hundreds of build errors. I scoped Stage 1.1 down to **runtime-only deletions**, keeping the schema layer compiling.

**Actually deleted in Stage 1.1**:

- `internal/app/machined/pkg/controllers/{k8s,etcd,cluster,kubespan,kubeaccess,siderolink}/` (entire dirs)
- `internal/app/machined/pkg/system/services/{kubelet,cri,etcd,dashboard}.go`
- `internal/app/machined/internal/server/v1alpha1/v1alpha1_cluster.go`
- `internal/app/machined/pkg/controllers/runtime/internal/diagnostics/{address_overlap,kubelet_csr_not_approved}*.go`
- `internal/app/machined/pkg/controllers/secrets/{root,kubelet,kubernetes,etcd,kubernetes_cert_sans,kubernetes_dynamic_certs}*.go`
- `internal/app/machined/pkg/controllers/files/{iqn,nqn}.go` (depended on cluster identity; reinstate when an alternative ID source is wired up)
- `internal/app/machined/pkg/adapters/{cluster,k8s,kubespan}/`
- `internal/pkg/dashboard/`, `internal/app/dashboard/`
- `internal/pkg/etcd/`
- `internal/pkg/discovery/registry/kubernetes.go`
- `pkg/cluster/`, `pkg/provision/`, `pkg/kubeconfig/`, `pkg/kubernetes/`
- `pkg/rotate/`
- `internal/integration/`, `hack/test/`
- `cmd/talosctl/cmd/mgmt/cluster/`, `cmd/talosctl/cmd/mgmt/inject/`, related launchers
- `cmd/talosctl/cmd/talos/{bootstrap,etcd,kubeconfig,health,conformance,upgrade-k8s,rotate-ca,dashboard,drain,crashdump,support}.go`
- `cmd/talosctl/pkg/talos/{kubeclient,nodedrain}/`

Server-side RPC stubs converted to `Unimplemented` (delete the method, fall back to `UnimplementedMachineServiceServer` defaults):

- `Bootstrap`, `Kubeconfig`
- `EtcdMemberList`, `EtcdRemoveMemberByID`, `EtcdLeaveCluster`, `EtcdForfeitLeadership`, `EtcdSnapshot`, `EtcdRecover`, `EtcdAlarmList`, `EtcdAlarmDisarm`, `EtcdDefragment`, `EtcdStatus`, `EtcdDowngradeCancel`, `EtcdDowngradeEnable`, `EtcdDowngradeValidate`
- `tryLockUpgradeMutex` helper and `MinimumEtcdUpgradeLeaseLockSeconds` constant removed

**Surgical edits, not deletions** (kept files but trimmed K8s coupling):

- `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer.go`: Reset/Shutdown/Upgrade/Reboot/StageUpgrade phases dropped K8s gating (now unconditional appliance behavior)
- `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer_tasks.go`: removed `CordonAndDrainNode`, `LeaveEtcd`, `StopAllPods`, `RemoveAllPods`, `waitForKubeletLifecycleFinalizers`, `stopAndRemoveAllPods` tasks; collapsed `StartAllServices` to no-op (system containerd already started in Initialize); `StopServicesEphemeral` is a no-op now
- `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_runtime.go`: `NodeName()` returns `os.Hostname()`; `IsBootstrapAllowed()` always returns false
- `internal/app/machined/pkg/runtime/v1alpha2/v1alpha2_controller.go`: dropped K8s/etcd/cluster/kubespan/kubeaccess/siderolink controller registrations and the appliance filter (now redundant); the K8s-specific `secrets/*` controllers are also gone from the registration
- `internal/app/machined/pkg/runtime/v1alpha2/v1alpha2_state.go`: dropped K8s/etcd/cluster/kubespan/kubeaccess/siderolink namespace and resource-type registrations (the resource Go types still compile but are not registered with the COSI runtime)
- `internal/app/machined/pkg/controllers/runtime/maintenance_config.go`: maintenance API listens on all addresses (no SideroLink VPN to bind to)
- `internal/app/machined/pkg/controllers/runtime/diagnostics.go` and `internal/app/machined/pkg/controllers/runtime/internal/diagnostics/diagnostic.go`: drop K8s inputs; `Checks()` returns nil
- `internal/app/machined/pkg/controllers/runtime/machine_status.go`: dropped staticPods/nodeReady checks; required-services list trimmed to `apid` and `machined`
- `internal/app/machined/pkg/controllers/cri/image_gc.go`: removed kubelet/etcd image-pinning inputs
- `internal/app/machined/pkg/controllers/network/operator/vip.go`: replaced etcd-based leader election with unconditional VIP claim (single-machine appliance)
- `internal/app/machined/pkg/controllers/network/{address_event,nftables_chain_config,hostname_config}.go`: removed `k8s.NodeAddressFilterNoK8s`-filtered ID lookups; consume the unfiltered IDs directly. `hostname_config.go` lost the stable-from-cluster-identity hostname mode (no-op when requested)
- `internal/app/machined/pkg/controllers/network/dns_resolve_cache.go`: `ReadMembers` returns empty (DNS still forwards via upstream)
- `internal/pkg/dns/manager.go`: introduced a local `Member` struct, no longer reaches into `pkg/machinery/resources/cluster`
- `internal/app/machined/pkg/controllers/secrets/api.go`: appliance routes through the controlplane PKI generation path (self-signed locally, no trustd needed); worker path's K8s endpoint discovery removed (worker stays compile-only)
- `internal/app/machined/main.go`: removed `dashboard` multi-call dispatch entry
- `cmd/talosctl/cmd/talos/{reboot,upgrade}.go`: removed `--drain`/`--drain-timeout` flags and the kubelet drain wrapper
- `cmd/talosctl/cmd/talos/get.go`: `CompleteNodes` shell-completion returns empty (no cluster member discovery)
- `cmd/talosctl/cmd/{root,mgmt/root,docs}.go`: trimmed cluster/inject command groups and K8s/SideroLink doc generation entries

**Deferred (acceptable schema debt)**:

- The K8s-related schema types in `pkg/machinery/config/types/v1alpha1/` (apiserver, controllermanager, scheduler, proxy, cni, discovery, etcd, externalcloudprovider, inlinemanifest, kubernetestalosapiaccess, admissionplugin, authorizaationconfigauthorizer, clusterconfig) and their interfaces in `pkg/machinery/config/config/{cluster,k8s,kubespan,siderolink}.go` remain. The validator already rejects appliance configs that include a `cluster:` section, so the schema is unreachable at runtime.
- `pkg/machinery/resources/{k8s,etcd,cluster,kubespan,kubeaccess,siderolink}/` resource Go types remain (referenced by generated proto and the schema). They are no longer registered with the COSI runtime, so they have no runtime effect, but they still compile.
- `pkg/machinery/config/generate/{controlplane,init,worker,kubernetes}.go` cluster bootstrap config generators remain. No callers in this repo after talosctl K8s commands were removed.
- `MachineType` constants `TypeInit` / `TypeControlPlane` / `TypeWorker` remain; only `TypeAppliance` (and `TypeUnknown`) have working runtime paths. Future schema cleanup can collapse these.
- A follow-up task (Stage 1.1.5 or part of Stage 2) should run `make generate` to refresh proto descriptors and prune the unused schema/resource layers.

### Verification

- `go build ./...` clean.
- `go test ./...` results recorded in RFCT-002 closeout notes.
