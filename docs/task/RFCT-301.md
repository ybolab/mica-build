# RFCT-301 The meta/ seam and its enforcement (PLAN-070 F1, F1b, F2, F3, F4, F12)

- **status**: in_progress
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
