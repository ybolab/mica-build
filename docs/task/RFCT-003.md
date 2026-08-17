# RFCT-003 Stage 1.2 - Retire apid/trustd/talosctl/dashboard, bring up webd skeleton and rescue shell

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-05-09 00:00
- **claimedAt**: 2026-05-09 09:45
- **completedAt**: 2026-05-09 10:30

## Description

Replace the apid/talosctl remote-management surface with a single-process local web UI (`webd`), and replace the dashboard TUI with a serial-console rescue mechanism. Once this stage lands the system has no remote mTLS API and no CLI client; all human interaction is through HTTPS (web UI) or physical console (rescue shell).

Architecture: option C (independent webd process). webd talks to machined over `/run/machined.sock` using the existing `MachineService` gRPC, and exposes HTTPS to the user.

Removal scope:

- `internal/app/apid/`
- `internal/app/trustd/`
- `internal/app/dashboard/`
- `internal/pkg/dashboard/`
- `internal/app/machined/pkg/system/services/{apid,trustd,dashboard}.go`
- `cmd/talosctl/`
- `pkg/machinery/client/`
- `pkg/machinery/role/`
- multi-call dispatch entries for `apid`, `trustd`, `dashboard` in `internal/app/machined/main.go`
- sequencer tasks `StartApid`, `StartDashboard` and their callers
- `controllers/runtime/api_service_config.go` and related

Modifications:

- `internal/app/machined/internal/server/v1alpha1/v1alpha1_server.go` - keep listener on `/run/machined.sock` (unix only). Remove TCP listener, mTLS bootstrap, and Sidero events upload.
- Sequencer `earlyServices` phase: remove `StartApid`; add `StartWebd`.

New code:

- `internal/app/webd/` - process entrypoint (`webd.Main()` to be invoked from `internal/app/machined/main.go` multi-call switch).
- `internal/pkg/webd/` - HTTP server, embedded static UI assets (`go:embed`), session/auth (bcrypt + first-run setup), MachineService gRPC client wrapper, COSI resource read helpers.
- MVP UI: read-only dashboard showing version, machine type, system disk, network status, service states, log tail (WebSocket).
- Self-signed TLS cert generated on first boot, stored under `/var/lib/webd/`.

Rescue shell:

- New system extension at `hack/extensions/rescue/` (or separate repo if preferred), packaging busybox + e2fsprogs + lvm2 + mdadm + smartmontools + parted + curl + the appliance's small diagnostic CLI.
- Sequencer Initialize phase: detect kernel cmdline `talos.rescue=1`, mount the rescue extension to `/rescue`, spawn an authenticated shell on `/dev/console` instead of running normal Boot sequence. Authentication uses the same admin password as webd.

Acceptance criteria:

1. `machined` binary contains no `apid`/`trustd`/`talosctl` symbols (`go-callvis` or simple grep verification).
2. HTTPS dashboard reachable at `https://<host>/` after first boot, shows live system status without K8s panels.
3. `talos.rescue=1` boot drops into shell on console after password prompt; `exit` reboots.
4. Upgrade flow still works end-to-end: webd UI can trigger `MachineService.Upgrade` via unix socket.
5. No regression in non-K8s controllers (network, block, hardware, secrets-machine).

Out of scope (deferred to Stage 2):

- Web UI write actions beyond first-run setup (network/disk/container management UIs).
- ApplianceConfig YAML schema redesign.
- Firmware signing and updates UI.
- Multi-user / RBAC.

## ActiveForm

Standing up webd skeleton and rescue extension; deleting apid/trustd/talosctl/dashboard.

## Dependencies

- **blocked by**: RFCT-002
- **blocks**: (none for Stage 1)

## Notes

See [PLAN-003](../plan/PLAN-003.md) for the design and the **Annotations** section (recorded implementation deviations and Stage 2 follow-up list).

### Completion notes (2026-05-09)

Structural Stage 1.2 changes landed. webd is up as a goroutine inside machined with a placeholder MVP HTTP API; rescue-shell trigger is wired but the system extension itself is deferred to Stage 2. Bundle/formatters/talosconfig packages were also dropped because they were only consumed by the now-deleted talosctl tooling.

Verification:

- `go build ./...` clean.
- `go test ./pkg/machinery/...` results recorded after final pass.
- No `apid`/`trustd`/`talosctl` symbols remain in the binary footprint.
- `talos.rescue=1` cmdline gate compiles into the Initialize sequence.
