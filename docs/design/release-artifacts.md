# Release artifacts

A release directory binds a complete factory image, one signed component update,
an independent signed firmware package, and the records needed to identify those
bytes. It uses only `mos/release/v1` and `MOSUPD01`. The update archive contains a
signed deployment and its kernel, support and root objects; firmware maintenance
remains a separate operation. There is no earlier-format reader or migration.

## 1. Release identity and channels

`manifest.json` records the board, version, profile, source commit and dirty flag,
board assurance, development signing domains, and every artifact's role, length
and SHA-256. A directory has exactly the file roles below. Missing, extra,
duplicate, nonregular and changed files fail the gate. Unknown schema fields and
schemas fail as well.

The source commit is the full Git identity measured at assembly. A dirty build
records `dirty: true`; the commit alone does not reproduce uncommitted changes.
Keep the reviewed source snapshot with any such development artifact.

| Channel | Meaning | Development marker allowed |
| --- | --- | --- |
| `development` | Local integration and test material | Yes |
| `candidate` | Material awaiting release qualification | No |
| `stable` | Qualified release material | No |

The current repository provides development signing inputs and virtual/software
evidence. Passing the directory gate does not promote a board's qualification.
Only boards with `BOARD_RELEASE_TARGET=1` have a publication command. `virt-arm64`
remains an architecture acceptance target; its complete test images use the same
component/image producers without claiming a product release.

## 2. Directory contents

| Filename | Content |
| --- | --- |
| `mos-BOARD-YYYYMMDD-HHmmss.img` | Complete current three-partition factory image, named by UTC build time |
| `update.mosupd` | `MOSUPD01` deployment envelope and authenticated objects |
| `firmware.json` | Independently signed `mos/firmware/v1` envelope |
| `firmware.bin` | Firmware bytes named by that envelope; the original destination remains in its signed target |
| `package-manifest.tsv` | Root image's `/usr/share/mos/manifest.tsv` |
| `baked-meta.json` | Root image's `/usr/share/mos/meta/updates/manifest.json` defaults |
| `development-marker.txt` | Current development domain declaration; empty when no marker is present |
| `board-evidence.json` | Board-specific assurance and physical boundary statements |
| `builder-images.json` | `IMAGE_*` and `LOCAL_*` values from `build-env/images.env` |
| `sbom.cdx.json` | Deterministic CycloneDX 1.5 inventory of installed root packages |
| `licenses.json` | Package/source-offer inventory with the measured source identity |
| `provenance.json` | Source, builder pins and hashes of all assembly inputs |
| `release-notes.md` | Required, nonempty release notes supplied by the release author |
| `SHA256SUMS` | Ordered digests of every artifact except itself |
| `manifest.json` | Release identity and digests, including `SHA256SUMS` |

The image basename is preserved from the component build. It must contain the
release board and a valid UTC timestamp to the second. Exactly one image is
allowed; its filename is also recorded in checksums and provenance.

The SBOM lists package names, versions and architectures. It is not a recursive
inventory of vendored Rust crates, JavaScript dependencies, kernel modules or
firmware sources. The source-offer inventory is not an SPDX license-expression
scanner; package copyright notices and the kernel/support firmware notices carry
the underlying licensing information. Distribution still needs an actual source
request address and responder; no hosted release or responder is currently
claimed. See [the licensing brief](../website/licensing.md).

## 3. Assembly

Build the complete image and signed components first using
[the component build flow](build.md). Pack the release's deployment with
`build/run.sh --components archive`. The selected update's board and version must
match the release; the independently versioned firmware must match its board.

Extract the package manifest and public defaults from the exact verified root
used by the factory image. The assembler accepts these extracted inputs
explicitly. It binds their bytes, but does not itself extract the image or prove
that a caller supplied the correct extraction. Image verification and retention
of the component build records are required alongside this gate.

```bash
bash build/run.sh --release assemble \
  --board x64 --version 1.0.0-dev --channel development --profile dev \
  --image /absolute/build/image/mos-x64-20260909-164233.img \
  --update /absolute/build/update.mosupd \
  --firmware /absolute/build/firmware \
  --package-manifest /absolute/extracted/usr/share/mos/manifest.tsv \
  --baked-meta /absolute/extracted/usr/share/mos/meta \
  --notes /absolute/release-notes.md \
  --public-key /absolute/metadata.pub \
  --out /absolute/new-release-directory
```

Paths resolve from the repository root. Repeat `--public-key FILE` for an
explicit overlap set. Each file contains one base64 Ed25519 public anchor, not a
private key or certificate. The board evidence defaults to
`boards/BOARD/evidence.json`; `--evidence FILE` selects another measured record.
The output directory must not exist. A failed assembly must not be published.

The current `GENERATED` marker has exactly one declaration:

```text
DEVELOPMENT-GRADE
DOMAINS=boot verity updates
```

Only the three named domains are accepted, without duplicates. Absence means
that the supplied extraction has no development marker. It does not prove key
custody, firmware enrollment, physical protection or production readiness. Baked
public defaults contain no signature trust anchors: metadata anchors are explicit
verified-boot inputs. There is no `trust.signingKeys` reader.

## 4. Gate and evidence

`build/src/release-manifest.ts` verifies lengths and SHA-256 with bounded streaming
reads. It authenticates the update envelope against supplied public keys, checks
the exact deduplicated object set and every object's digest, and refuses truncated
or trailing archive data. It independently authenticates the firmware envelope
and checks its payload. Rewriting the unsigned release checksums cannot make
changed signed component bytes pass these checks.

The gate reconstructs the SBOM, source-offer inventory and provenance from their
bound inputs and compares them to the records in the directory. It requires
nonempty notes, canonical development domains, and the channel restrictions.
Changing a derived record and updating its checksum still fails.

Board evidence uses schema 2 with a matching board, revision, qualification,
references and explicit JTAG, serial-console and recovery boundaries. Required
reference classes increase with the assurance ladder:

| Level | Required reference classes |
| --- | --- |
| I1 | `verity-root` |
| I2 | I1 plus `ab-fallback`, `update-negative` |
| I3 | I2 plus `vendor-boot-capability`, `signature-negative` |
| I4 | I3; hardware and operational qualification remains an additional obligation |

This checks evidence completeness, not the truth of prose or physical execution.
References to disposable QEMU firmware enrollment do not qualify physical
hardware. See [the security model](security-model.md) and
[board qualification](../bsp/qualification.md).

## 5. Verify a received directory

Obtain the metadata public anchor through the release's trusted distribution
channel, independently of the downloaded directory. Set `REPO` to this checkout,
`RELEASE` to the received directory, and `METADATA_PUBLIC_KEY` to that public-key
file. The following commands are executed by the release fixture test:

<!-- release-verify-test:start -->
```bash
(cd "$RELEASE" && sha256sum -c SHA256SUMS)
bash "$REPO/build/run.sh" --release gate --dir "$RELEASE" --public-key "$METADATA_PUBLIC_KEY"
```
<!-- release-verify-test:end -->

`manifest.json`, notes, SBOM and factory-image checksums are an unsigned integrity
record. An attacker replacing that entire unsigned record can replace the image
and prose; the authenticated update/firmware checks do not authenticate arbitrary
image bytes or notes. Use the independent current image verifier before flashing:

```bash
bash verify/run.sh --verify --board x64 \
  --image /absolute/new-release-directory/mos-x64-20260909-164233.img \
  --public-key /absolute/metadata.pub
```

A full current image boot, update/fallback acceptance and the board's required
physical tests remain separate release requirements. Never treat a fixture
image's directory-gate pass as a boot pass.

## 6. Executable acceptance

`make os-release-verify-test` runs the shipped CLI and the documented verification
commands. It also checks missing/unlisted files, changed artifacts, symlinks,
invalid schema/fields/roles or image timestamps, empty notes, duplicate package
rows, malformed markers, prohibited channels, wrong anchors, archive truncation/trailing data,
repinned object corruption, mismatched boards and insufficient evidence.

The build suite runs the same tests. The complete-image release exercise uses
real current artifacts separately, because small deterministic fixtures cannot
substitute for the image/runtime gates.
