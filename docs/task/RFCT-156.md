# RFCT-156 PLAN-017 M2: remote-management.md rewritten present-tense for the mos daemon set

- **status**: completed
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-26 22:05
- **claimedAt**: 2026-08-27 06:21
- **completedAt**: 2026-08-27 06:22
- **plan**: PLAN-017 (M2)

PLAN-017 M2. One commit, `bec0299`, merged at `00ab52a`:
122 insertions, 86 deletions in `docs/design/remote-management.md`.

## What landed

The document described Talos `apid`, `talosctl`, mutual TLS to gRPC `:50000`,
`trustd`, SideroLink and `/run/machined.sock` — none of which exist in this
tree — under a retraction banner from which a reader had to reconstruct the
live requirement. **The mechanism is deleted outright; the model it carried is
kept as a stated requirement.** `grep -rn SideroLink docs/design/` now returns
nothing (rc=1), and `Talos` survives in the document exactly once: the naming
contract at the top, which PLAN-017 said stays.

- **Section 1 — what actually reaches the device.** apid on the LAN over HTTPS
  behind the session gate, the read-only `/api` subtree, apid as a D-Bus client
  of mosd owning no state, and SSH/console per `access.md` — each claim
  carrying a quoted fragment against its source, so the citation gate
  content-checks it. It states explicitly that there is **no device-initiated
  management channel and no fleet plane in this tree**.
- **Section 2** keeps the reverse-connected channel as a live
  **[not implemented]** requirement with its three prerequisite decisions, and
  no design.
- **Section 3** corrects the update flow — see below.
- **Section 4** restates the security posture in the present tense, including
  the absence the build asserts: no operator credential is provisioned onto a
  device, because a signed rootfs is byte-identical on every unit.

Per-section **[implemented]** / **[not implemented]** markers replace the
blanket banner, following `access.md` section 0.

The citation gate went 642/642 -> **675/675** on this commit.

## The corrected update fact pattern

**The instruction this subtask was given was wrong.** L2's brief told it to
write *"the device pulls today; apid offers the local trigger"*. RFCT-156
verified against the tree instead of complying, and what
`docs/design/remote-management.md` section 3 now states is the measured
version. It is recorded here because update-path work will cite it, and it
must cite the measured version rather than rediscover it.

The four facts, with the citations copied from the merged section 3 so this
record and the document cannot drift:

1. **apid declares no update route at all** — `mosd/apid/src/routes.rs:113-188`
   — so it offers no local check/apply button, and there never was one in this
   tree.
2. **There is no on-device pull.** The device-side verifier is built and tested
   on the host only: *"nothing ships it to a device yet"*
   (`update/README.md:12`).
3. **What is implemented is local installation owned by mosd:**
   `InstallUpdate(bundle_path)` (`docs/design/mosd.md:423`) hands a bundle
   already on the device to RAUC, against *"the A/B update design this
   implements"* (`docs/design/ro-root.md:7-8`), plus the boot health gate that
   *"probes systemd, mosd and apid first"* (`docs/design/mosd.md:439`) and the
   U-Boot attempt-counter fallback — *"a slot that cannot complete a boot is
   guaranteed to exhaust its credits"*
   (`docs/design/uboot-ab-handshake.md:434-435`).
4. **The surviving invariant**, which is a constraint on any future trigger and
   not a decision about any existing one: every trigger — a policy pull, a
   remote trigger over section 2's channel, a local one — converges on the one
   update path with its verification, health gate and rollback. *A trigger is a
   way into that path, never a bypass of it.*

**What was corrected was the coordinator's instruction, not the document.** The
previous text of `remote-management.md` was also wrong, but independently: it
described a Talos update path that does not exist here. Two separate errors,
and the record says so, because a task record that reads "the spec was
corrected during execution" is what stops the same wrong instruction being
written again.

## Consequence this subtask created and did not fix

Section 1's heading moved, which broke a line citation into api.md from the
other direction and produced this workstream's one merge failure — recorded in
`docs/task/RFCT-155.md` §"The sweep's stated method". Four citations into the
**old** `remote-management.md` text also survive in `docs/research/**`, which
is outside `docs/verify-citations.sh`'s scope; they are inventoried in
`docs/task/RFCT-159.md`.
