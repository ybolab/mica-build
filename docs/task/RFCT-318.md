# RFCT-318 The last producer and the two judges move into containers

- **status**: completed
- **priority**: P2
- **owner**: plan080-b2b3/bkd-5ao2n8zg
- **createdAt**: 2026-09-05 01:50
- **relatedPlans**: [PLAN-080](../plan/PLAN-080.md) backlog B2 and B3

## Description

PLAN-080 §5.5 registered six exemptions from "no toolchain on the host". Three
of them were this task's:

- **B2, the producer.** `pkgs/rauc/gen-dev-keys.sh` called host `openssl` six
  times to mint the RAUC CA, the bundle signer certificate and the ed25519
  package root key, and host `jq` once to write that key's public half into
  `meta/updates/manifest.json`. Every one of those bytes is baked into `meta/`
  and into every image, so under §0.1 both tools are **producers** and the trust
  material in every image built here was minted by an unpinned host tool.
- **B3, the two judges.** `rootfs/build.sh`'s `alg_of_material()`, which reports
  a key's algorithm by parsing openssl's own version-sensitive text output, and
  `tests/repart-loader-test.sh`'s five host `sgdisk` reads of an assembled
  image's partition table.

## ActiveForm

Moving gen-dev-keys.sh, alg_of_material() and the repart test's sgdisk reads
into pinned containers.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- The six `openssl` calls and the one `jq` call in `pkgs/rauc/gen-dev-keys.sh`
  run in a digest-pinned container, with no host route and no fallback.
- What gets minted does not change; any difference a pinned openssl introduces
  is reported rather than absorbed.
- Both judges take the container route; the host route is gone.
- The exemption rows for all three come off
  `tests/host-toolchain-exemptions`, and `make os-host-toolchain-lint` still
  passes with every remaining rule matching something.
- Everything touched compiles (`bash -n`).
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

## 1. The image, and why it is a new one

`localhost/mos-build-openssl` — `build-env/openssl/Dockerfile`, a row in
`build-env/build.sh`'s table, `LOCAL_MOS_BUILD_OPENSSL` in
`build-env/images.env`, `FROM localhost/mos-build-base` like `c`, `deb`, `go`
and `rust`. It installs `openssl` and `jq` and nothing else.

**Not two more packages in `mos-build-base`**, which is the FROM of every
builder in the tree: anything installed there is paid for by every component
build, and these two are wanted by one generator and one read-back.
`mos-build-rust-check` made the same call for the same reason.

**Not an upstream image with openssl in it.** Measured 2026-09-05: none of the
seven `IMAGE_` pins carries the openssl *command* except `IMAGE_BUN_1`, and none
carries `jq` at all — `alpine:3.21`, `debian:trixie-slim`, `debian:bookworm-slim`,
`ubuntu:24.04`, `alpine:3.24.1` and `docker:28-cli` all answer `none` to both.

Floors, in `images.env`, measured by installing both into `IMAGE_DEBIAN_TRIXIE`:
`OPENSSL_FLOOR_OPENSSL_MIN=3.5` (trixie has `openssl 3.5.7-1~deb13u2`) and
`OPENSSL_FLOOR_JQ_MIN=1.7` (`jq 1.7.1-6+deb13u3`, which prints `jq-1.7` — it
does not print its Debian revision, so 1.7 is the number a floor can compare).
The image also writes `MOS_BUILD_OPENSSL_VERSION` into
`/etc/mos-build/openssl.env`, so **which** openssl minted a keyring is
answerable rather than inferred from a floor — which matters more here than for
the other floors, because nothing downstream re-derives what openssl chose to
put in a certificate.

**The version gap is real, not hypothetical.** This host carries `OpenSSL 3.0.2
15 Mar 2022`; the image carries trixie's `3.5.7`. A tree whose trust root was
minted by whichever of the two happened to be on `PATH` is exactly what the
policy removes.

## 2. B2 — the generator

`openssl` and `jq` are now shell functions wrapping one `docker run`, so the six
mints read as what they are and the diff is about *where* they run:

- **Identity mount.** `meta/` at the same absolute path inside as out, so every
  path in the script is the path the tool is handed. Every file the two touch —
  keys, certificates, the CSR, the signer's extension file, `manifest.json` — is
  under it, which is what makes one mount enough.
- **`--user "$(id -u):$(id -g)"`.** Files a container writes into a bind mount
  are owned by the uid that wrote them; a root-owned `meta/` in a developer's
  checkout could not be rotated with `--force` without sudo.
- **`umask 0077` set *inside*.** The script's own `umask` applies to its shell,
  not to a process in another namespace, and a private key must not exist as
  0644 even for the moment before the `chmod`.
- **Resolved lazily.** The common call is `--if-absent` over a complete `meta/`,
  which mints nothing and exits before the image is ever resolved: a build on a
  tree that already has its trust root must not need a builder image in order to
  discover it has nothing to do. The `rauc`-domain path that only instantiates a
  missing `manifest.json` likewise opens nothing.
- **No host route, no probe, no fallback**, which is what §0.1 gives a producer.
  The old `command -v openssl` and `command -v jq` guards are gone; what replaces
  them is a `docker` check and a `from.sh` resolution that names the missing
  image and says `make build-env`.

### 2.1 The one shape change, reported rather than absorbed

The signer's extensions were passed as `-extfile <(printf ...)`. A `<(...)` is a
`/dev/fd` path belonging to the calling shell, and the openssl reading it now
runs in a container that cannot see this shell's file descriptors — it would
report a missing extension file and mint nothing. They are written to
`meta/rauc/signer.ext` instead and removed with the CSR. **Same two lines, same
bytes, same certificate**; nothing about `basicConstraints` or `keyUsage` moved.

Nothing else about the mint changed: the same `openssl req -x509` /
`openssl req` / `openssl x509 -req` / `openssl verify` invocations, the same
`-days`, `-sha256`, `-subj` and `-addext` arguments, the same
`key-algorithms.env` and `key-validity.env` values (ECDSA P-256 for CA and
signer, ed25519 for the package key, a 45-day signer), the same
`-CAcreateserial`, the same modes and the same `GENERATED` marker text.

**What was NOT verified: that openssl 3.5.7 and openssl 3.0.2 mint the same
shape.** Nothing was executed this batch. Encoding, extension ordering and
serial generation are exactly the three places a version difference could show,
and the honest statement is that the code path is right and the byte comparison
is owed — §5 says who owes it.

## 3. B3 — the two judges

**`rootfs/build.sh`.** `alg_of_material()`'s three readers go through the same
image, `meta/` mounted **read-only** — a reader that cannot write cannot repair
what it is judging. The image is resolved **in the main shell**, above the
function, and not on first use inside it: `alg_of_material` reads openssl
through `$(... || true)`, so a refusal raised in there would be swallowed and
surface as "openssl could not read this file", refusing a build over material
that is fine. `ca.cert.pem` is required a few lines above, so that resolution is
always reached with work to do.

This one is a judge whose *text* is the product: it greps for `NIST CURVE:`, the
word `ED25519` and the `-Key: (2048 bit)` shape. A machine whose openssl prints
those differently does not report a different algorithm — it reports none.

**`tests/repart-loader-test.sh`.** The container route was already there and was
taken **only when the host had no `sgdisk`**. It is now unconditional. A judge's
contract is the pinned container; a host route that takes over whenever
`/usr/sbin/sgdisk` exists makes "p1 covers LBA 64" a statement about the machine
as much as about the image. The tool image, the `_out` identity mount and the
`sgdisk()` wrapper are unchanged.

## 4. The rows that came off, and the sixth that did not

Removed from `tests/host-toolchain-exemptions`, and from the §0.3 tables in
`docs/design/build.md` and `docs/zh/design/build.md`:

| Row | |
| --- | --- |
| `pkgs/rauc/gen-dev-keys.sh` | `openssl` |
| `rootfs/build.sh` | `openssl` |
| `tests/repart-loader-test.sh` | `sgdisk` |

`jq` had no row to remove — it is not in the check's table, deliberately, and
the register said its one producing use travelled with the openssl row. It did.

Five rules remain, all matching: the two `hack/check.sh` `cargo` rows, their two
`host-toolchain-on-PATH` rows and `.github/workflows/check.yml` — PLAN-080's
**B7**, which is a CI change.

`make os-host-toolchain-lint` after the change:

```
RESULT: PASS (97/97 files clean, 0 finding(s), 9214 command lines examined,
3095 elided, 6 file + 18 block container declarations, 15 exempted
invocation(s) under 5 rule(s))
```

Eleven new `container-block` declarations, one per call site, each stating what
runs in the image and what does not — the `sed`/`awk`/`grep` after a pipe is
still this shell's, and the markers say so rather than claiming the whole line.

## 5. What was not verified, and what is owed

Verification was traded for wall-clock by explicit instruction: no suite was
run, no image was built, nothing was composed. What ran is in §6. What is owed:

- **`tests/rauc-trust-negative-test.sh`** — and it needed a source change, which
  makes it the largest owed item. It used to run the generator **inside** its
  pinned trixie container; the generator now drives docker, and there is no
  docker client in there. So it mints in the scratch tree *before* that
  container starts, and the scratch "repository" gained `build-env/from.sh` and
  `build-env/images.env` because the generator resolves its image through them.
  The suite reads exactly the same files afterwards. `make build-env` is a
  prerequisite of it now. **Not run.**
- **`make os-repart-test`** — needs privileged docker and an assembled image.
  **Not run.**
- **`make build-env`** — `build-env/openssl/Dockerfile` has never been built.
  Its floor expressions and its `openssl dgst` liveness check are unexecuted.
- **A byte comparison of material minted by 3.0.2 and by 3.5.7**, per §2.1.
- **`rootfs/build.sh`'s A2 against the container reader** — the three text
  patterns are unchanged, and whether 3.5.7 prints `NIST CURVE:` and `ED25519`
  the way 3.0.2 did was not observed.

## 6. Documents touched

- **`docs/design/build.md` §0.0 and §0.3, and `docs/zh/design/build.md`'s
  mirrors of both.** The three rows are gone, replaced by a paragraph saying
  what closed them — a table of exemptions is only readable if what leaves it is
  visible — and §0.0's sentence about `jq` no longer sends the reader to a row
  that is not there.
- **`docs/design/release-signing.md` §2.1.** The production ceremony is a
  runbook for an offline operator machine and keeps its `<(...)`; the dev script
  it says it mirrors "step for step" no longer uses one. One sentence records
  that the difference is the container and not drift, and that the two write the
  same bytes. **`docs/zh/design/release-signing.md` has nothing to mirror**: it
  is a condensed rendering that carries neither the command block nor the
  step-for-step claim.
- **`docs/plan/PLAN-080.md`.** §5.5 gains a paragraph recording that B2 and B3
  closed and what the check reads now; §10's B2 and B3 bullets say CLOSED and
  name what is owed. The RESULT line §5.1 quotes is left as it was measured.

Observed and **not** changed, because it is pre-existing and unrelated:
`docs/zh/design/release-signing.md` §2 says the signer is 短有效期（2 年） where
the English and `pkgs/rauc/key-validity.env` say 45 days.

## 7. What was run

| Check | Result |
| --- | --- |
| `bash -n` on all four changed shell files | **green** |
| `bash tests/host-toolchain-lint.sh` | **green**, the RESULT in §4 |
| `make docs-verify` | **green** |
| Image-content probe of all seven `IMAGE_` pins for `openssl`/`jq` | six carry neither; `IMAGE_BUN_1` carries openssl 3.5.6 and no jq |
| trixie version probe behind the floors | `openssl 3.5.7-1~deb13u2`, `jq 1.7.1-6+deb13u3` |
