# RFCT-019 PMA documentation finalize for PLAN-010 M4

- **status**: implementation complete — one follow-up item outstanding (RFCT-017)
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-18 03:39
- **claimedAt**: 2026-08-18 03:39
- **completedAt**: -

## Description

The documentation tail of PLAN-010 M4. Every shared PMA document the other M4
subtasks were forbidden from touching — so that concurrent subtasks could not
conflict on them — is owned here and written once, last, against what actually
landed.

Scope / deliverables:

1. `docs/task/index.md` — index the M4 task records.
2. `docs/plan/PLAN-010.md` — the M4 status block, in the shape M1/M2/M3 use.
3. `docs/plan/PLAN-006.md` — status, and an "Implementation notes (PLAN-010 M4)"
   section recording where the delivered design refines the plan, the three
   campaign-level decisions, and delivered-versus-deferred by stage.
4. `docs/plan/index.md` — plan markers.
5. `docs/design/uboot-ab-handshake.md` and `docs/design/ro-root.md` — the
   corrections listed under "Design-document corrections" below.
6. `README.md` — the top-level layout and build-entry list.
7. This record.

No code, no build script, no verifier and nothing under `board/` is touched.

## Key decisions

### The M4 status block claims local results only

M1, M2 and M3 each name the exact commands whose output backs the claim and then
state separately what remains the user's hardware acceptance. M4 follows that
shape and is stricter about it, because M4 is the milestone where the tempting
claim ("A/B updates work") is precisely the one no agent can make: every
acceptance criterion in PLAN-006 is a statement about a device. The block
therefore lists six build/verify results with their real numbers, then lists six
things that are explicitly not claimed, and says in one line that none of the
numbers is a hardware result.

### The `board/` escalation is recorded as resolved, not as outstanding

Earlier campaign documents framed M4 as blocked on the user applying a U-Boot
change. That is obsolete: main commit `8b24f9d` added the `uboot-mos` variant,
which resolves escalation items 1-3 of `docs/design/uboot-ab-handshake.md` §10.
The historical analysis in that document is kept verbatim — it is the reasoning
the variant was built against — and the three items are marked resolved with the
commit cited, rather than deleted. What replaces the escalation in PLAN-010 is
the pairing hazard, because that is the live risk: the two variants are not
interchangeable and neither mistake announces itself.

### PLAN-006 keeps its original text; the delta goes at the end

PLAN-006 was written against the Talos/machined core and executed against
systemd. Rewriting its body to match would destroy the record of what was
planned versus what was built, and would leave no trace of *why* the layout
changed. Instead the header carries an execution note, and one new section at the
end records three refinements (UENV placement, the DATA/`/var` split, the rescue
FIT that did not ship), the three campaign decisions, a delivered-versus-deferred
table keyed to the plan's own implementation stages, and the known limitations.
Nothing in Parts A-M was edited.

### Deferred work is stated as deferred, with the reason

PLAN-006 has nine implementation stages; M4 delivered two of them fully, one
partially, and left six deferred. The table says which, and for the two that
could be mistaken for oversights it says why: adaptive/delta is a commented line
in the manifest because turning it on should happen in the same step as the
streaming client that consumes it, and the Uptane client is absent because
`update/sign` is the server side only.

## Design-document corrections

Four divergences between the design documents and the shipped tree, found while
cross-reading the M4 records against the code:

1. **`docs/design/uboot-ab-handshake.md` §5.3** still carried the original
   `boot.cmd`, which loads an unsuffixed `mos-verity.env`. The shipped
   `os/boot/cx3576-boot.cmd` sets `slotsuffix` and loads
   `mos-verity-${slotsuffix}.env` with the unsuffixed name as a fallback. §5.3 is
   now synced to the shipped script, with the divergence and its reason stated
   above the block: a RAUC bundle installs one boot payload into whichever slot
   is inactive, so it ships both slots' files and an unsuffixed file cannot
   identify a slot. Under the original script every installed slot took the
   else-branch and rolled back silently. The remaining unsuffixed references in
   §5.5, §7.3, §8 and §10 were updated to the per-slot name too.
2. **§10 escalation items 1-3** are marked resolved by `8b24f9d`, with the
   pairing hazard recorded alongside.
3. **The dm device name.** §7.3 said `<name>` = `mos`; `os/rootfs/build-v2.sh`
   emits `rootfs`. The generator is the authority, so §7.3 now says `rootfs` and
   notes that the choice is cosmetic — the boot path uses `root=/dev/dm-0` and
   never `/dev/mapper/<name>`, because there is no udev at root-mount time. The
   `dmsetup table mos` line in the §8 bring-up checklist was corrected to
   `dmsetup table rootfs`, which matters: it is an instruction the user will
   type on hardware.
4. **`docs/design/ro-root.md`** gained the `MOS_VAR_MIB` = 512 MiB rationale
   beside the storage-tier table, the standing review criterion phrased as a rule
   for reviewing future units, the `/srv/balena-engine` data-root pin, and the
   same per-slot / dm-name reconciliations.

`docs/design/mosd.md` was checked for the `ReportHealth` method RFCT-015 added.
It contains no interface method list at all — it is an M2 decision brief, not an
API reference — so there is nothing there that lags. Rather than invent an API
reference section under a documentation-finalize task, the method is recorded
where it belongs today: in RFCT-015's record, in the code
(`mosd/mosd/src/bus.rs`, `#[zbus::interface(name = "com.mos.mosd1")]`) and in its
test. Writing `docs/design/mosd.md` up into a full interface reference is worth
doing and is noted under Escalations.

## Work checklist

- [x] `docs/task/index.md`: RFCT-013, -014, -015, -016, -018, -019 appended
      (RFCT-020 was already indexed by another subtask and is not duplicated)
- [ ] `docs/task/index.md`: RFCT-017 line — blocked, see Remaining
- [x] `docs/plan/PLAN-010.md`: M4 status block, M6 data-root pin
- [x] `docs/plan/PLAN-006.md`: status header + implementation notes
- [x] `docs/plan/index.md`: PLAN-006 marker
- [x] `docs/design/uboot-ab-handshake.md`: §5.3 sync, §10 resolution, dm name
- [x] `docs/design/ro-root.md`: `/var` sizing, standing criterion, dm name
- [x] `README.md`: layout and build entry points
- [x] `docs/task/RFCT-019.md`
- [x] Full campaign integration gate

## Acceptance

- Every M4 task record exists and is indexed.
- PLAN-010 M4 and PLAN-006 reflect what was delivered, with hardware acceptance
  and the `board/` position both stated explicitly.
- The campaign's four gates green, quoted with their real numbers.

## Verification (2026-08-18)

Run on this worktree at base `b3d9a51` (`bkd/n98jlna1`), against the prebuilt
BSP artifacts (`BOARD_DIR=/srv/ai/mos/board/cx3576`, which carries both U-Boot
variants). This is the campaign's final integration check, so all four gates
were run from one tree, not quoted from other records:

- `make os-image-cx3576` + `make os-verify-cx3576` (v1 regression) —
  `RESULT: PASS (88/88 checks)`. 88 is the current baseline, set by main commit
  `090fde1`, which added the hwinit assertions.
- `make os-image-cx3576-v2` — assembled
  `_out/cx3576/cx3576-mos-v2-1787047712.img`: rootfs payload 53 MiB into a
  256 MiB slot (floor mode, 125% headroom, 16 MiB aligned), boot 64+64, meta 16,
  state 64, var 512, data 64; **1315 MiB apparent, 161 MiB on disk** (sparse).
  `sgdisk --verify`: `No problems found. 38589 free sectors (18.8 MiB)
  available in 4 segments`.
- `bash os/mkimage-v2-selftest.sh` — `RESULT: PASS`, **137 checks**, including
  the ten-partition geometry, `ephemeral is exactly MOS_VAR_MIB (512 MiB), no
  longer a growth target`, `data ends 1 MiB before the end of the image`, both
  U-Boot pairing guards (missing `uboot-mos`, and `uboot-mos` byte-identical to
  the debug build), and all three slot-pin shapes (pin that fits at 64 MiB → 931
  MiB image; pin below the payload refused naming the 2 MiB shortfall; pin equal
  to the built-in default refused, proving the mode is chosen by supply and not
  by value; unpinned growth past the floor).
- `make os-health-test` — `RESULT: PASS (43/43 checks)`.
- `make os-devkeys` + `make os-bundle-cx3576` — signed verity bundle
  `_out/cx3576/mos-cx3576-1787047800.raucb`, 72513846 bytes, inline signature
  verified against the dev CA (`O = mos development, CN = mos development bundle
  signer`), `rauc info` run with the shipped `system.conf` loaded reporting
  `compatible=mos-cx3576`, `version=0.0.0-dev`, and both slot images
  (`rootfs.img` 55574528 bytes, `boot.vfat` 67108864 bytes).
- `bash mosd/hack/check.sh` — `ALL CHECKS PASSED` (`advisories ok, bans ok,
  licenses ok`).
- `make os-verify-cx3576-v2` — not run here; `os/verify-image-v2.sh` (RFCT-017)
  had not landed on this base. See Remaining.

Documentation hygiene:

- No CJK in anything this task wrote or edited. A repository-wide
  `grep -rInP '[\x{4e00}-\x{9fff}]' docs/ os/ update/ mosd/` is **not** clean and
  cannot be: `docs/**/*.zh.md` are deliberate translations requested by the user,
  and each English document carries a one-line language-switcher link whose label
  is the Chinese word for "Chinese". The same grep over `docs/plan docs/task os update mosd` returns nothing,
  which is the meaningful form of the check.
- No agent, model or collaborator name anywhere in the written text.
- Every number quoted above traces to the build output in this worktree; results
  attributed to other subtasks are labelled with their RFCT.

## Escalations

- **`board/` — no escalation from this task.** It writes only under `docs/` and
  `README.md`. The one `board/`-adjacent statement it records is that main
  commit `8b24f9d` resolved escalation items 1-3 of
  `docs/design/uboot-ab-handshake.md` §10, which the user has already applied.
- **`docs/design/mosd.md` has no bus interface reference.** The
  `com.mos.mosd1` interface is now four methods and a signal
  (`GetSettings`, `SetSettings`, `GetState`, `ReportHealth`, `SettingsChanged`)
  and is documented only in code and in task records. Writing that section is a
  real gap but it is API documentation, not a status update, and inventing it
  under a docs-finalize task would produce a reference nobody reviewed against
  the implementation. Proposed as its own task.
- **`docs/design/*.zh.md` lag their English originals.** None of the M4 material
  has a Chinese counterpart. Whether to keep the translations current is the
  user's call; they are not tracked as stale today.

## Remaining

- `docs/task/index.md` has no RFCT-017 line, and PLAN-010's M4 verification block
  has no `make os-verify-cx3576-v2` result. Both are deliberate: this task was
  dispatched in parallel with RFCT-017 and its record and verifier had not landed
  on this base. Writing a guessed title or an invented check count would put a
  fabricated number into a milestone status block, which is worse than a stated
  gap. Both are single-line additions once RFCT-017 merges.

## ActiveForm

Finalizing the PMA plan and task records for PLAN-010 M4.

## Dependencies

- **blocked by**: RFCT-013, RFCT-014, RFCT-015, RFCT-016, RFCT-018, RFCT-020
  (all merged); RFCT-017 (not merged — see Remaining)
- **blocks**: -
