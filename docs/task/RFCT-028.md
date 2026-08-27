# RFCT-028 PMA documentation finalize for PLAN-010 M5

- **status**: completed — implementation complete
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 00:23
- **claimedAt**: 2026-08-19 04:20
- **completedAt**: 2026-08-19 05:10

## Description

PLAN-010 M5 landed ten task branches across settings, identity, provisioning,
three reconcilers, the image, the shadow file, power actions and the partition
layout. This task brings the PMA records and the design documents into line with
what actually shipped.

The substantive part is not the status update. It is that **three approved
design documents had come to say the opposite of the shipped code**, which is
the documentation form of the defect class this campaign exists to prevent: a
document that states a falsehood confidently makes a reader wrong in exactly the
way a passing test that proves nothing does. Those are §"Contradictions" below.

## Scope

Written or amended here:

- `docs/plan/PLAN-010.md` — the M5 section, following M4's format.
- `docs/task/index.md` — entries for RFCT-021..031 (this task is the only one
  that edits it, by design, so eleven concurrent branches cannot collide on one
  file).
- `docs/design/access.md` — the `listenAddresses` correction, and phase 1
  re-framed onto systemd/mosd.
- `docs/design/provisioning.md` — Layer 1 rewritten to what ships; **new §3, the
  single authoritative statement of the credential model**; Layer 3 recorded as
  retired.
- `docs/design/ro-root.md` — the changed writable-path contract, the shadow
  reconcile semantics, the STATE-seeding constraint, and the stale partition
  numbers.
- `docs/design/mosd.md` — new §5: the v3 settings tree, the five reconcilers and
  the discipline they converged on, and the bus surface including the two power
  methods.
- `docs/design/connd.md` — **NEW**. There was no connd design document at all;
  the model lived in PLAN-008, written for the Talos/COSI base.
- `docs/design/uboot-ab-handshake.md` — new §8.0 (see the scope note below).
- `docs/task/RFCT-028.md` — this record.

Not touched, deliberately: every other `RFCT-0NN.md` (each L3's own record is the
primary evidence for its task and must not be edited by this one), all code, all
of `os/**` and `mosd/**`, and every `*.zh.md`.

### One file outside the stated scope had to change

`docs/design/uboot-ab-handshake.md` was **not** in this task's file list, but R5
requires the loader-partition consequence to be stated "in the flashing
procedure", and that procedure lives in this document and nowhere else. RFCT-031
explicitly deferred it here: *"That document needs this consequence recorded next
to the flashing steps; it is not edited here because `docs/design` is not this
task's area."* Leaving it unwritten would drop the single most operationally
expensive fact in the milestone — that boards already flashed need a maskrom
re-flash.

Two changes, both surgical:

1. A new **§8.0** at the head of the bring-up checklist: the maskrom re-flash
   requirement, the repart discard mechanism, why it generalises to any SoC that
   boots from a raw offset, and why the fix is structural rather than
   `--discard=no`.
2. **§5.5 item 5** said "Zero-fill p1/p2 (uenv-a/uenv-b)". Those are p2/p3 since
   the loader partition landed. Corrected in place, with a note that their start
   sectors and therefore `ENV_OFFSET` are unchanged.

No other line of that document was touched. It has other pre-loader partition
references in its GPT discussion which were left alone — auditing it end to end
is a larger job than this task's requirement, and is recorded as a follow-up
below.

## Contradictions found, and how each was resolved

Every one of these is a case where an **approved** design document stated the
opposite of shipped, tested code.

### 1. `access.md` §3 — `listenAddresses: []` (the one the brief named)

- **Doc said**: `listenAddresses: []          # empty = none`
- **Code does**: empty means **listen on all**; the reconciler emits no
  `ListenAddress` directive at all, which is what sshd itself does when given
  none.
- **Resolved**: the document is amended to match the code, and §3.2 now states
  the reasoning explicitly and flags itself as a correction. This was a
  deliberate L2 ruling, not a drift: the "none" reading would hand an operator
  who enables SSH without naming an address a **running-but-unreachable sshd** —
  green everywhere, nothing to log — and closure is already expressed by
  `enabled: false`, which is the layer §5.1 exists for.

### 2. `ro-root.md` §4 — `/etc/shadow` listed as read-only

- **Doc said**: `/etc/shadow` sits on the verity squashfs and is read-only.
- **Code does**: it is a symlink to `/var/lib/mos/shadow` (STATE), seeded from
  `/usr/share/factory/etc/shadow` and reconciled on every boot.
- **Resolved**: the writable-path table is updated and a new subsection records
  the reconcile semantics, both known consequences, and the v1 asymmetry. The
  contract genuinely **changed** here — this is not a doc that was always wrong —
  so it is written as a correction with the reason stated: per-device password
  auth on v2 works *only* because of it.

### 3. `provisioning.md` §2 — Layer 1 in machined, generating per-device PKI

- **Doc said**: machined (TypeAppliance) generates the config, including "fresh
  per-device **PKI**".
- **Code does**: `mosd/mosd/src/provisioning.rs` on the systemd base, and **no
  PKI is generated** — there is no device certificate and no device CA, because
  nothing on this base consumes one.
- **Resolved**: §2 rewritten to what ships, with a "What was NOT carried over"
  subsection that names the dropped PKI claim rather than quietly deleting it.
  Layer 2's "machined API" is likewise re-pointed at the mosd bus, and Layer 3
  is recorded as **retired** — its own stated criterion was "deleted in the same
  campaign that delivers Layer 1", and Layer 1 shipped.

### 4. `ro-root.md` — partition numbers off by one (found while editing)

Not in the brief. The writable-path table and the storage-tier table carried
META p7 / STATE p8 / EPHEMERAL p9 / DATA p10, which predate RFCT-031 inserting
the loader partition at p1. Checked against `os/layout/cx3576-v2.env` and
corrected to p8 / p9 / p10 / p11, with a note that **partition GUIDs did not
move** — which is precisely why the dm-verity cmdline, `/etc/fstab`,
`/etc/fw_env.config` and the RAUC slot devices needed no change.

### 5. A deliberate deviation from an approved plan (not a doc error)

PLAN-008 Part D: the AP PSK "defaults to the per-device provisioning PIN". It
does not — it is a second, independent CSPRNG draw. Recorded as a deviation with
its reason in `provisioning.md` §3.2 and in PLAN-010 M5, rather than left for a
reader to discover as an inconsistency: the WPA2 PSK is broadcast-adjacent and
offline-crackable from a captured handshake, so if it were also the device
password, recovering the WiFi key would hand over the root shell.

## The credential model was stated once, deliberately

Three documents touch it and each had a partial version. It is now stated in
full in **`provisioning.md` §3** only, and `access.md` §4, `connd.md` §7 and
`ro-root.md` §4 defer to it by reference. The three subtleties that a future
reader would otherwise "simplify" wrongly:

1. secrets are minted **on the device** at first boot, because a signed rootfs is
   byte-identical across the fleet;
2. there are **two** independent secrets, and the reason is a threat-model
   argument, not tidiness;
3. the same password is stored under **two hash formats** — Argon2id in
   `access.device.passwordHash` for mosd/webd, bcrypt in `/etc/shadow` for
   `pam_unix` — because Debian's libxcrypt has **no Argon2 support**. §3.3 gives
   the measured evidence and records that the first implementation got this wrong
   in exactly the campaign's signature way: SSH enabled, a password on the label,
   no way to log in, every gate green.

## Numbers quoted, and where each came from

Every number in PLAN-010's M5 section was **measured on the merged tree by this
task**, not copied from a task record or from the brief. The campaign's numbers
had already been wrong once (RFCT-031 records the brief quoting 89/89 and 247/247
against a measured 88/88 and 228/228), so nothing was taken on faith.

Commands run, with `BOARD_DIR=/srv/ai/mos/board/cx3576` and
`TMPDIR=$PWD/_out/tmp`:

| Command | Measured result |
|---|---|
| `make os-image-cx3576` + `bash os/verify-image.sh` | `RESULT: PASS (126/126 checks)` |
| `make os-image-cx3576-v2` + `bash os/verify-image-v2.sh` | `RESULT: PASS (293/293 checks)` |
| `make os-health-test` | `RESULT: PASS (54/54 checks)` |
| `make os-repart-test` | `RESULT: PASS (18/18 checks)` |
| `bash mosd/hack/check.sh` | `ALL CHECKS PASSED`, `203 tests run: 203 passed, 0 skipped` |

Image sizes were measured with `du`: v1 381 MiB apparent / 374 MiB on disk; v2
1315 MiB apparent / 165 MiB on disk.

All five agree with what the task records claim, and the arithmetic reconciles in
both directions:

- **verifier counts.** M4 ended at 88/88 and 228/228 (RFCT-031, measured by
  stashing and rebuilding). Shadow +1/+19, loader +10/+17, image integration
  +28/+30 with one check removed in each (the unconditional "ssh.service is
  enabled", replaced by the profile-conditional pair). 88+1+10+28−1 = **126**;
  228+19+17+30−1 = **293**. Both match the runs above.
- **mosd test count.** 67 (RFCT-021) → 77 (+10, RFCT-022) → 88 (+11, RFCT-024)
  → 116 (+28, RFCT-023) → 127 (+11, RFCT-030) → 158 (+31, RFCT-025) → 203 (+45,
  RFCT-026). The measured total is **203**, and the power tests from RFCT-030 are
  visibly present in the run, so the chain is complete rather than coincidental.

Numbers quoted in the design documents that were **not** re-measured here, and
are attributed to their task records: the libcrypt format inventory (RFCT-027,
measured on the arm64 object packed in the image) and the repart growth figures
131072 → 14217176 sectors (RFCT-027; the `os/repart-test` run above re-confirms
them, and its output was read).

## Nothing was left unreconciled

Every claim across RFCT-021..031 that this task depended on reconciled against
either another record or a measurement. Two points are worth recording because
they *looked* like discrepancies and are not:

- **RFCT-026 reports 203 tests and so does the final merged tree**, which reads
  at first like a task adding 45 tests and changing nothing. It is a coincidence
  of the merge order: RFCT-030's 11 power tests are inside RFCT-025's quoted
  baseline of 127, so RFCT-026's branch already carried them. Checked rather than
  assumed — the power tests appear by name in this task's own check run.
- **RFCT-031's counts (98/98, 245/245) differ from RFCT-027's "before" (99, 264)
  and from the final 126/293.** Not a conflict: each L3 measured its own branch
  against a base that did not yet carry its siblings. The arithmetic above shows
  the three sets composing exactly.

## Language and honesty rules

- **English only.** No `*.zh.md` file was created or edited.
  `bash mosd/hack/check.sh` enforces the no-CJK rule on the files it covers and
  passes.
- **No hardware result is claimed anywhere.** No agent in this campaign has
  booted anything. PLAN-010 M5 carries an explicit "what remains the user's
  hardware acceptance" list, and every design document that could read as a
  hardware claim now says so — `connd.md` §10 in particular exists only to make
  that distinction unmissable.
- **Recorded follow-ups were carried forward, not dropped.** All of them are in
  PLAN-010 M5's follow-up list: no credential-rotation path; the STATE
  seed-generation constraint; PENDING_CONFIRM reboot burning a boot attempt with
  no UI warning; no auto-reboot after `rauc install`; automatic STA/AP
  arbitration unimplemented; WPA3-SAE not expressible; station passphrase length
  unvalidated; `write_atomically` duplicated across three reconcilers;
  `access.console.shellEnabled` with no consumer; META lockdown, brute-force
  counters and the audit trail all absent.

### Follow-up for whoever owns translations

**`docs/design/access.zh.md`, `provisioning.zh.md` and `mosd.zh.md` are now
stale.** They still describe the Talos/COSI mechanism, the `DebugAccessConfig`
document, Layer 1 in machined, and the pre-M5 settings tree — including the
`listenAddresses: []` "empty = none" comment that is the correction above. They
were deliberately **not** translated and **not** deleted. `boards.zh.md`,
`display.zh.md` and `remote-management.zh.md` were not touched by this
milestone and are unaffected.

`docs/design/connd.md` and `docs/design/ro-root.md` have no `.zh.md` sibling and
none was created.

### A second follow-up, from the out-of-scope edit

`docs/design/uboot-ab-handshake.md` carries further pre-loader-partition
references in its GPT and storage-contract discussion beyond the one corrected
in §5.5. Only the two changes R5 required were made. A full pass over that
document against `os/layout/cx3576-v2.env` is worth doing and is not done here.

## Work checklist

- [x] R1 PLAN-010 M5 section in M4's format, with measured numbers and an
      explicit local-vs-hardware split
- [x] R1 an assertion that could NOT be made, stated as plainly as M4's
      `CONFIG_SQUASHFS_XATTR` — four of them, led by "no test here proves PAM
      accepts the hash"
- [x] R2 `access.md` §3 amended to match the reconciler, with the reasoning
- [x] R2 `access.md` phase 1 re-framed onto systemd/mosd; phases 2/3 kept as
      direction, noted as superseding the shadow route
- [x] R3 `ro-root.md` writable-path set updated, reconcile semantics recorded,
      both known consequences (`.pwd.lock`, the dangling-symlink window) stated
- [x] R4 the credential model stated once in `provisioning.md` §3, referenced
      from the other three documents, with the PLAN-008 deviation and the
      two-hash reason
- [x] R5 `connd.md` written: subtrees, reconcilers, networkd DHCP, the conflict
      as shipped, CAN/BT explicitly not absorbed, the networkd naming constraint
- [x] R5 loader-partition record: mechanism, generalisation, geometry revised
      before any fielded flash, maskrom consequence in the flashing procedure
- [x] R5b(a) the masking-not-disabling finding, in `connd.md` §8 and PLAN-010
- [x] R5b(b) the STATE seed-generation constraint, in `ro-root.md` §4
- [x] R6 English only; no `*.zh.md` created, edited or deleted; staleness noted
      once, here
- [x] R6 no hardware claim anywhere; follow-ups carried forward
- [x] `docs/task/index.md` carries RFCT-021..031
- [x] `bash mosd/hack/check.sh` prints `ALL CHECKS PASSED`

## Verification (2026-08-19)

Mandatory project check, on the tree as delivered:

```
$ bash mosd/hack/check.sh
     Summary [  29.556s] 203 tests run: 203 passed, 0 skipped
advisories ok, bans ok, licenses ok
ALL CHECKS PASSED
```

This task changes documentation only, so the check is a regression guard rather
than evidence for anything written above; it also enforces the no-CJK rule on the
files it covers. The image builds and verifier runs in the Numbers table were run
**before** any document was edited, so every count recorded is a measurement of
the tree the documents describe.

## ActiveForm

Bringing the PMA records and the design documents into line with what PLAN-010
M5 actually shipped.

## Dependencies

- **blocked by**: RFCT-021..027 and RFCT-029..031 — every M5 task record is
  source material for this one
- **blocks**: nothing. This is the milestone's closing task.
