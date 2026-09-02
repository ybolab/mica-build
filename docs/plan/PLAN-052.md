# PLAN-052 Add diagnostics and operational network state

- **status**: completed
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: 2026-09-02
- **relatedTask**: [RFCT-288](../task/RFCT-288.md)

## Context

mos exposes reconciler state, health data and an API, but logs under `/var` are
disposable and there is no bounded redacted support bundle or troubleshooting
decision tree. Network configuration exists for Ethernet, Wi-Fi, AP, VLAN,
bridge and WireGuard, while operators lack coherent observed carrier, address,
lease, route and DNS state. Similar gaps exist for current storage, time,
thermal, watchdog and reset-cause evidence.

There is also no single answer to "what is this device": kernel version,
system (image) version, per-package software versions, build date and machine
id live in scattered places or nowhere. Parts of it already exist as seams --
`/usr/share/mos/manifest.tsv` ships every installed package with its version
and the pool's git stamp (PLAN-041), `/etc/machine-id` is seeded by
mos-machine-id, the kernel is readable from `uname`/`/boot/config-*` -- but
nothing aggregates them into one identity surface for the UI, the API or a
support conversation.

## Proposal

- **SW:** expose one system-information surface (API and built-in UI) that
  answers device identity in one read: machine id, board, kernel version,
  system (image) version and its git stamp, build date, the installed package
  versions (from `/usr/share/mos/manifest.tsv`), active RAUC slot and uptime.
  Read-only, assembled from the existing seams rather than restated by a
  second mechanism.
- **SW:** define one versioned diagnostic snapshot containing release/board,
  the system-information surface above, boot/slot/reset, bounded journal,
  service/reconciler failures, storage, time, thermal/watchdog and observed
  network state.
- **SW:** make collection bounded in size/time, atomic, available offline and
  exportable through authenticated local tooling/API without enabling SSH.
- **SW/SEC:** apply a reviewed redaction schema for credentials, tokens, private
  keys, Wi-Fi secrets, registry auth, user content and personally identifying
  network fields; test positive and negative fixtures.
- **SW:** expose operational network facts separately from desired settings:
  link/carrier, interface/address, DHCP lease, default route, DNS reachability,
  Wi-Fi association and explicit unsupported radio/modem capabilities.
- **INT:** validate board-specific reset reason, temperature, watchdog and radio
  fields; absence is reported, not silently treated as healthy.
- **DOC/OPS:** publish collection, privacy, retention and escalation procedures
  plus symptom-to-evidence-to-remediation troubleshooting trees.

## Risks

- Diagnostics can leak the very secrets needed to control the device; redaction
  is a tested security boundary.
- Volatile evidence may disappear on reboot; persistence must be minimal,
  bounded and compatible with flash-wear policy.
- Desired network configuration is not proof of connectivity; APIs and docs
  must keep desired and observed state distinct.

## Scope

In scope: diagnostic schema/export, redaction, bounded evidence, observed
network status, board telemetry adapters and troubleshooting. Out of scope:
central fleet log ingestion, arbitrary remote shell, packet capture by default
and SKU-specific cellular support unless separately selected.

## Alternatives

1. Ask support to collect unrestricted journals manually. Rejected because it
   is inconsistent, inaccessible on headless failures and unsafe for secrets.
2. Persist all logs indefinitely. Rejected because embedded flash and privacy
   require explicit bounds.
3. Infer live networking from saved settings. Rejected because configuration
   and actual carrier/lease/route/DNS state differ.

## Annotations

- 2026-08-31: Production embedded comparison identified diagnostics, reset and
  observed-network state as pilot serviceability gaps.
- 2026-09-01: Split from PLAN-037 as the local field-diagnostics capability.
- 2026-09-02: System-information surface added on user direction: kernel
  version, system version, per-package software versions, build date and
  machine id belong to this plan, aggregated from the existing seams
  (manifest.tsv, machine-id, uname, RAUC slot).

## Completion (2026-09-02)

| Proposal item | Evidence |
|---|---|
| One-read system information | `GET /api/v1/system/info` and the `/_ui/system-information` route in `pkgs/mosd/apid/ui/src/app/routes/system-information.tsx`; `answers device identity with one API read` and `names unavailable identity evidence instead of showing a healthy blank` in `-system-information.test.tsx`; diagnostics design section 2. |
| Versioned diagnostic snapshot | Schema version 1 and its release, system, boot, failure, storage, time, telemetry and network members in diagnostics design section 5; authenticated collection/list/export/delete routes under `/api/v1/diagnostics/snapshots` in section 8; the `/_ui/diagnostics` route. |
| Bounded, atomic, offline authenticated collection/export | Enforced collection, evidence and retention limits plus atomic publication and offline behavior in diagnostics design section 7; authentication contract in section 8; `shows retention bounds and authenticated snapshot actions`, `generates a snapshot and refreshes the list`, and `deletes a snapshot and refreshes the list` in `-diagnostics.test.tsx`. |
| Reviewed redaction boundary | Three-pass redaction schema in diagnostics design section 6; `every_planted_secret_is_absent_from_the_produced_snapshot`, `every_benign_member_survives_the_pass`, and the API export assertion named there. |
| Observed network distinct from desired settings | `GET /api/v1/network/status`, diagnostics design section 3, and the `/_ui/network-status` route in `network-status.tsx`; `shows live evidence separately from desired network settings` and `names unavailable top-level evidence without assuming lists exist` in `-network-status.test.tsx`; `matches route boundaries instead of similarly prefixed pages` in `src/components/app-shell.test.ts`. |
| Board telemetry adapters | `GET /api/v1/system/telemetry` and the thermal/watchdog/reset adapter and absence contract in diagnostics design section 4. Fixture coverage validates parsing and absence semantics. Physical-board validation of reset reason, temperature, watchdog and radio fields is hardware-dependent, **not done**, and escalated by the coordinating workstream. |
| Operational documentation | Collection, privacy/retention and escalation procedures in diagnostics design sections 10.1-10.3, followed by symptom-to-evidence-to-remediation trees for no network, wrong time, DATA full, failed update/slot rollback and unexpected reboot in section 10.4. Assurance-level handling is sourced from the linked security model and is not redefined. |

### Correction (2026-09-02): the reported date

The system-information contract shipped with `system.buildDate`, derived from
the mtime of `/usr/share/mos/manifest.tsv`. Every file time in a composed root
is pinned to `SOURCE_DATE_EPOCH`, which `build/src/geometry.ts` fixes to a
constant so two builds of one tree are byte-identical -- so that field reported
2020-01-01 on every mos image ever built, and a cx3576 measured today reported
exactly that.

The date is now the commit date of the commit the image's `+git` stamp names:
`rootfs/build.sh` reads the commit out of the stamp it has already checked the
pool against, and `rootfs/compose/compose-install.sh` records it as
`COMMIT_DATE` in `/usr/share/mos/release-identity.env`. It is truthful and
reproducible, which a wall clock could not be. The two fields are renamed to
what they are: `system.commitDate` (the source's date, absent with a reason
when the identity states none, and stating a `.dirty` stamp in its detail) and
`system.fileEpoch` (the pinned epoch every file in the image carries, reported
as that and not as a build date). Diagnostics design section 2;
`verify`'s `packed-release-identity` holds an image to the new key.
