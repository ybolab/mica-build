# PLAN-912 Validate s905x5m Bluetooth peer interaction

- **status**: draft
- **owner**: hardware/bluetooth-peer-validation-20260831
- **createdAt**: 2026-08-31 07:17 UTC
- **approvedAt**: (pending)
- **relatedTask**: RFCT-922

## Context

RFCT-913 established the s905x5m Bluetooth transport and controller path but
did not find a discoverable peer during a ten-second scan. The deployed board
has the required SDIO/vHCI/BlueZ stack and a STATE-backed pairing store. The
missing acceptance evidence is a controlled peer interaction: authenticated
pairing plus a named profile exchange.

The current management endpoint is not reachable for this investigation. At
2026-08-31 07:18 UTC, SSH to `root@192.168.27.55` was refused before any
remote command ran. Bounded ICMP and TCP/22 checks from both the checkout host
and `192.168.27.200` also failed. This is an operational-access blocker, not
evidence about controller health or radio behavior.

At 2026-08-31 08:29 UTC, the owner reported the board reachable again through
root SSH, running slot A with synchronized time and all four PLAN-911 fixes.
The access blocker is cleared; this task still needs its own read-only
controller capture and, separately, a controlled peer for acceptance.

The 08:31 UTC capture confirmed the full board-alone path: the ordered
wireless/vHCI/BlueZ services are active; `/dev/BTDATA`, `/dev/vhci`, and the
required modules are present; hci0 is powered, HCI 5.0, and supports BR/EDR,
LE, SSP, secure connections, bondable mode, and advertising. BlueZ 5.82 owns
`org.bluez` and exposes `AgentManager1`, `GattManager1`,
`LEAdvertisingManager1`, and `ProfileManager1`. The adapter is deliberately
not discovering, discoverable, or pairable, and no peer object or peer record
exists. The pairing store is a 0700 STATE bind from `/dev/mmcblk1p10`.

The runtime cannot support every possible profile test: BlueZ logged missing
kernel BNEP support and SAP registration failure, while `obexd` is absent.
BLE GATT is therefore the selected controlled-peer profile. A packaged class
of `0x240404` differs from the live `0x000404` observed through BlueZ and
management; record it as a separate discrepancy rather than silently changing
it during a pairing task.

## Proposal

Collect board-alone evidence first, then run a bounded discovery and pairing
exercise only after an owner supplies a peer in known pairable state. Use a
profile that the peer demonstrably exposes, record the exact profile and
success condition, and distinguish scan, pairing, connection, and profile
results in the task record.

## Risks

The required peer may not exist or may not be put into a reproducible pairable
state. The board is shared, so radio-state transitions must be logged before
they occur. Link keys and other credentials must not enter repository records.

## Scope

No source, image, deployment, reboot, or storage change. The delivery is
hardware evidence and the task/plan record; successful completion requires a
controlled peer and a passing profile exchange, not only a successful scan.

## Alternatives

Wait without collecting board-alone evidence: rejected because controller,
agent, and service evidence can be established safely before the peer arrives.

## Annotations

- 2026-08-31 07:17 UTC: investigation opened. Explicit Phase 3 approval is
  required before pairing or profile execution; read-only board inspection is
  Phase 1 evidence collection.
- 2026-08-31 07:18 UTC: no board-side inspection could run because the SSH
  endpoint was unreachable. No radio state was changed. Await a reachable
  endpoint, a controlled peer, and approval to perform the state-changing
  pairing/profile phase.
- 2026-08-31 07:20 UTC: `bash docs/verify-index.sh` passed 48/48. Its scope is
  `docs/design` and `docs/README.md`, not PMA tracking or Bluetooth operation.
- 2026-08-31 07:21 UTC: targeted task/plan linkage checks passed; the two
  records point to each other and their index entries name the correct files.
- 2026-08-31 08:30 UTC: the owner reported board access restored. The next
  investigation action is a read-only controller and BlueZ capture; pairing
  and profile execution remain Phase 3 work pending explicit approval and a
  controlled peer.
- 2026-08-31 08:31 UTC: the read-only board capture passed. Selected profile:
  BLE GATT, because the board exposes the GATT manager while BNEP, SAP, and
  OBEX are unavailable or unsuitable. No radio state changed.
