# RFCT-207 PLAN-022 M8: the design documents, made true

- **status**: completed
- **priority**: P1
- **owner**: bkd/6a4halna
- **createdAt**: 2026-08-28
- **claimedAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-022 (M8)
- **design**: RFCT-200 section 8's M8 cut (*"api.md §2.2's collision entry updated to the shipped fix, mosd.md reconciler section, architecture notes"*), plus the items M2-M7 flagged and left for this milestone

M2 through M7 changed what the appliance does; the design documents still
described the tree as it was before them. This milestone changes no code — no
file under `os/` or `test/` is touched — and rewrites the prose that M2-M7
falsified, plus the two citations they identified as already mis-anchored
before this campaign began. Every claim added below is either a citation into
the tree at this branch's head or a measurement quoted from a throwaway run
against the tree's own crates.

## Scope

| file | change |
| --- | --- |
| `docs/design/api.md` | §1.5's schema-version and `IfaceSettings` cells and the `deny_unknown_fields` example list; §2.2's actions-root sentence, dot-collision entry, `deny_unknown_fields` count and network inventory row; §2.4's worked rejection; §9's foreclosure entry |
| `docs/design/dashboard.md` | the two live-state citations and the prose around them (§1 item 4, §5's echo list) |
| `docs/design/mosd.md` | a new §5.3a, the PLAN-022 banner, and `RotateWireguardKey` in §5.4's member table |
| `docs/architecture.md` | §2's networking bullet, plus an interface-kinds bullet |
| `docs/verify-citations-unquoted-baseline.txt` | two ceilings lowered to their new measured counts |
| `docs/task/RFCT-200.md` | §5.2's kernel point release, corrected in a dated note (item 6) |
| 16 other documents | `path:line` re-anchoring, numbers only (below) |

## The measurement this milestone rests on

api.md quoted a rejection message that schema v7 changed. Re-measured against
the tree's own `mosd-settings`, 2026-08-28 — a throwaway integration test
compiled by `localhost/mos-build-rust`, run, and deleted; nothing left behind:

```text
UNQUOTED_ERR: Err(Validation { path: "network.eth0.100", message: "unknown field `100`, expected one of `kind`, `dhcp`, `static`, `vlan`, `bridge`, `wireguard`" })
QUOTED_OK: Ok(())
QUOTED_TREE: ["eth0", "eth0.100"]
QUOTED_LEAF: Ok(())
TOML: [network."eth0.100"]
      [network."eth0.100".vlan]
```

Four facts, against a tree that already declares `eth0`: the unquoted spelling
still fails and did **not** become an alias; its field list is v7's and no
longer *"expected `dhcp` or `static`"*; `network."eth0.100"` lands the key
`eth0.100`; a leaf write at `network."eth0.100".dhcp` succeeds; and the tree
persists as `[network."eth0.100"]`, which is the notation RFCT-200 §1.2
measured the serializer already emitting.

## Item disposition

**1. api.md's VLAN dot-path collision.** §2.2's bullet is rewritten from a live
limit to the shipped fix: apid still admits `.` in an interface name, the lexer
now takes bare or double-quoted segments, and the VLAN sub-interface is
`GET`/`PUT /api/v1/settings/network."eth0.100".dhcp`. The entry keeps two
residues a client is still owed — the unquoted spelling is still an error, with
the message re-measured above, and a key containing a double quote has no
spelling, which schema v7 closes on the write path instead of leaving as an
addressing gap. §2.4's worked example carries the same corrected message and is
re-dated. §9's *"The VLAN dot-path limit"* entry (which is the numbered-item
echo the charter names; api.md has no §10) is rewritten to record that the debt
landed **additively** — the classification RFCT-200 §6 works through row by row
— rather than costing a `v2`. The §2.2 inventory row that read *"see the VLAN
dot collision above"* now names what an entry's `kind` selects.

**2. "The `/api/v1/actions/<verb>` root does not exist".** False since M6's
rotate route, and flagged in RFCT-205 rather than fixed there. Rewritten to
what the published document actually serves: one verb, a `POST` that draws a
WireGuard interface a new private key and answers its public half, and none of
the three verbs §2.3 proposes.

**3. The two mis-anchored citations.** api.md's `valid_iface_name` citation in
§9 pointed at `valid_ipv4` — a drift of seven lines that predates PLAN-022, and
that RFCT-201's mechanical re-anchor shifted faithfully rather than repaired.
It now names the function the sentence is about and carries its regex as the
quote, so the gate holds it. §1.5's `deny_unknown_fields` example list ended at
`const MAX_IFACE_NAME_LEN`; that entry is replaced by the attribute it meant,
and the four attributes schema v7 added join the list.

**4. dashboard.md's live-state citations.** Both named lines that stopped being
the live-state `json!` object before M4, which is why RFCT-203 declined to move
them: re-pointing a citation that is already aimed elsewhere is a content fix,
not a re-anchor. Both now name the object, and the prose around them says what
the object carries — `file`, `dhcp` and `kind` for every entry, plus the public
half of the key for a tunnel. The point the passage is making survives intact
and is strengthened: a public key derived from a key file is still not a reading
off a link.

**5. mosd.md's reconciler section.** A new §5.3a, dated and banner-announced in
the document's own idiom, covering the four things a `.network` file cannot
express — the `.netdev` a virtual link needs, the `VLAN=`/`Bridge=` line that
lives on the *other* interface's unit, the sweep's device teardown (deleting a
file does not delete a device networkd built) and the netdev-property recreate
that shares it — plus the keystore: `networkd-secrets/` as a **sibling** of
`secrets/` and not a child, 0750 on the directory and 0640 `root:systemd-network`
on each file, lazy idempotent generation, atomic writes, and `PrivateKeyFile=`
naming the key rather than carrying it. Rotation is recorded as a bus method
and why it must be one, and `RotateWireguardKey` joins §5.4's member table.
**bus.md needs no row:** it carries no `com.mos.mosd1` member table — §1.2
enumerates four members and an ellipsis and points at mosd.md §5.4 for the
list, so the table that needed the new member is the one this milestone edited.

**6. RFCT-200 §5.2's kernel version.** Corrected as a dated note rather than in
place, because RFCT-206 quotes the original sentence verbatim and rewriting it
would break that citation and falsify a dated measurement. The note records
6.12.105+deb13-amd64, that nothing in the tree pins a point release, and that
neither M7 check pins one — so the drift changed no result.

**7. Architecture notes.** The tree keeps `docs/architecture.md`, and it is the
only architecture-notes file in `docs/`. mosd.md carries no pointer of its own
to it; the link runs the other way, architecture §8's "Where to read next" table
routing the mosd question to `docs/design/mosd.md`. Its networking bullet
omitted the `network` subtree entirely; it now names it, and a second bullet
states interface kinds: the block is authoritative and the name is not, a
physical entry renders one file and the other three render a `.netdev` too,
attachment is a line on the other interface's unit, a removed virtual entry is
torn down rather than merely unlinked, and a tunnel's private key never enters
the settings tree.

## Corrections made in passing, and why

Three cells in api.md §1.5 were falsified by M3 and sit inside the paragraphs
item 3 sends this milestone into. They are corrected rather than reported,
because a table headed "the settings subtrees" that says `schema_version` is
`6` and that `IfaceSettings` is `dhcp` plus a `static` block is exactly the
thing this milestone exists to stop: the schema-version cell now reads 7, the
network row lists `kind` and the four blocks with their declared ranges, and
§2.2's *"and fifteen more"* count of `deny_unknown_fields` attributes is now
nineteen. Each is a value that moved with the code and nothing else.

## Citation re-anchor

The four edited documents carry `path:line` citations from elsewhere and the
gate checks them. 47 tokens across 16 documents were re-pointed by diffing each
edited file against its pre-image and mapping old line to new; no prose and no
quoted fragment was retouched. 43 of those followed the design-prose commit and
the remaining four followed item 6's dated note, which shifted RFCT-200's own
line numbers. Documents carrying the `dated-record` marker were skipped by
construction: their citations name where things **were**.

Three tokens had no mechanical answer, because they named lines this milestone
rewrote:

- RFCT-200's two api.md citations were re-pointed by hand at the rewritten
  regions, and both still say what their citing sentences claim: the new §2.2
  bullet still narrates the unquoted write failing, and the new §9 bullet is
  still the debt note §6 discharges.
- **RFCT-205's `api.md:1133-1134` quoted a sentence this milestone deleted.**
  This is the mirror of the forced value change RFCT-205 itself recorded, and it
  is handled the same way: the quotation stays as what api.md said at that
  milestone's commit, the line citation is dropped rather than re-pointed
  (no line of today's api.md carries those words), and a clause says so. That
  is the one edit to another milestone's record this task file makes beyond
  numbers, and it is forced by an in-scope prose change rather than chosen.

## The ratchet

`docs/design/api.md` fell from 439 unquoted citations to 435 and
`docs/design/dashboard.md` from 83 to 81; both ceilings are lowered to the new
measured counts in the same commit as the drop, which is the documented update
procedure. No ceiling is raised: every citation this milestone adds to a design
document carries an adjacent quote, `docs/design/mosd.md` and
`docs/architecture.md` stay at zero unquoted, and this record has no row, so its
ceiling is zero and it is fully quoted. The per-segment census floors are
untouched — the `docs/` segment grew rather than shrank.

## Out of scope, and untouched

No file under `os/` or `test/` was edited: this milestone documents what
shipped and invents no API claim. `docs/design/bus.md` took only a re-anchored
line number, for the reason given under item 5. The `.zh.md` siblings are not
updated, which is the standing state of that question and the reason the gates
exclude them.

## Reported, not fixed

Two staleness findings outside PLAN-022's causation, left for whoever owns the
documents rather than folded into a networking milestone:

- `docs/design/mosd.md` §5.3 says `reconciler::all()` *"returns five"* and
  tables five reconcilers; it returns seven, the extras being `container` and
  `mqtt`. Neither is PLAN-022's, describing them means measuring two subsystems
  this milestone did not touch, and §5 declares itself a dated record of
  2026-08-19 — so the count is left standing and the PLAN-022 banner says
  explicitly that §5.3's table and its count are that earlier record.
- The same document's §5.4 says *"`SCHEMA_VERSION` stays at 3"*, written when
  the power methods landed and true of them; the tree is at 7. It is a sentence
  about what the power methods did not change rather than a claim about today's
  schema, so it is left as written and the banner names it.

## Verification

| gate | result |
| --- | --- |
| `bash docs/verify-citations.sh` | `docs/verify-citations.sh: 1345/1345 PASS` — 0 resolution, 0 content, 0 census, 0 ratchet failures |
| `bash docs/verify-index.sh` | `docs/verify-index.sh: 732/732 PASS` |

Rust and e2e gates are deliberately not run: nothing under `os/` or `test/`
changed, so there is no build whose result would be about this milestone.
