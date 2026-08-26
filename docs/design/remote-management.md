# Design: Remote Management & API Surface

> English | [中文](remote-management.zh.md)
>
> Who talks to the device, over what, with which trust. Decision record for
> keeping Talos `apid` (upstream machine API) alongside `apid` (the mos product
> HTTPS daemon — it serves the API, and the dashboard is one client of it).
>
> **Naming convention for this document, because the name now collides.** Bare
> **`apid`** below means the mos product daemon. The upstream Talos machine API
> daemon is written **Talos `apid`** everywhere it appears. No sentence uses the
> bare name for both.
>
> **[not implemented] — status of this document: awaiting a rewrite, not
> retirement.** Two separable things live here and only one of them died.
>
> - **The MECHANISM is dead.** Talos `apid`, `talosctl`, mutual TLS to gRPC
>   :50000, `trustd`, and the claim that both frontends are *"thin frontends
>   over `/run/machined.sock`"* all belonged to the Talos base that systemd +
>   mosd replaced. **None of it exists in the tree**: there is no
>   `machined`, no `machined.sock` and no Talos `apid` anywhere in this
>   repository.
> - **The MODEL is alive, wanted, and undesigned.** A reverse-connected
>   management channel — the device dialling out so it is reachable from behind
>   NAT — and the fleet-management story survive Plan B completely intact. The
>   user asked for that model and it was **not withdrawn**. And there is **no
>   replacement design for it anywhere in the tree today**: nothing under
>   `docs/design/` covers remote reachability or fleet management on the
>   systemd + mosd architecture.
>
> So this document is **not obsolete and must not be retired**. The requirement
> it carries is still live and currently has no design. What it needs is a
> rewrite against the current architecture. Recording that gap is the whole
> point of this marker; no replacement is sketched here.

## 1. Two frontends, one machined

| | `apid` (product) | Talos `apid` + talosctl |
|---|---|---|
| Audience | end user / device owner | operators, automation, future fleet plane |
| Protocol | HTTPS + session auth (first-run setup) | gRPC :50000, mutual TLS (talosconfig) |
| Scope | setup wizard, status, network, updates UI | full machine API: apply-config, upgrade, logs, events, reset |
| Maintenance | ours | **upstream Talos** (the decisive argument for keeping it) |
| Default | on | **off** (or bound to management subnets); enabled per deployment |

Both are thin frontends over `/run/machined.sock`; neither owns state. trustd
stays disabled (inter-node trust has no single-appliance role); the appliance's
Talos `apid` uses locally-issued PKI (controlplane-style), decided and tested
in the rebase campaign.

## 2. Reaching devices behind NAT

Upstream answer adopted as the planned fleet path: **SideroLink** — the device
dials out a WireGuard tunnel to a management endpoint; Talos `apid` becomes
reachable through the tunnel (the mechanism underlying Omni; protocol and
config types are in-tree). Topologically equivalent to balena's VPN dial-back, but
upstream-maintained.

Beyond API reach, the siderolink protocol also carries device→server event
streaming and kernel log push — management and telemetry share one
device-initiated tunnel. In fleet profiles Talos `apid` is bound to the tunnel
interface only (invisible on the LAN); consumer deployments configure neither.

Not scheduled yet; prerequisite decisions when it lands: management endpoint
hosting, device enrollment (join tokens vs pre-provisioned), and how ECU
version manifests (PLAN-006 phase 2 director) share that channel.

## 3. Update control flow

Day-1 (phase 1): the device pulls — updater checks the static Uptane repo per
`UpdateConfig` policy; `apid` offers manual check/apply; lockbox covers offline.
No management server exists, so there is nothing to operate or compromise
server-side beyond static content hosting.

Fleet stage (phase 2): director repo adds per-device targeting; Talos `apid`
plus SideroLink adds imperative reach (trigger upgrade, fetch logs). The product
`apid` remains the local fallback at every stage.

**Talos `apid` as the remote upgrade entry (decision 2026-08-17).** The
`MachineService.Upgrade` RPC is kept as a *trigger into* the PLAN-006 updater
state machine, never a bypass of it:

- RPC parameter semantics change from "installer container image" to "update
  target/version"; the updater still runs full TUF metadata verification and
  hash pinning before RAUC touches a slot. A compromised management endpoint
  cannot produce an installable payload (TUF online keys cannot sign bundles).
- Three triggers, one trust path: policy pull (`UpdateConfig`), remote trigger
  (Upgrade RPC over SideroLink), local trigger (`apid` button / lockbox) — all
  converge on the same updater state machine, health gate, and rollback.

## 4. Security posture

- Talos `apid` off by default ⇒ consumer deployments expose only `apid` (the
  product daemon) on the LAN.
- talosconfig client certs are operator credentials — never provisioned onto
  end-user devices' owners.
- SideroLink tunnels originate device-side; no inbound port on the device.
- All three planes (`apid` session, Talos `apid` mTLS, SideroLink WG) are
  independent credential domains; compromise of one does not grant another.
