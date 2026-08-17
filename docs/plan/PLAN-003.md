# PLAN-003 Stage 1.2 - Retire apid/trustd/talosctl/dashboard, bring up webd skeleton and rescue shell

- **status**: completed
- **createdAt**: 2026-05-09 00:00
- **approvedAt**: 2026-05-09 07:50
- **completedAt**: 2026-05-09 10:30
- **relatedTask**: RFCT-003

## Context

After PLAN-002 the codebase is K8s-free but still ships:

- `apid` - mTLS gRPC server that proxies to `/run/machined.sock`. In single-machine appliance mode it adds zero value beyond debug access for talosctl.
- `trustd` - issues PKI for inter-node apid trust. Single machine, no use.
- `talosctl` - CLI talking to apid.
- `dashboard` - TUI on console TTY reading apid via `internal/pkg/dashboard/apidata`.

This stage cuts all four and replaces them with:

- `webd` - new daemon serving HTTPS to the local network, MVP read-only. Talks to machined over `/run/machined.sock`. Process model: option C, independent process started by machined's service supervisor (consistent with the existing multi-call binary pattern).
- `rescue` - kernel-cmdline-triggered shell on serial console, backed by a system extension that ships busybox + diagnostic tools.

After this stage there is no remote mTLS API, no CLI client, and no TUI. All human interaction is HTTPS or physical serial console.

Architecture decision: option C (webd as separate process) was selected over option B (in-process inside machined) to isolate UI crashes from PID 1.

## Proposal

### Part A: Webd skeleton

#### A1. Process entrypoint

New file: `internal/app/webd/main.go`

```go
package webd

func Main() {
    // standard signal handling, structured logging via zap, listen on https://0.0.0.0:443
    // graceful shutdown on SIGTERM
    // calls into internal/pkg/webd to start the server
}
```

Modify `internal/app/machined/main.go` multi-call switch (currently dispatches `apid`, `trustd`, `dashboard`, `poweroff/shutdown`):

```go
case "webd":
    webd.Main()
    return
```

#### A2. Service definition for the supervisor

New file: `internal/app/machined/pkg/system/services/webd.go`

Implements `system.Service` and `system.HealthcheckedService`:

- `ID()` returns `"webd"`
- `Runner()` returns a `process.NewRunner` invoking `/sbin/webd` (multi-call binary path); restart forever; cgroup `system-runtime`; selinux label `system_u:object_r:system_runtime_t:s0`; drops capabilities except those required for binding :443 (use ambient CAP_NET_BIND_SERVICE) and reading machined socket.
- `HealthFunc()` HTTP GET to `https://127.0.0.1/healthz`.
- `DependsOn()` returns `["containerd"]` only - webd has no K8s deps.

#### A3. Sequencer wiring

File: `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer.go`

In `Initialize()` `earlyServices` phase:

- Replace `StartApid` with `StartWebd` (apid is removed in Part B).

File: `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer_tasks.go`

Add task `StartWebd` mirroring the existing `StartApid` shape (~30 lines).

#### A4. Internal package layout

New directory: `internal/pkg/webd/`

```text
internal/pkg/webd/
├── server.go           # HTTP/HTTPS server, routing, middleware
├── auth/               # bcrypt admin password, sessions, first-run setup
│   ├── auth.go
│   └── session.go
├── machined/           # gRPC client wrapper around /run/machined.sock
│   └── client.go
├── cosi/               # COSI resource read helpers (network, block, hardware, runtime)
│   └── resources.go
├── api/                # internal HTTP handlers (REST/JSON)
│   ├── status.go       # GET /api/status -> version, uptime, type
│   ├── disks.go        # GET /api/disks
│   ├── network.go      # GET /api/network
│   ├── services.go     # GET /api/services
│   ├── logs.go         # GET /api/logs/stream (WebSocket)
│   └── auth.go         # POST /api/auth/login, /api/auth/setup
└── ui/                 # embedded static assets via go:embed
    ├── embed.go
    └── dist/           # built static SPA (HTML+CSS+JS, no CDN deps)
```

#### A5. TLS bootstrap

On first start:

- If `/var/lib/webd/state/cert.pem` missing, generate self-signed cert (RSA-2048 or ECDSA-P256) for the machine hostname + all detected IP addresses; write to `/var/lib/webd/state/cert.pem` + `key.pem` with mode 0600.
- Refresh on next boot if hostname or IPs changed.

LetsEncrypt / user-provided cert support deferred to Stage 2.

#### A6. Auth bootstrap

On first request, if `/var/lib/webd/state/admin.json` missing:

- Serve a setup wizard at `/setup`.
- Accept POST with desired admin username + password.
- Hash password with bcrypt cost 12, write `admin.json`.

Subsequent requests require session cookie obtained via `/api/auth/login`.

#### A7. MVP UI scope

Read-only views only:

- System overview (hostname, version, uptime, machine type)
- Disks list (from COSI `block.Disk`)
- Network status (from COSI `network.LinkStatus`, `network.AddressStatus`)
- Services status (from `/run/machined.sock` `MachineService.ServiceList`)
- Live logs (WebSocket streaming `MachineService.Logs`)
- Reboot / shutdown buttons (require password re-entry)

No write actions for configuration in MVP.

### Part B: Retire apid/trustd/talosctl/dashboard

#### B1. Delete code

- `internal/app/apid/`
- `internal/app/trustd/`
- `internal/app/dashboard/`
- `internal/pkg/dashboard/`
- `internal/app/machined/pkg/system/services/apid.go`
- `internal/app/machined/pkg/system/services/trustd.go`
- `internal/app/machined/pkg/system/services/dashboard.go`
- `cmd/talosctl/`
- `pkg/machinery/client/`
- `pkg/machinery/role/`
- `internal/app/machined/pkg/controllers/runtime/api_service_config.go` and related controllers
- `pkg/machinery/api/cluster/` (if not already removed)
- Remaining `secrets/api.go`, `secrets/trustd.go` controllers

#### B2. Modify multi-call dispatcher

File: `internal/app/machined/main.go`

Remove the `case "apid"`, `case "trustd"`, `case "dashboard"` branches. Final switch contains only `webd`, `poweroff/shutdown`, `machined` (default).

#### B3. Modify sequencer

File: `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer.go`

Initialize phase:

- `earlyServices` was `[StartUdevd, StartMachined, StartApid, StartAuditd, StartSyslogd, StartContainerd]`.
- Becomes: `[StartUdevd, StartMachined, StartAuditd, StartSyslogd, StartContainerd, StartWebd]` (StartWebd added in A3).
- The dashboard `AppendWithDeferredCheck` block is deleted.

Delete sequencer tasks: `StartApid`, `StartDashboard` from `v1alpha1_sequencer_tasks.go`.

#### B4. machined gRPC server: unix-socket only

File: `internal/app/machined/internal/server/v1alpha1/v1alpha1_server.go`

- Keep listener on `/run/machined.sock`.
- Delete TCP listener creation (used to be exposed via apid).
- Delete mTLS bootstrap (root CA loading, peer cert verification).
- Delete `events` upload to SideroLink (handled in PLAN-002 Step 1, double-check).

Audit `Server` struct fields: drop anything no longer needed (`ca`, `tlsConfig`, `nodeAddress` for inter-node forwarding).

#### B5. Proto cleanup (deferred subset)

Keep `pkg/machinery/api/machine/machine.proto` for now. webd consumes it via the unix socket. A focused proto rewrite (replacing it with a tighter appliance-specific service) is Stage 2 work; PLAN-003 does not change `.proto` files except for removing whatever was auto-generated for deleted services.

### Part C: Rescue shell

#### C1. System extension layout

New directory (separate repo recommended for cleanliness, but can live in-tree initially): `hack/extensions/rescue/`

```text
hack/extensions/rescue/
├── manifest.yaml       # Talos extension manifest
├── rootfs/
│   ├── usr/local/sbin/rescue-shell    # entrypoint script
│   ├── usr/local/bin/                 # busybox + tools
│   └── etc/rescue/motd
└── README.md
```

Tools shipped: busybox (full), e2fsprogs, xfsprogs, btrfs-progs, lvm2, mdadm, smartmontools, parted, gdisk, curl, wget, openssh-client (for off-machine debugging only - no daemon), strace, lsof, tcpdump, vim-tiny, less.

#### C2. Sequencer trigger

File: `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer.go`

In `Initialize()` after `earlyServices`, add a deferred-check phase:

```go
phases.AppendWithDeferredCheck(
    func() bool {
        rescue := procfs.ProcCmdline().Get("talos.rescue").First()
        return pointer.SafeDeref(rescue) == "1"
    },
    "rescue",
    EnterRescueShell,
)
```

The `EnterRescueShell` task (new in `v1alpha1_sequencer_tasks.go`):

1. Mount `/usr/local/rescue.squashfs` (delivered by the rescue system extension) at `/rescue`.
2. Prompt for admin password on `/dev/console` (read from `/var/lib/webd/state/admin.json`; if absent allow unauthenticated entry the first time and warn).
3. `chroot /rescue /usr/local/sbin/rescue-shell`.
4. On exit, reboot.

This task **does not return**; it parks Initialize until the operator finishes the rescue session.

#### C3. Rescue trigger from boot menu

For sd-boot UKI: add an alternate UKI entry `Talos-Rescue.efi` with kernel cmdline including `talos.rescue=1`. Built by imager based on a new profile flag `--with-rescue-entry`.

For grub: add an extra menu entry pointing to the same kernel/initramfs but with extra cmdline `talos.rescue=1`.

This is bootloader plumbing in `internal/app/machined/pkg/runtime/v1alpha1/bootloader/`. Keep MVP simple: only support UKI/sd-boot path for rescue; grub path can come later.

#### C4. Audit logging

`EnterRescueShell` writes a runtime event before chroot:

```go
r.Events().Publish(ctx, &runtime.RescueShellEntered{Timestamp: ..., AuthMethod: ...})
```

Persisted to syslog (already running in earlyServices).

### Verification

| Check | Method |
|-------|--------|
| webd reachable on first boot | `curl -k https://<ip>/setup` returns setup wizard |
| webd shows live data | Manual: open `/`, observe disk/network/services |
| WebSocket logs stream | Manual: open Logs tab, observe real-time output |
| Rescue trigger | Set `talos.rescue=1` in cmdline, reboot, observe shell prompt |
| No apid/trustd processes | `ps` (from rescue shell) shows only machined, webd, containerd, syslogd, auditd, udevd |
| machined unix socket-only | `ss -tlnp` shows no TCP listeners owned by machined |
| Upgrade path | Trigger upgrade via webd UI; observe new UKI written, reboot, version bumped |

## Risks

- **webd scope creep**: easy to slip into "let's add network config UI now". Keep MVP strictly read-only; defer write actions to Stage 2 even if tempting.
- **Multi-call binary size**: webd embeds static UI assets. Size budget: keep entire `machined` binary under 200 MiB even with embedded UI. If SPA bundle gets large, lazy-load assets from disk under `/var/lib/webd/ui/` instead of embedding.
- **Rescue auth bootstrap chicken-and-egg**: if webd setup hasn't run, no admin password exists. Decision: allow unauthenticated rescue **only** when `/var/lib/webd/state/admin.json` is missing AND a physical console is detected (TTY on /dev/console with `isatty`). Document this clearly.
- **Hidden apid consumers**: some controllers may publish events that target apid's TCP listener. Audit `controllers/runtime/api_service_config.go` and related before deletion.
- **Image cache controllers' K8s registry hooks**: `controllers/cri/registries.go` historically wired into K8s registry mirror config. After PLAN-002 it should be K8s-clean, but verify no compilation lingers.
- **Self-signed cert friction**: every browser will warn. Document for end users; ship a "download root CA" button in webd to install on the user's machine.
- **Concurrency edge cases between webd and machined**: machined's existing sequencer locks (priority lock in `v1alpha1_priority_lock.go`) handle concurrent ops. webd just calls into the same gRPC server, so semantics are identical. No new lock primitives needed.

## Scope

Estimated diff: net **+8000 to +12000 lines** (webd is new code; rescue extension manifest+scripts ~500 lines; deletions partly offset).

Touch points:

- New: `internal/app/webd/`, `internal/pkg/webd/`, `hack/extensions/rescue/`, `internal/app/machined/pkg/system/services/webd.go`
- Modified: `internal/app/machined/main.go`, sequencer, sequencer_tasks, machined gRPC server, bootloader (sd-boot rescue entry)
- Deleted: `internal/app/apid/`, `internal/app/trustd/`, `internal/app/dashboard/`, `internal/pkg/dashboard/`, three service files, `cmd/talosctl/`, `pkg/machinery/client/`, `pkg/machinery/role/`, related secrets controllers

## Alternatives

### Alt-A: webd in-process inside machined (option B)

Rejected per user decision. Risk of UI crash taking down PID 1 outweighs the IPC overhead saved.

### Alt-B: Use a third-party UI framework instead of building our own SPA

Open question. Candidates: htmx + server-side rendering (simplest), Vue/React (more app-like). MVP can ship with htmx + plain HTML and migrate later. Decision deferred to implementation; the framework choice does not affect this plan's structure.

### Alt-C: Rescue shell as a containerd container instead of system extension + chroot

Rejected. If containerd or the rootfs is what's broken, a containerd-based rescue is unreachable. Rescue must be self-contained in initramfs / ESP-accessible storage. System extension fits this constraint - it's mounted from the squashfs image which is already on the BOOT partition.

### Alt-D: Keep dashboard TUI, just remove its apid backend

Rejected. Wiring dashboard to read directly from COSI inside machined process violates separation; alternative IPC adds complexity. Web UI subsumes dashboard's role for users with a screen, rescue shell covers headless cases.

## Annotations

### 2026-05-09 - Implementation deviations and scope

The Stage 1.2 implementation lands the **structural** changes; webd's MVP feature surface (auth, COSI/machined wiring, live data) is a thin placeholder that subsequent stages will fill in.

**Actually deleted in Stage 1.2**:

- `internal/app/apid/` and `internal/app/trustd/` (entire dirs)
- `internal/app/machined/pkg/system/services/{apid,trustd}.go`
- `cmd/talosctl/` (entire CLI tree)
- `pkg/machinery/client/` (mTLS Talos API SDK)
- `pkg/grpc/middleware/auth/basic/` (talosctl basic-auth helper)
- `pkg/grpc/gen/remote.go` (trustd remote PKI generator)
- `internal/pkg/cri/` (kubelet CRI client)
- `internal/pkg/containers/cri/{cri,cri_test}.go` (kept `containerd/` subpackage)
- `cmd/installer/pkg/install/errata.go` (pre-Talos-1.8 backward-compat shim)
- multi-call dispatch entries for `apid`/`trustd` in `internal/app/machined/main.go`

**Restored after over-aggressive deletion**:

- `pkg/machinery/role/` — kept; consumed by the `pkg/grpc/middleware/authz/` middleware which is still active for the unix-socket gRPC server (peer credentials map to `role.Set`).

**Surgical edits**:

- `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer_tasks.go`:
  - removed `StartApid`; added `StartWebd` in its place
  - added `EnterRescueShell` task
- `internal/app/machined/pkg/runtime/v1alpha1/v1alpha1_sequencer.go`:
  - `Initialize.earlyServices` replaces `StartApid` with `StartWebd`
  - inserts a deferred-check `rescue` phase that runs `EnterRescueShell` when `talos.rescue=1` is on the kernel cmdline
- `internal/app/machined/pkg/system/services/machined.go`: dropped chown-to-apid-uid on the unix socket (webd runs as root)
- `cmd/installer/pkg/install/install.go`: dropped pre-flight host version errata (relies on the deleted client SDK); pass `nil` for `hostTalosVersion` to `createPartitions`
- `cmd/installer/pkg/install/preflight.go`: rewrote on top of raw `grpc.NewClient` + `pkg/machinery/api/machine` (no `client/` SDK)
- `internal/app/poweroff/main.go`: rewrote on top of raw `grpc.NewClient` + `machine.NewMachineServiceClient`
- `internal/pkg/encryption/keys/kms.go`: dropped `client/dialer` proxy dialer; KMS dials directly
- `internal/app/machined/pkg/controllers/runtime/events_sink.go`: same — dropped proxy dialer
- `pkg/machinery/config/types/v1alpha1/v1alpha1_validation.go`: KubernetesTalosAPIAccess feature now always rejected (no Kubernetes in appliance)
- `internal/app/machined/pkg/controllers/secrets/api.go`: deleted `generateWorker`'s trustd-based remote PKI body (worker PKI generation is unreachable in appliance)

**New code**:

- `internal/app/webd/main.go`: webd process entrypoint (signal handling, calls into `internal/pkg/webd.Run`)
- `internal/pkg/webd/webd.go`: MVP read-only HTTP server on `:8080`. Routes: `/healthz`, `/api/version`, `/`. TLS, auth, and COSI/machined wiring are stub-deferred.
- `internal/app/machined/pkg/system/services/webd.go`: `Webd` Service definition for the supervisor; runs as a goroutine inside machined for now (Stage 1.2 simplification — PLAN-003 specifies Option C/separate process; goroutine is a temporary deviation that keeps the service-supervisor wiring identical to syslogd/auditd).
- `internal/app/machined/main.go`: multi-call entry `case "webd": webd.Main()`
- `pkg/machinery/constants/constants.go`: `KernelParamRescue`, `RescueExtensionPath`, `RescueShellEntrypoint` constants

**Deferred (Stage 2)**:

- TLS bootstrap for webd (self-signed cert generation, persistent storage at `/var/lib/webd/state/cert.pem`)
- Authentication: bcrypt admin password, first-run setup wizard, session cookies
- machined unix-socket gRPC client wrapper inside webd, plus COSI resource read helpers
- Embedded SPA assets (`go:embed`)
- WebSocket log streaming
- Reboot/shutdown actions (currently routed via deleted talosctl path)
- Promotion of webd from goroutine-in-machined to separate process (`process.NewRunner` + `/sbin/webd` multi-call invocation). The goroutine model means a webd panic crashes machined; this is an explicit MVP simplification noted in code comments.
- Rescue system extension: actual squashfs with busybox + tools (`hack/extensions/rescue/`); machined now has the trigger but the extension isn't built yet
- Bootloader UKI/grub entry that injects `talos.rescue=1` for an alternate menu entry
- Rescue shell auth gate (currently the EnterRescueShell task spawns the shell unconditionally; production needs admin password prompt before chroot)
- Removal of unused proto RPCs from `pkg/machinery/api/machine/machine.proto` (deferred to a focused proto-cleanup commit alongside `make generate`)

### Verification

- `go build ./...` clean
- `go test ./pkg/machinery/... ./internal/app/machined/pkg/runtime/v1alpha1 ./internal/pkg/webd/... ./internal/app/webd/...` results recorded in RFCT-003 closeout.
