# Design: Release artifacts — manifest, checksums, SBOM and the publication gate

> What a mos release *is* as a set of downloadable files: the machine-readable
> manifest that binds them, the supply-chain records generated beside them,
> the gate that refuses an incomplete set, and the procedure a customer
> follows to verify and identify a release. Companion to
> `release-signing.md`, which owns the two trust chains this document only
> points at.

## 0. How to read the status markers

The discipline is `access.md` section 0's: a mechanism that exists only as
prose has nothing that will ever notice it is absent, so every section
describing one carries a marker.

- **[implemented]** — code exists and is named, by path.
- **[proposed]** — deliberately, no code. Prose only, kept on the same page as
  the mechanisms it will join.

## 1. The release unit and the artifact set — **[implemented]**

There is no on-device package manager: the release unit is the signed
whole-system image/bundle set, so a release is a **directory of files**,
assembled by `bash build/run.sh --release assemble` (`make os-release-cx3576`;
`build/src/release-cli.ts` and `build/src/release-manifest.ts`), one directory
per board, default `_out/<board>/release`:

| file | role | where it comes from |
| --- | --- | --- |
| `<board>-mos-<epoch>.img` | `image` | the flashable A/B disk image, copied from the assembler's output under its real (non-`latest`) name |
| `mos-<board>-<epoch>.raucb` | `bundle` | the signed RAUC update bundle, likewise |
| `sbom.cdx.json` | `sbom` | derived from the image's `/usr/share/mos/manifest.tsv` (§3) |
| `provenance.json` | `provenance` | the source commit and dirty flag, the builder-image pins transcribed from `build-env/images.env`, and the sha256 of every input the assembly consumed |
| `licenses.json` | `licenses` | the license/source-offer inventory: the written source offer, the source identity it is redeemable against, and the package list it covers |
| `release-notes.md` | `release-notes` | supplied by the release owner (`--notes` / `MOS_RELEASE_NOTES`); a release without notes is refused |
| `SHA256SUMS` | `checksums` | every artifact above, in the two-space form `sha256sum -c` reads |
| `manifest.json` | — | the binding record: §2. It pins `SHA256SUMS` too, which is why `SHA256SUMS` cannot and does not list itself |

Every size and digest is **measured off the staged copy** — what the manifest
pins is what a customer downloads. Nothing in the set is invented: the
package list comes out of the image's own bill of materials, the versions in
it come from the mechanisms that stamped them (`build-env/deb/version.sh`,
`pkgs/*/versions.env` upstream pins), and the source identity comes from git.

## 2. The manifest schema, version 2 — **[implemented]**

`manifest.json`, validated by `checkReleaseManifest`
(`build/src/release-manifest.ts`); `schemaVersion` is checked as an
**equality** against the validator's floor, because a manifest written by a
newer schema may bind fields an old validator has never heard of, and
accepting it would verify less than the writer claimed.

| field | meaning |
| --- | --- |
| `schemaVersion` | `2` — 1 was the schema before the `trust` block below |
| `release.version` | the release version string (same character class as a bundle version) |
| `release.channel` | one of `development` / `candidate` / `stable` |
| `board.name`, `board.profile` | which board this release is for, and the image profile it was built at |
| `source.commit`, `source.dirty` | the full 40-hex git commit, and whether the tree carried uncommitted changes; a `dirty` release is one no commit reproduces |
| `build.builderImages` | the `IMAGE_`/`LOCAL_` pins from `build-env/images.env`, transcribed verbatim — recorded, not resolved; `build-env/from.sh` stays the one resolver |
| `bootAssurance` | the board's boot-assurance level (e.g. `"I1"`), populated **from the board-evidence file** (§4), never written by hand |
| `trust.grade`, `trust.developmentDomains` | `development` or `production`, and on a development image the domains its marker names; populated **from the image's own baked `/usr/share/mos/meta/`** (§4.1), never written by hand |
| `artifacts[]` | one entry per file: `filename` (plain, no path separators), `role` (§1's set), `bytes`, `sha256` |

The **publication floor**: at least one artifact of every role in §1 must be
present, every listed file must exist with the recorded size and digest,
`SHA256SUMS` must agree with the manifest, the release notes must be
non-empty, the SBOM must list at least one component, the board evidence
must be present and agree, and the trust grade must agree with the image and
be publishable on the channel claimed. Anything less is refused by the gate,
by name.

A channel is a claim about qualification, not a directory name: `development`
carries no promise, `candidate` is under qualification, `stable` is what
customers deploy. How channels are **hosted** (one directory per channel on a
download host, and how a release moves between them) is **[proposed]** —
today the tooling emits one gated release directory and stops.

## 3. The SBOM and the license inventory — **[implemented]**

The image ships its own bill of materials at `/usr/share/mos/manifest.tsv` —
the only record of what the image is made of, because the finalizer purges
dpkg's database (`rootfs/compose/90-pack.Dockerfile`). The SBOM is derived
from that file's content and from nothing else: one CycloneDX 1.5 component
per row (package, version; architecture as a property), with the source
commit and the written source-offer statement in the document metadata.
CycloneDX rather than SPDX for one reason a release cares about: it requires
no creation timestamp, so the SBOM is a pure function of its inputs and two
builds of one image emit identical bytes.

The assembly takes the manifest.tsv content as an explicit input
(`--package-manifest` / `MOS_PACKAGE_MANIFEST`) rather than extracting it
from the squashfs itself; the extraction needs the verify toolset and the
extracted file is the same bytes either way. A manifest.tsv that is
malformed, empty, or names no mos package is refused — the same three facts
verify's `packed-mos-manifest` check holds against the image.

`licenses.json` repeats the package list beside the offer statement on
purpose: it is the file a compliance request is answered from, and an answer
that says "see the other file" is not an inventory. The operational channel
for honouring the source offer (who answers, at what address) is product
documentation, **[proposed]** here.

## 4. The board evidence — **[implemented]**, semantics included

The gate consumes a per-board evidence file, default
`boards/<board>/evidence.json` (`--evidence` overrides). This file is the
**per-board/revision claim record**: what boot-assurance level the board
claims, what repo-verifiable evidence backs it, and what its physical/debug
posture honestly is. One is committed for each board — `boards/cx3576/
evidence.json` and `boards/x64/evidence.json`, both claiming **I1** today —
and its semantics live in exactly two places: the validator
(`checkBoardEvidence`, `build/src/release-manifest.ts`) and the I1–I4 ladder
it enforces (`docs/design/security-model.md` §5). Schema (v2, held as an
equality like the manifest's):

```json
{
  "schemaVersion": 2,
  "board": "cx3576",
  "revision": "all",
  "bootAssurance": "I1",
  "qualification": "what qualified this board, and what is honestly pending",
  "evidenceRefs": [
    { "class": "verity-root", "ref": "make os-verify-cx3576 (check verity-payload-verifies)" }
  ],
  "physicalBoundaries": {
    "jtag": "one honest sentence",
    "serialConsole": "one honest sentence",
    "recoveryPath": "one honest sentence"
  }
}
```

- `revision` is the board revision the record covers; `"all"` when one
  record covers every revision.
- Each `evidenceRefs` entry names an evidence **class** (closed set:
  `verity-root`, `ab-fallback`, `update-negative`, `vendor-boot-capability`,
  `signature-negative`) and a **repo-verifiable reference** — a Makefile
  target, a `tests/` suite, a `verify/` check name, or a `docs/design`
  section — so a claim is auditable by running or reading what it cites.
- `physicalBoundaries` states the debug/recovery posture per port
  (`docs/design/manufacturing.md` §6).

**Enforced level floor** (`LEVEL_REQUIRED_CLASSES`): any level needs a
non-empty `evidenceRefs` and a full `physicalBoundaries`; **I1** requires a
`verity-root` ref; **I2** additionally `ab-fallback` and `update-negative`;
**I3/I4** additionally `vendor-boot-capability` and `signature-negative`. A
claimed level missing a required class is a refusal naming that class. The
floor is **necessary, not sufficient** — the ladder's full qualification bar
(on-board runs, dated evidence) lives in the qualification prose and the
board record.

**Unsupported-claim wording**: the strings `secure boot` and `tamper-proof`
— matched case-insensitively, with the two words joined or separated by one
space, hyphen or underscore — are refused anywhere in `qualification`,
`evidenceRefs[].ref` or the `physicalBoundaries` statements unless the file
claims an evidenced I3/I4. The matcher does **no negation analysis**: "no
secure boot" is refused too; reword instead.

The manifest's `bootAssurance` field is populated from this file at
assembly, and the gate re-reads the file, re-applies all of the above, and
refuses a divergence.

### 4.1 The trust grade — **[implemented]**

The gate consumes one more input, the image's `/usr/share/mos/meta/`
**directory as extracted** (`--baked-meta` / `MOS_BAKED_META`, no default).
This is `--package-manifest`'s shape and it is that way for §3's recorded
reason: the extraction needs the verify toolset and the extracted bytes are the
same either way. The bound comes with it — a caller who hands over a directory
that did not come out of the image gets an answer about that directory — and it
is inherited rather than re-argued.

What is read there:

- **`updates/manifest.json` must be present**, and its absence is a **throw**
  rather than a verdict. It is a required member of the baked public set
  (`rootfs/build.sh`'s allowlist), so an extraction without it is either the
  wrong directory or an image that provisions no trust anchor. Grading such a
  directory "production" — which is what "no marker found here" means over an
  empty directory — would pass every image ever built on a host that never
  extracted one.
- **`GENERATED`**, present exactly when the signing material the image was
  built from came from `pkgs/rauc/gen-dev-keys.sh`. Its `DOMAINS=` line names
  which half — the RAUC keyring, the package signing key, or both.

Two refusals follow:

1. **A development-grade image may not be published to a customer channel.**
   `candidate` and `stable` are refused, naming the file found and the domains
   it names; `development`, which carries no promise (§2), still accepts one,
   and the manifest records the grade either way. Unconditional refusal was
   rejected: no production material exists yet, so it would make the release
   path unrunnable and ship this gate untested (`docs/plan/PLAN-077.md` §4.2).
2. **A customer release whose image trusts no package signing key** is refused,
   whether or not it bakes an update source. PLAN-070 §5.3 made the source
   operator-overridable, so "this image will never fetch a package" is no
   longer a fact the build can establish: an authenticated operator can point
   any device of the release at a server, and every package it then downloads
   is refused as unauthentic with no remedy but a new image. An empty
   `trust.signingKeys` stays a supported steady state on `development`, which
   is the shape every build in this tree has until a ceremony key exists.

The manifest's `trust` block is populated from this measurement and re-measured
by the gate, which must agree — the same two-source shape §4's `bootAssurance`
uses against the board evidence.

## 5. The publication gate — **[implemented]**

```sh
make os-release-gate            # or: bash build/run.sh --release gate [--dir DIR]
```

`gateReleaseDir` re-checks a release directory **from scratch** — nothing is
trusted from the assembly that wrote it — so the same command answers "may
this be published?" whether the directory was written a minute ago or
restored from an archive. Every refusal names the gap: the missing artifact
and its role, the file whose bytes or digest moved, the empty release notes,
the component-less SBOM, the absent or diverged board evidence, the
development-grade image on a customer channel (§4.1). The assemble
arm ends by running the same gate over what it wrote, so a directory that
assembles is a directory that gates.

Every refusal is proven red by mutation — `build/src/release-manifest.test.ts`
deletes an artifact, flips a byte, empties the notes, drops the evidence,
plants the development marker in the extraction and empties the trusted key
list, and requires each guard to fire by name; `tests/release-verify-test.sh`
drives the same mutations through the shipped CLI against a fixture release and
proves, across every refusal it raised, that no two share a message fragment.

## 6. The customer procedure

### 6.1 Choose a channel and download — **[implemented]** identity, **[proposed]** hosting

A customer deploying to production takes the `stable` channel and downloads
the release directory's contents for their board. Until hosting exists (§2),
"download" means "receive the gated release directory"; the verification
below is the same either way.

### 6.2 Verify the download — **[implemented]**

In the release directory, with the standard coreutils and `jq`:

<!-- release-verify-test: begin -->
```sh
sha256sum -c SHA256SUMS
jq -r '.release.version, .release.channel, .board.name, .source.commit' manifest.json
jq -e '.schemaVersion == 2' manifest.json
```
<!-- release-verify-test: end -->

The first line proves every artifact's bytes are the bytes the release
manifested; the second prints the release identity; the third pins the
schema this procedure was written against. These exact command lines are
**executed by `tests/release-verify-test.sh`** against a locally generated
fixture release — the test extracts them from between the two HTML markers
above, refuses an empty extraction, and also proves the first one goes red
on a flipped byte — so this section and the tooling cannot drift silently:
editing a command here means the test runs the edited command.

`SHA256SUMS` and `manifest.json` themselves are integrity, not authenticity:
they travel with the artifacts. Authenticity comes from the two trust chains
`release-signing.md` owns — where a TUF repository is published, verify it
against the out-of-band root anchor (`rauc-sign verify --repo <repo> --root
<trusted root.json>`, **[implemented]** as tooling in `pkgs/rauc-sign`), and
the device itself verifies the bundle's CMS signature against its keyring at
install time (**[implemented]**). Pinning `manifest.json` in the TUF
repository is **[implemented]**: `rauc-sign add --manifest` publishes it as
its own target beside the bundle (`<bundle>.manifest.json`, sha256 and
length pinned) and stamps the manifest's board/profile/channel/version onto
the bundle target as signed selection metadata (`release-signing.md` §3);
the manifest then binds the *rest* of the release directory to the bundle by
digest — the other artifacts are covered transitively, not pinned as TUF
targets individually, and publishing them as such remains **[proposed]**.

### 6.3 Identify a release in a support case — **[implemented]** fields

A support case cites the identity `manifest.json` binds: the
`release.version` and `release.channel`, the `board.name`/`board.profile`,
the full `source.commit` (and whether `source.dirty` — a dirty release is
one no commit reproduces, and saying so is the point of recording it), and
when the case is about an update, the bundle artifact's `sha256`. On the
device side, `/usr/share/mos/manifest.tsv` names the installed package set
and its one git stamp, which is the same commit — the two ends of the case
meet at that identity.

## 7. What never happens

- **No digest, size or version is ever typed into a release by hand.** Every
  number is measured off a file or read out of the mechanism that stamped it;
  the tooling has no flag that overrides a measurement.
- **No release without notes, and no release without evidence.** The gate has
  no waiver flag; a release that cannot pass it is not published.
- **No second resolver of the builder-image pins.** `build.builderImages` is
  a verbatim transcription; `build-env/from.sh` remains the only thing that
  validates or resolves a pin.
