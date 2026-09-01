# Vendor and BSP intake rubric

Intake is stage 1 of the [porting manual](porting.md): the decision, made
before any vendor content enters the tree, of whether the vendor's
deliverables can carry a mos port, under what conditions, and with what loss
of auditability. Its output is a completed rubric plus an opened provenance
record; a port with an incomplete rubric does not proceed.

## 1. What intake decides

Three questions, each with a written answer:

1. **Can we build it?** Which inputs are source, which are blobs, which are
   binary-only deliverables — and does the buildable subset meet the kernel
   and bootloader requirements of the
   [BSP contract](../design/boards.md)?
2. **May we ship it?** Redistribution rights for every artifact that lands in
   an image or an update bundle.
3. **Can we trust and maintain it?** Provenance for every input, a sync
   strategy for vendored trees, and an honest ceiling on the assurance
   claims ([assurance.md](assurance.md)) the inputs permit.

## 2. Input classes

Classify every vendor deliverable into exactly one class:

| Class | Definition | Examples on shipped boards |
|---|---|---|
| **Source** | built from a pinned commit of an inspectable tree | cx3576's U-Boot (mainline, pinned by commit), its kernel (armbian/linux-rockchip, pinned by commit) |
| **Source + blobs** | source build that links or packages vendor binaries | cx3576's DDR-init and TF-A binaries from Rockchip `rkbin`; radio firmware files |
| **Binary-only** | a deliverable used as shipped, with no buildable source | a vendor-supplied bootloader or flashing loader (cx3576's vendor MiniLoader is used on the flash path only, not shipped in the image) |
| **Yocto-only** | vendor ships BSP solely as Yocto layers | none currently; permitted only inside the board directory — build `virtual/kernel virtual/bootloader` and export the deploy dir, never Yocto in the OS build chain |

The class determines the evidence burden below and caps the assurance level:
a binary-only stage in the boot chain can prove observed behavior and
reproducibility of the *artifact*, never source auditability, and marketing
language must respect that boundary.

## 3. Kernel tier check

The vendor kernel version is checked against the support tiers of the BSP
contract: 5.10 LTS or newer is full support; 5.4 is per-board evaluation
with small shims expected; 4.x is out of support, and the options are
uplifting the vendor kernel, mainlining the SoC, or a separate reduced
profile that gives up the signed A/B verity root — which is a different
product promise, and intake must say so.

> status: shipped — evidence: `docs/design/boards.md`

## 4. Redistribution rights

For every artifact that ships (image, bundle, or published BSP output),
record: the license or agreement text, whether redistribution in a
commercial image is granted, whether attribution or source-offer duties
attach, and who confirmed it. "It was in the vendor SDK" is not a right to
redistribute. An artifact with unresolved rights blocks release
registration, not just this rubric.

## 5. Binary-only acceptance conditions

A binary-only bootloader or BSP component is accepted **only** when all of
the following are recorded:

1. **Version** — the vendor's version identifier, exactly as reported by the
   artifact or its release notes.
2. **Digest** — a sha256 of the exact bytes accepted, recorded in the board
   dossier's Artifact digests section; every future build asserts the digest
   before using the artifact.
3. **Redistribution rights** — per section 4.
4. **Tested behavior** — bench evidence, recorded as dated qualification
   rows per [qualification.md](qualification.md), that with this artifact in
   place: the A/B switch works, the recovery path works, and rootfs
   integrity enforcement (the verity boot path) still holds. Behavior that
   cannot be tested is behavior that cannot be claimed.
5. **Recorded reduced auditability** — an explicit entry in the dossier's
   Known limitations section stating which boot stages are opaque and what
   that caps: an assurance claim that runs through an unauditable stage is
   best-effort at most, and I3/I4 claims must name the opaque stage they
   depend on.

Each row lands where it can be checked: the digest and the opaque stages in
the dossier's Artifact digests and Known limitations sections, the tested
behavior as dated qualification rows. The rubric is the contract for accepting
such an input; it says nothing about whether any board has satisfied it.

> status: shipped — evidence: `docs/bsp/board-template.md`, `docs/bsp/qualification.md`

Rejecting a binary-only input is the default when any row above cannot be
filled. Source availability is not required — many embedded products cannot
meet that constraint, and mos deliberately does not impose it — but evidence
is.

## 6. Provenance record and deviation register

Every vendored or derived tree gets a provenance record at intake time,
following the practice established by
[docs/design/bsp-cx3576-sync.md](../design/bsp-cx3576-sync.md):

- **Upstream source** — repository and the relationship (mirror, subtree,
  or drifted derivative). Nothing enforces a derivation mechanically, so the
  record is the only thing that carries it.
- **Synced-to commit** — the upstream commit the tree is level with, with
  the claim spelled out: every upstream commit up to that point reviewed,
  everything applicable ported, and no-op dispositions listed so the claim
  is checkable rather than asserted. The next sync is a `git log` against
  that point — a listing, not a rediscovery.
- **Deviation register** — a register, not a changelog: only deliberate
  differences from upstream, each with where, what upstream has, what we
  have, why, and a build-time guard where one is possible, so a future sync
  that silently reverts the deviation fails at build time rather than on a
  customer's desk. Decisions are recorded as decisions, not dressed up as
  derived conclusions — that is what keeps them reversible by the person
  entitled to reverse them.

> status: board-dependent — evidence: `docs/design/bsp-cx3576-sync.md`

## 7. Intake output

The rubric closes with:

- every deliverable classified (section 2) and its rights confirmed
  (section 4);
- the kernel tier decision (section 3);
- binary-only conditions met or the input rejected (section 5);
- the provenance record opened (section 6);
- the Provenance, Artifact digests and Known limitations sections of the
  board dossier ([board-template.md](board-template.md)) seeded from the
  above.
