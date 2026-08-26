# RFCT-110 PLAN-014 M4: the image-contract verifier ported to TS under a per-check parity gate

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-25 10:50
- **claimedAt**: 2026-08-25 22:04
- **completedAt**: 2026-08-26
- **plan**: PLAN-014 (M4)

Port `verify-image-v2.sh` (4,620 lines, both boards via runtime branches)
into `os/verify/`: board contracts become typed data, checks become
data-driven cases, and the migration is gated check-by-check on parity with
the shell verifier it replaces.

## Scope

- TS helpers for the existing no-host-mutation toolset (sgdisk, mtools at
  offset, dd-extract + debugfs/tune2fs, unsquashfs, userspace
  `veritysetup verify`).
- Check-by-check port; each migrated check lands in the same change as its
  negative-fixture test (the `ui-location-test.sh` suite and friends) —
  a port without its negative test is not done (RFCT-096).
- A parity harness that runs shell and TS verifiers against the same image
  and diffs conclusions per check, both boards, real images and mutated
  fixtures.
- Delete the shell verifier (and its now-ported fixture suites) only at
  full parity.

## Acceptance

- Identical pass/fail sets between shell and TS on both boards' current
  images and on every mutated fixture.
- The fixture suites fail when their target assertion is weakened
  (spot-check by reverting one check).
- Tool-less-host container path verified for the full verifier, not just
  the lint.

## Dependencies

- After RFCT-109. Runs in parallel with RFCT-111/112.

## M4e — the gate, 2026-08-26

All three acceptance clauses are satisfied. **Clause 3 was measured
unsatisfiable, escalated, and then closed by a decision the user made** — the
sequence is recorded below in full, because the clause text is unchanged and a
reader is owed the difference between a clause that was met and a clause that
was weakened.

### Clause 3 — unsatisfiable as the tree stood, then SATISFIED by a pin the user chose

**Who decided what, in order.**

| when | actor | what |
|---|---|---|
| 2026-08-26 | **M4e** | measured the clause unsatisfiable and reported it, with three costed closures; took no action |
| 2026-08-26 | **the user** | decided: add the pin — option (a), the configuration M4e had measured sufficient |
| 2026-08-26 | **M4e** | carried out that decision and re-measured on a genuinely bun-less host |

**The clause text is NOT amended.** It reads exactly as it always did, and it is
now true. That distinction is the point of this section: six earlier clause
changes in this campaign were amendments, named as such. **This one is not an
amendment — it is a satisfaction.**

> **Attribution corrected 2026-08-26, at the campaign close.** This sentence read
> *"…named as such, **by the user**"*, and that is over-broad: **one of the six
> was not the user's.** RFCT-108's clause 1 — the arm64-builds qualification —
> was applied by **L1** on the M2 gate's recommendation, and that record states
> in bold that it *"is NOT a decision the user took"* and is revertible if the
> user objects. Only the attribution was wrong; the amendment-versus-satisfaction
> distinction this sentence draws is sound and is untouched. The ledger is **not**
> restated or renumbered here — it is six amendments, one satisfaction, two
> dispositions, and PLAN-014's close carries the per-amendment actors. Whether
> that amendment is ratified or reverted is a separate, open question and is not
> settled by this correction.

#### What was unsatisfiable, and how that was established

Running the full verifier inside the pinned `IMAGE_BUN_1` on a host with neither
bun nor the image tools fails, and both sides of the seam fail for the same one
cause — **no docker client in the bun image**:

* the register's own seam: `createToolRuntime` refuses, *"this host has no
  sgdisk, … fdtget and no docker to run the pinned ones in"*;
* the oracle (before deletion): exit 127 at `os/verify-image-v2.sh:185`,
  `docker: command not found`;
* mounting the daemon socket changes neither — the missing thing is the client.

This did **not** close when the oracle was deleted: the full verifier is now the
register, and the register drives docker just as much.

**What would close it, also measured.** Bind-mounting the host's docker client
(a static binary) plus the socket into the pinned bun image, the full verifier
ran to completion on this tool-less host: `PARITY x64: PASS — 312 compared, 0
diverging, 0 unclaimed`, `rc=0`. So "a docker client added to the bun pin" was
**sufficient**, not merely plausible. Bun in that image can also reach the
daemon's HTTP API unaided (`fetch(..., { unix: '/var/run/docker.sock' })` → 200
on `/_ping`), which needs no pin but is a rewrite of `tools.ts`'s process seam.
Either way it is a decision about `os/build-env/images.env`, so it was reported
rather than taken.

#### What discharges the clause now

**The user decided to add the pin.** Landed as:

* **`IMAGE_DOCKER_CLI_28`** in `os/build-env/images.env` —
  `docker:28-cli@sha256:625d9431…`, the index digest per that file's convention,
  with WHO READS it, what it costs, and the decision itself recorded beside it.
* **`os/verify/Dockerfile`** — the pinned bun image plus one file, the client.
  Nothing is installed. The client is a STATIC binary (checked: `ldd` reports
  "Not a valid dynamic program"), which is what lets an alpine-built client run
  on a debian base.
* **`os/verify/run.sh`** — builds it on demand for `--verify` only, tagged with
  **both** input digests so a bumped pin cannot silently reuse the image built
  from the old one, and mounts the daemon socket. Not built by `make build-env`:
  that target builds the four `mos-build-*` compiler images and nothing runs it
  before the verifier, so an image produced there would be absent exactly when
  it is needed.

**Re-measured on a genuinely bun-less host**, through the pinned image rather
than the bind-mount that simulated it. The earlier evidence was taken with the
oracle still present and `parity-cli.ts` is now deleted, so what is driven is the
full TS verifier:

    env -i PATH=/usr/bin:/bin HOME=<empty>   (no bun, no sgdisk/mtools/debugfs/
                                              unsquashfs/veritysetup; docker only)
    run.sh --verify --board x64      RESULT: PASS (290/290, 22 skipped)  rc=0
    make os-verify-cx3576-v2         RESULT: FAIL (387/395, 3 skipped)   rc=1

cx3576's eight FAILs are the BSP byte-compares a checkout cannot carry — the same
eight the oracle failed, and not repaired.

**What it costs, recorded rather than buried.** Mounting `/var/run/docker.sock`
into a container is a privilege grant, and no other target in this tree takes
one. It is confined to `--verify`; the suite and the lint still run in plain
`IMAGE_BUN_1` and neither mounts the socket, which is also the route CI takes on
every push.

**Not implemented, and deliberately:** the no-pin alternative (`tools.ts`
speaking the daemon HTTP API from bun). It was measured available and was not
chosen.

#### One further authorised amendment, by the user

`test/apid-api/run.sh:122` defaulted to `oven/bun:1`, a floating major-version
tag and the last unpinned image reference in the repository. `test/apid-api` is
excluded by PLAN-014's Scope sentence; **the user lifted that exclusion for this
one line on 2026-08-26** and it now defaults to `IMAGE_BUN_1`. Recorded in
PLAN-014's Scope section, in `images.env`, and in `os/verify/HARNESS.md`. The
rest of the exclusion stands.

### Clauses 1 and 2

**Clause 1** — identical pass/fail sets — was green and is the condition the
deletion was performed under: `cx3576` compared 398, `x64` compared 312, 0
diverging and 0 unclaimed on both, `rc=0`.

**Clause 2** — "the fixture suites fail when their target assertion is weakened"
— **driven, not read**. `checks-shape.ts`'s partition-count check was weakened
from `got === want` to `got >= 0` and the suite went **RED** on exactly the two
negative cases (`RED when the image is one partition short`, `RED when a cx3576
image carries x64's NINE partitions`) — `22 pass / 2 fail`. Restored: `24/24`,
`rc=0`.

### The deletion, and what it replaced

`os/verify-image-v2.sh` (4,637 lines), `os/tests/ui-location-test.sh` (1,612)
and `src/parity-cli.ts` are deleted. The scope sentence is "the shell verifier
it **replaces**", and nothing in the package could verify an image on its own —
the register only ever ran beside the oracle — so `src/verify-cli.ts` landed
with the deletion. It reproduces the oracle's own summary line on both boards:

    x64      RESULT: PASS (290/290 checks, 22 skipped (x64/grub))      rc=0
    cx3576   RESULT: FAIL (387/395 checks, 3 skipped (cx3576/uboot))   rc=1

cx3576's eight FAILs are the BSP byte-compares whose source tree a checkout does
not carry; the oracle failed those identically, and PLAN-014's **Scope** section
puts BSP builds out of scope — *"No change to … `board/` BSP builds (digest pins
only)"*.

> **Citation corrected 2026-08-26, at the campaign close.** This read
> `PLAN-014:220-223`, which is not where that exclusion lives — those lines are a
> Risks bullet about the `docker-container` builder. The address was wrong from
> the moment it was written, in this record and in RFCT-111 and RFCT-112, because
> **L2 carried it in the L3 specs it issued and the records quoted it**; it is a
> campaign artefact, not rot these records inherited. The substance was never
> wrong. Replaced with the **section name and the clause text** rather than with
> a corrected line number, because a line number is what failed here: PLAN-014
> grew a closing section and any address into it would have moved again.

`make os-verify-parity` and `make os-ui-location-test` are **removed** rather
than kept able to refuse. `os/verify/HARNESS.md` records every defect the
deletion froze, marked SHIPS or GONE — including two that were expected to leave
with the file and did not, because their reproductions live in the port.
