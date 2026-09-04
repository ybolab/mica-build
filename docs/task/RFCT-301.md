# RFCT-301 The meta/ seam and its enforcement (PLAN-070 F1, F1b, F2, F3, F4, F12)

- **status**: completed
- **priority**: P1
- **owner**: meta-seam/bkd-67n9ae87
- **createdAt**: 2026-09-04 18:00
- **relatedPlan**: docs/plan/PLAN-070.md

## Description

PLAN-070 (approved 2026-09-04) designs `meta/`: a gitignored build-host
directory holding the configuration and every private key a release needs, of
which exactly two files reach the image. This task implements the seam itself
and the two enforcement pairs that make its central hazard mechanical:

- **F1** — `meta.example/` committed with its README; `/meta/` gitignored, the
  `/ca/` tombstone kept.
- **F1b** — `pkgs/rauc/gen-dev-keys.sh` absorbed onto `meta/`: `--domain rauc`
  by default, `--domain updates` opt-in, `meta/GENERATED` naming the domains it
  wrote, `manifest.json` instantiated from `meta.example/`.
- **F2** — the `ca/` → `meta/rauc/` rename across `rootfs/build.sh`,
  `bundle-cli.ts`, `verify` (`ctx.caDir` → `ctx.metaDir`,
  `packed-keyring-from-ca` → `packed-keyring-from-meta`), the fixtures,
  `compose-install.sh` and both trust test suites.
- **F3 + F4** — the §1.1 allowlist and refusal **B1** in `rootfs/build.sh`, and
  the verifier checks **B2** (`packed-meta-is-the-public-set`,
  `no-private-key-in-baked-meta`). A pair: F3 without F4 proves only that the
  build meant well.
- **F12** — the key algorithm as a declared, validated parameter:
  `pkgs/rauc/key-algorithms.env`, the generator reading it, and refusals **A1**
  and **A2** in `rootfs/build.sh`'s existing unwaivable shape.

F12 rides with F1b because both rewrite `gen-dev-keys.sh`.

Not in this task: F5–F11, and the ssh slice open question 8 blocks.

## ActiveForm

Implementing the `meta/` seam and its build-time and image-time enforcement.

## Dependencies

- **blocked by**: (none)
- **blocks**: F5–F11 of PLAN-070's backlog

## Acceptance

- **F1**: `meta.example/updates/manifest.json` is §2's document with
  `update.source = null` and `fleet.url = null`; `meta.example/README.md` says
  which files are public and which never leave the host; the committed example
  names no server and contains no key-shaped file. `/meta/` is gitignored and
  the `/ca/` tombstone is kept.
- **F1b**: a fresh checkout builds an image; a second build regenerates
  nothing; `meta/GENERATED` survives and names the domains it covers.
- **F2**: the existing suites pass with their meanings unchanged, not their
  expectations edited.
- **F3**: a planted `root.key` under a staged path turns the build red and
  names the file; the tree as generated stays green. The private-key detector
  has all three tests (PEM armour, DER PKCS#8, key-container extension).
- **F4**: an image with an added, removed or altered file under
  `/usr/share/mos/meta/` fails; an image with a planted key under either scoped
  path fails; a tree with no `meta/` **throws** rather than passing;
  `no-private-key-in-baked-meta` reports the file count it scanned.
- **F12**: changing an algorithm is a one-line edit to `key-algorithms.env` and
  touches no code; a declared value outside its role's set turns the build red
  and names the verifier that bounds the set; a `meta/` holding material
  outside the set turns it red too, **including the `--domain updates` key,
  which A1 alone would not have seen**; no comment names a reason the code no
  longer follows or a fact the code contradicts.
- `make os-debs`, `bash tests/deb-package-gate.sh`,
  `bash tests/install-closure-gate.sh` green.
- A composed x64 image and `bash verify/run.sh --verify --board x64` green,
  including the new checks.
- `(cd verify && bun test)`, `(cd build && bun test)`, `make docs-verify` green.
- Both trust test suites green with their meanings unchanged.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

- complete: the `meta/` seam exists, exactly two of its files reach the image,
  and four unwaivable refusals plus two verifier checks hold that split from
  both ends. Slices delivered: **F1, F1b, F2, F3, F4, F12**.

  **F1.** `meta.example/updates/manifest.json` is section 2's document with
  `update.source` and `fleet.url` at `null`, `trust.signingKeys` empty, and no
  key of any shape — not even a placeholder, because a file named like a key in
  a committed directory is a file somebody eventually fills in.
  `meta.example/README.md` states the public set, the build-host-only set, the
  three prohibitions on the baked set and why no check is proposed for the
  third. `/meta/` is gitignored; `/ca/` stays as a tombstone with the reason
  written beside it.

  **F1b.** `gen-dev-keys.sh` writes into `meta/`, with `--domain rauc` the
  default (build-blocking, what `--if-absent` runs) and `--domain updates`
  opt-in. `meta/GENERATED` carries a `DOMAINS=` line and merges rather than
  replaces, because the two domains are separate invocations and a marker
  naming only the last one would un-flag material it still covers.
  `meta/updates/manifest.json` is instantiated from `meta.example/` whenever it
  is absent and is never overwritten. Measured: `rm -rf meta && bash
  pkgs/rauc/gen-dev-keys.sh --if-absent` writes six files and the loud notice;
  the second and third `--if-absent` runs print nothing at all;
  `--domain updates` adds `root.key`, writes its base64 public half into
  `trust.signingKeys`, leaves `signingKeyIds` empty (the build derives it, F7)
  and turns the marker into `DOMAINS=rauc updates`.

  **F2.** `ca/` -> `meta/rauc/` across `rootfs/build.sh`, `build/src/bundle.ts`
  (`CA_DIR` -> `RAUC_KEY_DIR`), `bundle-cli.ts`, `verify` (`ctx.caDir` ->
  `ctx.metaDir`, `packed-keyring-from-ca` -> `packed-keyring-from-meta`), the
  fixtures, `compose-install.sh`, both trust test suites, the Makefile and
  `.gitignore`. **No assertion's meaning changed.** Two edits were needed that
  are worth naming rather than burying:

  - `tests/trust-domain-hygiene-test.sh`'s "the RAUC build surfaces name no TUF
    key directory or `.pk8` file" now excludes the GLOB spelling `*.pk8`, and
    only that spelling. `rootfs/build.sh`'s private-key detector lists the
    key-container extensions in order to REFUSE them, which is the opposite of
    the RAUC side reaching for TUF material; a grep that cannot tell a refusal
    from a read would have had exactly one finding and it would have been false.
    A named path under the TUF key directory still counts.
  - `tests/rauc-trust-negative-test.sh`'s scratch tree now also carries
    `key-algorithms.env` and `meta.example/`, because the generator reads both.
    That means the suite signs with the algorithm the tree actually ships, so a
    change to that value is exercised there rather than assumed harmless — and
    it is: all ten cases pass with an ECDSA P-256 CA and signer.

  The rename reached past the plan's enumerated list, which section 6.1 asked
  to have surfaced: `pkgs/rauc/system.conf.in`,
  `pkgs/rauc/Dockerfile.dockerignore`, `rootfs/compose/10-compose.Dockerfile`,
  `build/HARNESS.md`, and the design and user docs that named `ca/` —
  `build.md`, `security-lifecycle.md`, `security-model.md`,
  `manufacturing.md`, `user/quickstart.md` and the two zh mirrors. All are
  mechanical. `docs/CHANGELOG.md` was left alone: it is a record of what a past
  change said, and L1 owns it.

  **F3.** The allowlist is a two-entry table in `rootfs/build.sh` mapping a path
  under `meta/` to a path in the image, and the staging step copies by name into
  `_out/<board>/meta-public/` at those image paths. The keyring no longer takes
  a detour through the overlay stage: it and the manifest travel one way, are
  audited once, and reach the composition context together, so there is one
  selective-bake rule rather than two. `compose-install.sh` installs each by
  NAME rather than walking the staged tree — a walk would turn the allowlist
  into a suggestion.

  B1 is two refusals in the overlay-keyring refusal's shape, unwaivable: an
  off-allowlist path in the staged tree, and private key material, checked both
  over the file about to be staged (so the sentence names the file in `meta/`
  somebody has to fix) and over the staged tree. The detector has all three
  tests — PEM armour in every spelling openssl and ssh-keygen write, a DER
  PKCS#8 `PrivateKeyInfo` header (`30 <len> 02 01 00`), and a key-container
  filename extension — because an armour grep is blind to `root.key`, which is
  the one file the hazard is named after.

  Measured, running the real `rootfs/build.sh`: a private key pasted into
  `meta/updates/manifest.json` as a JSON string value (the document still
  parses and still carries `trust.signingKeys`) turns the build red, names the
  file and names the image path it would have reached. The tree as generated
  prints `meta: staged and checked 2 public file(s)` and continues.

  **Stated rather than glossed:** B1's off-allowlist trigger is not reachable
  from data alone. The staging step wipes its destination and copies by name, so
  the only way a file appears there without an allowlist entry is a later `cp`
  in build.sh — which is exactly the case section 1.1 says it guards, and
  exactly why F4 is not optional. The image-side equivalent IS driven from data
  and is tested: `packed-meta-is-the-public-set` goes red on an added file under
  the baked path.

  **F4.** Two checks in `verify/src/checks-root.ts`:

  - `packed-meta-is-the-public-set` — `/usr/share/mos/meta/` holds exactly the
    allowlisted set, each byte-equal to its source under `meta/`. Three
    distinct failures with three sentences (extra, missing, differing), and a
    **throw** rather than a pass when the tree has no `meta/` to compare
    against, for `packed-keyring-from-meta`'s recorded reason.
  - `no-private-key-in-baked-meta` — the same three detectors over
    `/usr/share/mos/meta/` and `/etc/rauc/`, scoped rather than whole-root
    because a check whose findings are usually false is a check people learn to
    pass. It **reports the file count it scanned**, and a scan of zero files is
    RED rather than green.

  Eleven new tests drive them from the failing side (5 + 6, each with a
  positive control and each mutation asserted green on the baseline first):
  added file, removed file, altered file, absent `meta/` (throws), PEM armour,
  raw PKCS#8 DER, `.p12` filename, a key under the other scoped path, and an
  empty search space. The positive control reads the
  expected scan count off the fixture tree rather than writing it down, so it
  cannot go red for a reason that is not about the detector.

  On the real x64 image both are green and say what they read:
  `holds exactly 1 file(s) [updates/manifest.json] ... no extra file, no
  missing file, no differing byte` and `scanned 3 file(s) under
  [/usr/share/mos/meta /etc/rauc] with all three detectors`.

  **F12.** `pkgs/rauc/key-algorithms.env` carries the three defaults with the
  reason beside each. `gen-dev-keys.sh` reads it and maps a tool-neutral name to
  openssl's spelling; the mapper is deliberately WIDER than the allowed sets
  (`rsa-2048` is mintable and refused), which is what makes A1's refusal
  reachable with a value that would otherwise have worked. The sets live in
  `rootfs/build.sh`, not beside the values, because a set is a claim about a
  verifier: changing an algorithm is a one-line edit, widening a set is a code
  change and a claim about the verifier the message names.

  Measured against the real build, each refusal unwaivable and naming its
  verifier:

  - A1, `MOS_KEY_ALG_RAUC_CA=rsa-2048` -> red, `allowed: ecdsa-p256 ecdsa-p384
    rsa-3072 rsa-4096`, bounded by "RAUC's own verifier -- OpenSSL's CMS
    implementation".
  - A1, `MOS_KEY_ALG_PACKAGE=ecdsa-p256` -> red, `allowed: ed25519`, bounded by
    "lode's verifier -- ed25519-dalek".
  - A2, an RSA-2048 CA **placed** in `meta/rauc/` with every declared value
    still in range -> red. This is the production case, and A1 cannot see it.
  - A2, an ECDSA `meta/updates/root.key` -> red. This is the case A1 could
    never have seen at all: that key is not minted on the build path, so nothing
    A1 reads describes it.

  A2 reads only material that is THERE, because `release-signing.md` section
  2.5 provisions a release host without `ca.key.pem` on purpose; what stops
  that from becoming a vacuous pass is the count it prints
  (`A2 read 5 file(s)`) and a refusal at zero.

  **The two corrections owed regardless.** The generator's comment claiming
  PKCS#1 v1.5 determinism made `signingTime` the only source of variance is
  gone; it now points at `key-algorithms.env` and restates no reason, because
  the claim was false about this tree — `bundle.ts` records that rauc salts the
  bundle's verity tree at random, and that is the statement with a passing test
  behind it. `release-signing.md` section 2.1 now records the SET, that the
  ceremony and the generator must agree on the set and not on the default, that
  a production CA differing from the development default is not drift, and
  production's own reason for RSA-4096 (conservatism about a key a missed
  rollover window strands until reflash) instead of the dev script's.

  **One line added after the PLAN-070 amendment landed.** §7's amended
  fresh-checkout walkthrough restates §1.2's *"the build says so in one line"*
  for an empty `trust.signingKeys`, and that line was missing. `rootfs/build.sh`
  now prints it, and only when the list is empty: measured both directions --
  silent with a baked key, announced on a `--domain rauc`-only tree. It is
  output, not behaviour: no staged byte and no image byte changes with it, which
  is why the image gates below were not re-run for it.

  **Gates, all green on `4da24a7b`:**

  - `make os-debs` (exit 0; one stamp `git4da24a7b0ae2-1` across both pools)
  - `bash tests/deb-package-gate.sh` — 272/272
  - `bash tests/install-closure-gate.sh` — 99/99, 14 clean roots
  - `MOS_BOARD=x64 bash rootfs/build.sh` + `bash build/run.sh --mkimage-x64`
    then `bash verify/run.sh --verify --board x64` — **313/313**, including both
    new checks and the renamed `packed-keyring-from-meta`
  - `(cd verify && bun test)` — 1264/1264
  - `(cd build && bun test)` — 869/869
  - `make docs-verify`
  - `bash tests/rauc-trust-negative-test.sh` — 10/10 plus the marker and mode
    assertion; `bash tests/trust-domain-hygiene-test.sh` — 8/8
  - `bash tests/shell-pipefail-lint.sh` — 69/69

  Re-run after the one-line addition: `bash tests/shell-pipefail-lint.sh`
  (69/69) and `bash tests/trust-domain-hygiene-test.sh` (8/8), plus the meta
  block of `rootfs/build.sh` in both signingKeys states. Nothing under
  `verify/`, `build/` or `docs/` changed with it.

  No Rust was touched, so `cargo test` was not run.

  **Checked against the 2026-09-04 amendment** (*the two URLs become
  overridable, the anchors do not*), which reached main as `c3b61cb8` and was
  already merged here. §2's manifest schema is unchanged by it, so the committed
  example still matches; §7's amended walkthrough names
  `packed-keyring-from-meta` and `packed-meta-is-the-public-set` and describes
  the fresh-checkout path this slice produces, step for step. The five backlog
  rows it edited are F6, F6b, F8, F9 and F11 -- none of them here. Its
  anchor-versus-address boundary is untouched by these refusals by
  construction: `META_PUBLIC`, `BAKED_META_DIR` and `PRIVATE_KEY_SCAN_DIRS` name
  only baked paths, and nothing in F3, F4 or F12 reads `/mos/config/`.

  **Not done, and deliberately:** F5, F6, F6b, F6c, F6d, F6e, F6f, F6g, F7, F8,
  F9, F10 and F11 of PLAN-070's backlog. Open question 8 (whether the ssh pour
  carries `authorizedKeys`) is untouched and still blocks the ssh slice.
  `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` were not
  edited.
