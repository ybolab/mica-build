# RFCT-922 Exercise s905x5m Bluetooth pairing and a profile with a controlled peer

- **status**: pending
- **priority**: P1
- **owner**: (unassigned)
- **createdAt**: 2026-08-31 07:17 UTC
- **plan**: PLAN-912

## Description

Establish the missing peer-interaction evidence for the deployed s905x5m
Bluetooth controller. First collect board-alone evidence for the SDIO
transport, vHCI controller, BlueZ agent path, and discovery capability. Then,
when an owner-supplied controlled peer is in radio range and pairable, pair it
and exercise one explicit Bluetooth profile exchange. Record the peer role,
profile, commands, outcome, and any persisted pairing state.

The obligation remains open, but acceptance must start from a fresh complete
current signed-file S905X5M image. The 2026-08-31 board and slot observations
below remain historical evidence and do not qualify the current image.

An empty discovery result is not evidence of pairing and must be recorded only
as a scan result. Do not deploy a slot, reboot the board, write eMMC or its
boot areas, or write `bootloader_a`.

## ActiveForm

Awaiting a current-image hardware owner and controlled BLE GATT peer.

## Dependencies

- **blocked by**: assignment of a current-image hardware owner and an
  owner-supplied Bluetooth peer in radio range, placed in a known pairable
  state, with its pairing method and a profile test available
- **blocks**: completion of the Bluetooth peer-interaction follow-up from
  RFCT-913

## Notes

- The shared board is `192.168.27.55`; it is reported to run slot A with M1,
  M2, M3, and M5 deployed and verified. Heavy builds, if needed, belong on
  `192.168.27.200`.
- `BOARD_HWINIT_CONFS="wireless audio bluetooth"` is the measured split.
- Radio-state log, before any state-changing Bluetooth command: at
  2026-08-31 07:17 UTC no board radio state has been changed by this task. The
  initial investigation is limited to read-only controller, service, and
  configuration inspection.

## Investigation

RFCT-913 proved the Bluetooth SDIO transport, Seekwave vHCI bridge, powered
controller, and BlueZ startup. Its ten-second discovery window found no
discoverable peer, so it does not prove pairing or profile traffic.

The board declaration supplies the `hci_vhci` transport module,
`/usr/sbin/skw_vhci_bridge`, the `libskwbt.so` plugin, and three vendor NV
files. `mos-wireless.service` precedes `mos-bluetooth.service`; the latter
precedes `bluetooth.service`. Pairing records are stored under
`/var/lib/bluetooth`, bind-mounted from STATE, so a successful pairing should
also be checked for persistence without exposing keys.

At 2026-08-31 07:18 UTC, an initial read-only SSH connection to
`root@192.168.27.55` was refused on TCP port 22, so no board-side command ran.
Two bounded ICMP probes from both this checkout host and `192.168.27.200`
received no replies; their TCP/22 checks were unavailable or refused. The
build host still had a probing neighbor entry for `192.168.27.55`, but this is
not evidence that the reported slot, controller, or BlueZ services are
currently reachable. No radio state changed.

Consequently, the task has not repeated any RFCT-913 controller claim and has
not performed discovery, pairing, connection, or profile traffic. Restoring a
stable key-authenticated SSH path (or supplying the current board address and
port) is the immediate operational blocker. A controlled peer remains the
separate acceptance blocker after board access is restored.

At 2026-08-31 08:29 UTC, the owner reported that the board had powered on and
was reachable again through root SSH, running slot A with synchronized time and
the PLAN-911 fixes present. This supersedes the management-access blocker but
is not used as a replacement for this task's own read-only controller capture.

At 2026-08-31 08:31 UTC, this task independently captured the running board
without changing radio state. `mos-wireless.service`, `mos-bluetooth.service`,
`bluetooth.service`, and `var-lib-bluetooth.mount` were all active. Their
ordering is intact: wireless precedes the vHCI bridge, and both the bridge and
the STATE bind mount precede BlueZ. `/dev/BTDATA` and `/dev/vhci` exist; the
`amlogic_wireless`, `skw_sdio`, `skw`, and `hci_vhci` modules are loaded.

The vHCI controller is `hci0`, address `02:AD:47:01:36:D8`, HCI/LMP 5.0,
powered and running. Management reports BR/EDR, LE, SSP, secure connections,
bondable, and advertising support, with central and peripheral roles. The
live adapter is neither soft- nor hard-blocked, while the separate vendor
`bt-dev` rfkill entry remains soft-blocked; no rfkill state was changed because
the live HCI path is already powered and usable. The adapter was not
discovering, discoverable, or pairable, and no peer was paired.

BlueZ 5.82 owns `org.bluez`; its `AgentManager1` exposes register, unregister,
and default-agent methods. This proves the agent route exists but does not
claim an agent was registered. `GattManager1`, `LEAdvertisingManager1`, and
`ProfileManager1` are also available. The STATE bind is mounted from
`/dev/mmcblk1p10[/bluetooth]` with 0700 permissions; it contains only the
controller's local record, not a peer record.

Two profile constraints were observed without exercising either profile:
BlueZ reports no kernel BNEP support and cannot register its SAP server, and
the runtime has `bluetoothctl` but no `obexd` or `btgatt-client` executable.
Therefore this task's controlled-peer exchange should use BLE GATT, not PAN,
SAP, or an OBEX file transfer. The packaged `Class = 0x240404` is present in
`main.conf`, while both `bluetoothctl` and `btmgmt` report live class
`0x000404`; this discrepancy is recorded but not changed because class
advertisement is outside this task's pairing scope.

## Proposal

1. Read controller identity, supported settings/features, service ordering,
   BlueZ D-Bus ownership, agent registration, and existing pairing inventory.
2. Log the intended radio-state transition in this record, enable bounded
   discovery, and record its result separately from any pairing claim.
3. With the owner-controlled peer explicitly identified and pairable, use the
   selected pairing method, verify the resulting trusted/connected state, and
   exercise one named profile end-to-end (for example, GATT read/write with a
   controlled BLE peripheral, or a file transfer with an OBEX-capable peer).
4. Capture only non-secret evidence: controller and peer addresses, profile,
   commands, service logs, pass/fail result, and confirmation that BlueZ wrote
   a peer record to the STATE-backed store. Remove the pairing only if the
   owner requests cleanup.

## Risks

- The board is shared; pairing, discovery, adapter power changes, and removal
  of a device change observable radio state. Each will be logged here first.
- A peer that is merely nearby but not pairable cannot establish the required
  evidence. A scan with no result remains a blocker observation, not a test.
- Pairing credentials and link keys are secrets and will not be copied into
  the task record.
- Board access was restored at 2026-08-31 08:29 UTC according to the owner;
  this task will independently capture only read-only board state before any
  radio-state action.

## Scope

- Board-alone capability and service evidence, bounded discovery, controlled
  pairing, and one explicit profile exchange.
- Documentation records only; no image build, deployment, reboot, storage
  write, bootloader write, or remote push.

## Alternatives

- Use a generic nearby device: rejected because its pairable state and profile
  behavior cannot be controlled or reproduced.
- Treat an empty discovery run as a pairing test: rejected because it proves
  neither peer visibility nor authentication nor profile traffic.

## Progress

- 2026-08-31 07:18 UTC: recorded the no-radio-change state before attempting
  the read-only board inspection. SSH was refused before a remote shell was
  established; follow-up bounded reachability checks from both available hosts
  failed. No board state was modified.
- Owner input needed to continue: restore or provide the board's reachable
  key-authenticated SSH endpoint, then provide a nearby controlled peer. The
  preferred peer is a BLE GATT peripheral with a known pairable mode and one
  documented readable/writable characteristic; alternatively provide a
  specific classic-Bluetooth profile endpoint plus its expected exchange.
- 2026-08-31 07:20 UTC: `bash docs/verify-index.sh` passed 48/48. Its
  deliberate scope is `docs/design` and `docs/README.md`, so it does not
  validate PMA task or plan records and does not supply board or peer evidence.
- 2026-08-31 07:21 UTC: targeted record checks confirmed that each new index
  entry names its existing file and that `RFCT-922` and `PLAN-912` link to one
  another. `git diff --check` reported no whitespace error in the two tracked
  index files.
- 2026-08-31 08:30 UTC: the owner reported the board reachable again. Before
  this task's next remote command, no reboot, slot change, deployment, storage
  write, adapter power change, discovery, pairing, connection, trust change,
  or device removal is planned. The next capture is read-only.
- 2026-08-31 08:31 UTC: completed the declared read-only capture. The
  controller, ordered bridge, BlueZ D-Bus agent route, HCI capabilities, and
  STATE-backed store are present; it is powered but not discovering,
  discoverable, or pairable, with zero paired peers. No radio state changed.
- The remaining acceptance blocker is a nearby controlled BLE GATT peripheral
  that is advertising and pairable, with its address, pairing method, service
  UUID, readable/writable characteristic UUID, and expected values supplied by
  the owner. Pairing/profile execution still awaits explicit approval.

- unclaim: The controlled-peer hardware obligation remains open, but the historical execution owner is no longer active.
