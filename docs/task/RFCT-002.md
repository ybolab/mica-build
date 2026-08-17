# RFCT-002 Stage 1.1 - Delete K8s/etcd/cluster/provision/integration code

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-05-09 00:00
- **claimedAt**: 2026-05-09 08:20
- **completedAt**: 2026-05-09 09:30

## Description

Remove all Kubernetes and cluster-management code now that the appliance path established in RFCT-001 makes them unreachable. Goal is to permanently lock the project into single-machine appliance mode and shed roughly 30-40 percent of the source tree.

Removal scope (full directory deletion unless noted):

- `internal/app/machined/pkg/controllers/k8s/`
- `internal/app/machined/pkg/controllers/etcd/`
- `internal/app/machined/pkg/controllers/kubespan/`
- `internal/app/machined/pkg/controllers/kubeaccess/`
- `internal/app/machined/pkg/controllers/siderolink/`
- `internal/app/machined/pkg/system/services/{kubelet,cri,etcd}.go`
- `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer_tasks.go` - delete tasks `CordonAndDrainNode`, `StopAllPods`, `RemoveAllPods`, `LeaveEtcd`, `StopServicesEphemeral` (replace with appliance equivalents), kubelet helpers
- `pkg/cluster/`
- `pkg/provision/`
- `pkg/kubeconfig/`
- `pkg/kubernetes/`
- `internal/integration/`
- `hack/test/`
- `pkg/machinery/config/types/v1alpha1/v1alpha1_clusterconfig.go` plus apiserver/controllermanager/scheduler/proxy/etcd/cni/discovery configs
- `pkg/machinery/resources/k8s/`, `pkg/machinery/resources/etcd/`, `pkg/machinery/resources/kubespan/`, `pkg/machinery/resources/kubeaccess/`, `pkg/machinery/resources/siderolink/`
- `controllers/secrets/` - delete K8s/etcd PKI controllers, keep machine PKI for now
- `cmd/installer/pkg/install/` - remove K8s install hooks (image pre-pull paths for kubelet, etc.)

API surface:

- Keep `pkg/machinery/api/machine/machine.proto` files but mark K8s/etcd/cluster RPCs as `Unimplemented` in the server. Proto cleanup deferred.
- Drop `pkg/machinery/api/cluster/`, `pkg/machinery/api/storage/k8s` if any.

Acceptance criteria:

1. Repo builds with `go build ./...` after deletions.
2. `machined` binary boots an appliance config without referencing any deleted package.
3. No remaining reference to `kubernetes.io`, `kubeconfig`, `etcd.Client`, `siderolink`, `kubespan` outside test fixtures (verify with grep).
4. CI green on the (much shrunken) test set.

## ActiveForm

Stripping Kubernetes and cluster-management code from the tree.

## Dependencies

- **blocked by**: RFCT-001
- **blocks**: RFCT-003

## Notes

See [PLAN-002](../plan/PLAN-002.md) for the design and ordered removal plan, including the **Annotations** section which records the actual implementation scope (runtime-only deletion; schema layer kept).

### Completion notes (2026-05-09)

Per PLAN-002 annotations: the deletion sweep removed all runtime K8s/etcd/cluster/kubespan/kubeaccess/siderolink controllers, services, integration tests, and talosctl K8s subcommands. The K8s/cluster schema (config types, resource Go types, config interface) was kept to keep the diff tractable — runtime registration of those resources is gone, so they have no effect at runtime. Future schema cleanup is tracked as a follow-up.

Verification:

- `go build ./...` clean
- `go test ./...` results below.
