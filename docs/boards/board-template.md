# Board dossier template

A board dossier is the machine-validated contract for one board: the single
document where a board's identity, provenance, hardware facts, recovery
story, assurance level and qualification evidence live together. Every
supported or in-progress board has exactly one dossier; [cx3576.md](cx3576.md),
[s905x5m.md](s905x5m.md) and [virt-arm64.md](virt-arm64.md) are the current instances.

**Validation.** A dossier MUST carry the thirteen H2 headings below, spelled
exactly and in this order, with no H2 heading outside this list.
`tools/docs/verify-board.sh`, run by `make docs-verify`, asserts that heading
list and the qualification-row grammar mechanically; the required fields under
each heading are asserted by review.

> status: shipped — evidence: `tools/docs/verify-board.sh`

The section list:

1. `## Identity`
2. `## Provenance`
3. `## Supported revisions`
4. `## Owners`
5. `## Boot chain`
6. `## Storage media and layout`
7. `## Console`
8. `## Peripherals`
9. `## Recovery method`
10. `## Artifact digests`
11. `## Known limitations`
12. `## Assurance level`
13. `## Qualification results`

An empty section is never silently empty: a section with nothing to say
carries the reason ("no radios on this board", "no digests pinned yet — see
Known limitations"), the same discipline as an empty list in `board.env`
being a statement rather than an omission.

## Required fields per section

### Identity

- Product/board name and the vendor's model designation.
- SoC (vendor, part).
- `MOS_ARCH` value.
- Board directory (`boards/<name>/`).

### Provenance

- For each input tree: upstream repository, relationship (mirror / subtree /
  drifted derivative), pinned commit, and a link to the sync record where
  one exists (practice: [intake.md](intake.md) section 6).
- Vendor blobs in the boot chain: source repository and version per blob.
- Input class per deliverable (source / source + blobs / binary-only /
  Yocto-only, per [intake.md](intake.md)).

### Supported revisions

- Every board revision this dossier's claims apply to, by the vendor's
  revision marking.
- Hardware SKU variants (e.g. alternative radio modules) and whether each is
  covered by the qualification results or explicitly not.
- Revisions known to exist but NOT covered, listed as such — qualification
  results never generalize across revisions
  ([qualification.md](qualification.md), named-revision rule).

### Owners

- Lifecycle owner: who owns BSP sync, CVE response and requalification for
  this board (a team or role, with the tier-appropriate meaning from
  [support-tiers.md](support-tiers.md)).
- Qualification owner: who ran, or is expected to run, the matrix.
- Escalation contact for field issues.

### Boot chain

- Every stage from power-on to the mounted root, in order, naming for each
  stage: what runs, where it is loaded from, and its input class.
- The A/B mechanism (bootloader backend, environment/handshake location).
- Which stages verify their successor, and how — this is the factual basis
  for the Assurance level section.

### Storage media and layout

- Storage device(s): technology (eMMC, SD, NVMe, generic), device node, and
  the exact part where qualification binds to a named storage device.
- Layout summary: `LAYOUT_VERSION`, partition count, and a pointer to the
  board's `board.env` as the authoritative layout (never restate offsets
  here — one source of truth).

### Console

- Serial console device, baud rate and connector/pinout location.
- `BOARD_CMDLINE_ARGS` console facts and any earlycon. Say which console is
  LAST: that is the one `/dev/console` binds to, and therefore where init and
  systemd write.
- Display console if any, and `BOARD_HAS_DISPLAY`. A board that declares `1`
  takes the boot-logo and console-recoverability contract in
  `docs/design/display.md` §4.

### Peripherals

- Radios (`BOARD_RADIOS` and the concrete modules/SKUs).
- Fieldbus and I/O: CAN, USB (host/OTG/gadget), Ethernet (PHY), GPIO/LEDs.
- The hwinit concern list (`BOARD_HWINIT_CONFS`) mapping each concern to the
  hardware it initializes.
- RTC: present or absent, battery-backed or not.

### Recovery method

- Every recovery path, each with: the trigger (key, boot failure, host
  tool), what state it needs (does it survive a dead bootloader? a corrupt
  environment?), and what it can restore.
- The factory (re)flash procedure and the tool that drives it.
- What a power-cut during update leaves behind and how the device comes
  back — cross-referenced to the matching qualification rows.

### Artifact digests

- For every binary-only or blob input accepted at intake: sha256 of the
  exact accepted bytes, plus the vendor version ([intake.md](intake.md)
  section 5).
- For pinned source trees: the pinned commit hashes (these are the
  provenance digests; per-release image/bundle digests live in the release's
  own manifest, not here).

### Known limitations

- Reduced-auditability entries for every opaque boot stage (mandatory when
  anything binary-only is in the chain).
- Hardware or BSP limitations that constrain claims (missing verified-boot
  capability, SKU ambiguity, thermal envelope, etc.).
- Anything a support engineer must know before promising behavior.

### Assurance level

- The board's evidenced position on the I1–I4 ladder
  ([assurance.md](assurance.md)): one line per level, each carrying a
  truth-status line with evidence, and never claiming above what the Boot
  chain and Known limitations sections support.

### Qualification results

- The field-reliability matrix per [qualification.md](qualification.md),
  bound to one named revision + storage device + radio module + BSP version.
- Every row `pass` | `fail` | `N/A` | `not tested`; pass/fail rows carry an
  ISO date and an evidence note. Never implicitly green.
- The installation row records the documented flash and first-boot procedure
  as actually exercised on a unit, and its evidence note names the image
  profile it was run at. A dossier whose Recovery method section describes a
  flash transport nobody has driven says `not tested` here; describing the
  procedure is not running it.
