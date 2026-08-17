# Design: Remote Management & API Surface

> English | [中文](remote-management.zh.md)
>
> Who talks to the device, over what, with which trust. Decision record for
> keeping apid (upstream machine API) alongside webd (product UI).

## 1. Two frontends, one machined

| | webd | apid + talosctl |
|---|---|---|
| Audience | end user / device owner | operators, automation, future fleet plane |
| Protocol | HTTPS + session auth (first-run setup) | gRPC :50000, mutual TLS (talosconfig) |
| Scope | setup wizard, status, network, updates UI | full machine API: apply-config, upgrade, logs, events, reset |
| Maintenance | ours | **upstream Talos** (the decisive argument for keeping it) |
| Default | on | **off** (or bound to management subnets); enabled per deployment |

Both are thin frontends over `/run/machined.sock`; neither owns state. trustd
stays disabled (inter-node trust has no single-appliance role); appliance apid
uses locally-issued PKI (controlplane-style), decided and tested in the
rebase campaign.

## 2. Reaching devices behind NAT

Upstream answer adopted as the planned fleet path: **SideroLink** — the device
dials out a WireGuard tunnel to a management endpoint; apid becomes reachable
through the tunnel (the mechanism underlying Omni; protocol and config types
are in-tree). Topologically equivalent to balena's VPN dial-back, but
upstream-maintained.

Beyond API reach, the siderolink protocol also carries device→server event
streaming and kernel log push — management and telemetry share one
device-initiated tunnel. In fleet profiles apid is bound to the tunnel
interface only (invisible on the LAN); consumer deployments configure neither.

Not scheduled yet; prerequisite decisions when it lands: management endpoint
hosting, device enrollment (join tokens vs pre-provisioned), and how ECU
version manifests (PLAN-006 phase 2 director) share that channel.

## 3. Update control flow

Day-1 (phase 1): the device pulls — updater checks the static Uptane repo per
`UpdateConfig` policy; webd offers manual check/apply; lockbox covers offline.
No management server exists, so there is nothing to operate or compromise
server-side beyond static content hosting.

Fleet stage (phase 2): director repo adds per-device targeting; apid/SideroLink
adds imperative reach (trigger upgrade, fetch logs). webd remains the local
fallback at every stage.

**apid as the remote upgrade entry (decision 2026-08-17).** The
`MachineService.Upgrade` RPC is kept as a *trigger into* the PLAN-006 updater
state machine, never a bypass of it:

- RPC parameter semantics change from "installer container image" to "update
  target/version"; the updater still runs full TUF metadata verification and
  hash pinning before RAUC touches a slot. A compromised management endpoint
  cannot produce an installable payload (TUF online keys cannot sign bundles).
- Three triggers, one trust path: policy pull (`UpdateConfig`), remote trigger
  (Upgrade RPC over SideroLink), local trigger (webd button / lockbox) — all
  converge on the same updater state machine, health gate, and rollback.

## 4. Security posture

- apid off by default ⇒ consumer deployments expose only webd on the LAN.
- talosconfig client certs are operator credentials — never provisioned onto
  end-user devices' owners.
- SideroLink tunnels originate device-side; no inbound port on the device.
- All three planes (webd session, apid mTLS, SideroLink WG) are independent
  credential domains; compromise of one does not grant another.
