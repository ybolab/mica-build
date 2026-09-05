# rauc-sign

Update trust tooling. This one crate carries both
halves of the TUF trust model because they share one metadata format:

- the **release side** (`rauc-sign`, phase 1): runs on a build host, never on a
  device, and its output is static content — a directory that any HTTP server
  or object store can serve unchanged;
- the **device side**: `rauc-verify` (phase 2, first half) verifies a
  LOCAL copy of that directory from the anchors baked into the image, with
  persistent rollback protection, and `rauc-update` (phase 2, second half) adds the
  transport on top of the same walk — compatibility selection from signed
  release metadata, resumable download into the `/mos/updates` DATA workspace
  (probed for readiness first), and the offline "lockbox" import. Both are
  exercised offline by the test suite
  and both are SHIPPED, as `mos-rauc-update` (see "Packaging" below), with
  the anchor they verify from baked beside them ("Trust anchors" below) and
  mosd as the thing that runs them (`docs/design/updates.md`).

## Contents

Three binaries, all from cargo's auto-discovery — there is no `[[bin]]` section,
so each binary's name is the thing that declares it:

- `rauc-sign` — the TUF signing tool (phase 1). Creates and
  maintains the static TUF repository that pins RAUC bundles, the release
  manifest beside them (`add --manifest`), and produces offline lockboxes
  (`lockbox`). Named by the package, with `src/main.rs`.
- `rauc-verify` — the device-side metadata and target verifier
  (phase 2 first half). Walks the metadata from the image's baked signing
  keys and prints a verified local target path for an installer to consume. Named by
  its own filename, `src/bin/rauc-verify.rs`.
- `rauc-update` — the device-side update client (phase 2 second half):
  `sync`/`check`/`fetch`/`import`, the section below. Named by its own
  filename, `src/bin/rauc-update.rs`.

One neighbour that is deliberately not here: delta needs no tooling — RAUC
adaptive updates work against the plain bundle over HTTP range requests.

## Phase-1 scope of `rauc-sign`

`rauc-sign` implements the repository half of the trust model on record: the four TUF top-level roles (`root`, `targets`, `snapshot`, `timestamp`),
a sign/verify roundtrip, and target metadata that pins each RAUC bundle's
sha256, length and dm-verity root hash.

Explicitly out of scope for the whole crate, still:

- the Uptane director/image repository split — this is a single image
  repository;
- delegated targets roles and hardware-backed key stores;
- transport on the **release** side: `rauc-sign` writes a directory; how it
  is served is the hosting decision `release-artifacts.md` records as open.
  (Device-side transport is now partly in scope: `rauc-update`, below.)
- mosd's install orchestration (RAUC install/confirm) — named as roadmap by
- RAUC's own CMS bundle signature, which is a separate key hierarchy applied
  by `rauc bundle` at build time.

The verity root hash is passed to `rauc-sign add` as an argument. The tool never
shells out to `rauc`, so it has no dependency on the image pipeline.

## The root ceremonies

`root.json` expires, and republishing it is two commands, not one, because it
is two ceremonies with different consequences:

- `rotate-root` hands the root role to a **new** key and revokes the outgoing
  one. The published `<n+1>.root.json` is signed by both keys — TUF's
  cross-sign — so a device pinned to the outgoing anchor walks itself forward
  to the new one with nothing shipped to it. The outgoing key is pruned from
  the new root's key list rather than left listed and unbound.
- `refresh-root` republishes with the **same** key at a later expiration. The
  trust anchor does not change hands, so there is nothing to distribute.

Rotating to the key that already holds the role is refused, and names
`refresh-root`; `refresh-root` cannot introduce a key. Neither ceremony is
reachable by mistyping the other.

Neither reads an online key: no top-level role's metadata pins `root.json`, so
`targets`, `snapshot` and `timestamp` keep their signatures and are refreshed
afterwards by `sign` on the release host. Both verify the anchor they are
handed before building on it, and both check the result the way a client will —
a threshold of the outgoing root's keys and a threshold of the new root's own —
before anything is written. Neither will overwrite an already-published
`<n>.root.json`.

The third ceremony is `rotate-online`: the recovery for a compromised or
retiring release host. It publishes the next root version with **fresh**
`targets`, `snapshot` and `timestamp` keys bound, revoking the outgoing ones —
and, unlike the root ceremonies, it re-signs the three online roles with the
incoming keys in the same run, because the existing metadata is signed by the
very keys being revoked and a repository left that way would be refused whole.
The root key does not change hands, so nothing is distributed to devices.
Rotating "to" a key the root already trusts is refused, as is rewriting a
published root version.

The operator-facing procedures — media, minutes, key disposition, distribution
— are sections 1.6 and 1.7 of `docs/design/release-signing.md`.

## Phase 2, first half: the device-side verifier

`rauc-verify` is the client the phase-1 attacker tests were modelled
against. It performs the TUF client walk over a local repository directory —
root chain from the earliest root a baked key authenticates, then
timestamp → snapshot → targets —
enforcing per-role signature thresholds, expiries, version pins, and metadata
hash/length pins, and refusing shapes the signer never produces (a root
missing one of the four roles, targets metadata with delegated roles).

On top of the walk it keeps the device's memory: a JSON state file recording
the highest verified version per role, written atomically (temp file, fsync,
rename, directory fsync). A validly signed but **older** repository is
rejected against that state, so rollback protection survives restarts. The
state file must live on persistent writable storage; a rejection never
advances it, and a corrupt state file is an error rather than a silent reset.

The interface is deliberately boring and scriptable — exit 0 means verified,
any other exit means not verified with a one-line reason on stderr:

```sh
# verify the metadata walk; records/enforces per-role versions in the state file
rauc-verify --repo <dir> --state <state.json>
# OK root v1 targets v2 snapshot v2 timestamp v2

# additionally verify one target's bytes (sha256 + length) and print its
# verified local path, ready to hand to an installer
rauc-verify --repo <dir> --state <state.json> --target update-1.0.0.raucb
# <dir>/targets/<sha256>.update-1.0.0.raucb
```

**There is no `--root`.** The trusted root is whichever repository root one of
the image's baked package signing keys authenticates; see *Trust anchors*
below.

The orchestration phase 2 used to owe is shipped: mosd runs this client and
RAUC from `/mos/config/updates.json` over the baked defaults
(`docs/design/updates.md` §2). What is still owed is image-side and listed
there: the `/var/lib/mos/update/` tree the client's defaults point at, and
`mos-health` reporting `health.boot`.

## Phase 2, second half: the update client

`rauc-update` is the transport and policy layer over the same verified walk —
it obtains a `Repository` only through the `client` module, so there is no
path from it to a bundle whose metadata and bytes were not verified first,
and no flag skips any of that. Four subcommands, same scriptable contract
(exit 0 = it happened; one-line stderr reason otherwise):

- `sync --url <base> --repo <dir>` mirrors the repository's **metadata** over
  plain HTTP into a local directory: the `<n>.root.json` chain, then
  timestamp → snapshot → targets by the version numbers the fetched documents
  name. The mirror is unverified input to the verified walk, never a
  substitute for it; every file is capped at 1 MiB, so a hostile mirror
  cannot buffer-exhaust the device before verification runs. A deployment
  can equally rsync the repository and skip `sync` entirely.
- `check --repo <dir> --state <state>` verifies from the baked anchors
  (advancing the same persistent rollback state `rauc-verify`
  keeps), then selects the newest target compatible with this device: board,
  profile, channel (`--channel`, default `stable`), manifest schema floor
  (equality with 1, the same rule the release gate holds), and version
  strictly newer than the running one. Every rejected candidate is printed
  with its reason; `none` exits 2 so a poll loop can tell "up to date" from
  "broken". A downgrade needs `--allow-downgrade` and is logged.
  The compatibility facts come from the **signed** custom block `rauc-sign
  add --manifest` stamps on the bundle target — no unsigned side channel.
- `probe --max-bytes <n>` is the PLAN-061 readiness probe of the
  `/mos/updates` workspace on its own: `/mos` is a real directory mounted on
  the same device as the DATA pool at `/mnt/data`, no symlink stands in for
  a workspace directory, nothing foreign is mounted inside, the pool is not
  read-only, a private `O_EXCL` file in `staging/` is written, fsynced and
  removed, and the pool's free space (one figure, stated once) covers what
  is unspent of the budget. Prints `ready ...` (exit 0) or
  `<status> <kind>: <detail>` (exit 3) — status `unavailable`
  (`mount-missing`, `not-data`) or `degraded` (`read-only`, `exhausted`,
  `probe-failed`). mosd runs it before every check and fetch.
- `fetch ... --url <base> --max-bytes <n>` runs the same probe (with the
  exact bytes still needed), then downloads the selected bundle with HTTP
  range requests: a `.part` file in `/mos/updates/downloads` resumes where
  it left off, the completed size may never exceed the byte budget together
  with what the workspace already holds, and the file is renamed — same
  filesystem, atomic — into `/mos/updates/verified` only when sha256 and
  length agree with the signed metadata; a mismatch deletes the partial. The
  last stdout line is the verified path; exit 3 is an unready workspace.
  `--reserve-dir` may name a subdirectory of `downloads/` and nothing else.
- `import --lockbox <dir> ...` is the offline path: the same selection and
  verification over a mounted lockbox directory, the same probe and budget,
  a copy through `/mos/updates/staging`, the same rename into `verified/`.

Device identity (board/profile/running version) comes from
`/usr/share/mos/release-identity.env` (`BOARD=`/`PROFILE=`/`VERSION=` lines)
or explicit `--board`/`--profile`/`--current-version` flags. The image
pipeline writes that file: `rootfs/compose/compose-install.sh` renders it
from the board, profile and pool version the composition was given. `VERSION`
is therefore the POOL version (`0.1.0+git<commit>-1`), which is what an image
build can measure about itself and not a release number —
`docs/design/release-signing.md` §3.1 states what that costs the
"newer than running" comparison.

The **workspace is a contract, not a flag** (`src/workspace.rs`): it is
`/mos/updates` on the DATA pool, laid out by the image's `mos-data-layout`,
and there is no fallback to STATE, `/var`, the rootfs or tmpfs — an unready
workspace is a named refusal before the first byte, never a write somewhere
else. The client holds its side — never exceed the budget, refuse what the
pool cannot hold, never leave a partial anywhere but `downloads/`, never put
anything but a digest-verified bundle in `verified/`, and hand `rauc install`
nothing else (`--install` checks its own output). How many bytes
`--max-bytes` may promise of the pool is a storage-policy decision owned
outside this crate. `RAUC_UPDATE_ROOT` relocates the whole workspace and
`RAUC_UPDATE_MOUNTINFO` substitutes a mount table for the test suite only.

HTTP is deliberately minimal: plain `http` only, `GET` only, no TLS, no
redirects, no chunked bodies, every operation timeout-bounded. Integrity and
authenticity come from the metadata walk (TUF's threat model assumes a
hostile mirror); what plain HTTP does not provide is confidentiality — a
deployment that needs it terminates TLS at a local proxy or syncs the
repository out of band. Growing a TLS stack here is a deliberate-dependency
decision recorded as **[not taken]**, not an oversight.

With `--install` the staged path is handed to `rauc install`. mosd's D-Bus
`InstallUpdate` is the orchestrated route (progress lands in mosd's live
state); calling it needs a bus client this crate deliberately does not carry,
so the operator command for that route is documented in
`docs/design/release-signing.md` instead.

## The offline lockbox

`rauc-sign lockbox --repo <repo> --out <dir> [--target NAME]...` produces the
USB/SD "lockbox": the complete `metadata/` set plus the named targets' files
(all targets when none is named; a named bundle brings its pinned manifest
along). The output is itself a repository directory, which is the point —
`rauc-update import` and `rauc-verify` walk it exactly as an online mirror,
baked anchors, rollback state and all. The metadata is carried verbatim (the
signing keys are not present and not wanted), so a partial lockbox still
lists every published target; `import` verifies exactly the target it
selects, and `rauc-sign verify` passes only on a full lockbox.

## Trust anchors

**Settled: the anchors are baked, inline, and there is no way to supply one.**
Both device binaries read `trust.signingKeys` — base64 ed25519 public keys —
from `/usr/share/mos/meta/updates/manifest.json`, a path `src/anchor.rs` pins
as a constant. *There is no environment, argument or operator-document anchor
override.* The `--root` flag both binaries used to carry is gone with the
`root.json` file it named: there is no separate anchor document to ship.

What the reader refuses, before it looks at any repository:

- a `trust` object carrying any key but `signingKeys` and `signingKeyIds` —
  *alternate anchors are refused*, by shape rather than by convention;
- an empty `signingKeys` — no package key is trusted, so nothing is;
- a `signingKeyIds` that is not the sha256 of the keys beside it, which is
  how a hand-written manifest fails the build rather than the device;
- a `/usr/share/mos/meta` or `/usr/share/mos/meta/updates` that is not a real
  directory, or a manifest that is not a regular file — an alternate anchor
  planted as a symbolic link is refused by name.

**Rotation needs no new flag.** The walk starts at the **earliest**
repository root one of the baked keys authenticates and lets `tough` verify
each rotation forward from there, so a freshly baked incoming key that only
signs later roots still bootstraps, and a device whose chain has moved on is
not stranded on the version it was built with.

**The tradeoff, stated rather than left as an inference.** The anchor is
exactly as trustworthy as the image that carries it, which is the strongest
binding available and also means the TUF hierarchy **cannot outlive a
compromise of the image signing path** — the two hierarchies stand or fall
together at provisioning time. They remain independent at *install* time,
which is the property worth having: forging a package still does not install
a system, because installation is gated by the RAUC CMS chain
(`docs/design/release-signing.md` §2.6).

**Baking is per build host, not per checkout.** `meta/` is gitignored, so a
deployment's anchors and its update server address are not reproducible from
a checkout; a build is reproducible only together with the `meta/` its build
host carried. `pkgs/rauc/gen-dev-keys.sh --domain updates` writes a
development-grade key and records the domain in `meta/GENERATED`; a build
that finds no key bakes an empty list and says so, and such an image can
verify no update package at all.

**The two alternatives, kept because they are still the alternatives for the
RAUC keyring** (`docs/design/release-signing.md` §2.3), which has the same
shape and no answer yet:

- **Provisioning file** on STATE/META, written at factory or first-boot
  provisioning **[not implemented]** — decouples the anchor from the image,
  allowing per-fleet or per-customer trust. Tradeoff: the provisioning flow
  becomes security-critical, the anchor lives on mutable storage (so it needs
  its own integrity story), and a device that loses STATE loses its anchor.
- **Signed USB import** **[not implemented]** — an operator carries the
  material on removable media; the device accepts it only if it chains from
  what is currently trusted, or on explicit physical-presence action for
  first provisioning. Tradeoff: first-time trust still has to come from
  somewhere, and the import path is an attack surface that must enforce the
  chain rule strictly.

The rest of the deployment story is closed: the binaries are in the image
(`mos-rauc-update`), the device identity file they default to
(`/usr/share/mos/release-identity.env`) is written by the composition, and
mosd drives them from `/mos/config/updates.json` over the baked defaults
(`docs/design/updates.md` §2).

## Repository layout produced

```text
<repo>/metadata/root.json         bootstrap copy of the highest <n>.root.json
<repo>/metadata/targets.json      alias of the highest <n>.targets.json
<repo>/metadata/snapshot.json     alias of the highest <n>.snapshot.json
<repo>/metadata/timestamp.json
<repo>/metadata/<n>.root.json     consistent-snapshot metadata
<repo>/metadata/<n>.targets.json
<repo>/metadata/<n>.snapshot.json
<repo>/targets/<sha256>.<name>    hash-prefixed target files
```

Consistent snapshots are on, so target files carry their sha256 as a filename
prefix, as TUF requires. The unversioned metadata aliases exist so a client can
be pointed at fixed URLs and so `root.json` can be shipped as the trusted root.

## Keys

Four ed25519 keys, one per role, stored as raw PKCS#8 documents named
`<role>.pk8`.

`root` is an **offline** key. It signs `root.json` at `init` time and at the
ceremonies that republish it (`rotate-root`, `refresh-root`); `add` and `sign`
only load the `targets`, `snapshot` and `timestamp` keys. The device side handles public material only: it reads
metadata and the baked `trust.signingKeys`, never a `.pk8`.

Generate throwaway development keys:

```sh
cargo run -p rauc-sign -- gen-dev-keys          # writes pkgs/rauc-sign/.devkeys/
cargo run -p rauc-sign -- gen-dev-keys --keys-dir <dir> --role root
```

`--role` is repeatable and defaults to all four. A rotation ceremony wants
`--role root` on its own, so no unused copy of an online key is written to the
media it will seal.

`pkgs/rauc-sign/.devkeys/` is gitignored and `gen-dev-keys` refuses to overwrite an
existing key. No key, certificate or seed is ever committed to this repository,
and the tests generate their own keys into a temporary directory at runtime.

## Usage

```sh
# one-time repository creation (needs the offline root key)
cargo run -p rauc-sign -- init \
  --repo _out/tuf \
  --root-expires 2027-01-01T00:00:00Z \
  --targets-expires 2027-01-01T00:00:00Z \
  --snapshot-expires 2026-11-01T00:00:00Z \
  --timestamp-expires 2026-09-01T00:00:00Z

# publish a release bundle (online keys only). --manifest pins the release
# manifest.json as its own target beside the bundle and stamps the signed
# board/profile/channel/version selection block the device client reads;
# it is refused if the manifest does not pin the bundle being published.
cargo run -p rauc-sign -- add \
  --repo _out/tuf \
  --target _out/cx3576/update-1.0.0.raucb \
  --verity-root-hash <64 hex chars from the RAUC bundle> \
  --release-version 1.0.0 \
  --manifest _out/cx3576/release/manifest.json \
  --targets-expires ... --snapshot-expires ... --timestamp-expires ...

# refresh timestamp/snapshot before they expire (online keys only)
cargo run -p rauc-sign -- sign --repo _out/tuf \
  --targets-expires ... --snapshot-expires ... --timestamp-expires ... [--timestamp-version N]

# hand the root role to a new key (offline key only; both keys sign the result)
cargo run -p rauc-sign -- rotate-root \
  --repo _out/tuf --keys-dir <current keys> --new-keys-dir <incoming key> \
  --root-expires 2028-01-01T00:00:00Z

# re-sign root at its annual expiry with the same key (offline key only)
cargo run -p rauc-sign -- refresh-root \
  --repo _out/tuf --keys-dir <current keys> --root-expires 2028-01-01T00:00:00Z

# revoke the online keys and bind fresh ones (offline root key + incoming
# online keys; re-signs targets/snapshot/timestamp with them in the same run)
cargo run -p rauc-sign -- rotate-online \
  --repo _out/tuf --keys-dir <root key dir> --new-keys-dir <incoming online keys> \
  --root-expires 2028-01-01T00:00:00Z \
  --targets-expires ... --snapshot-expires ... --timestamp-expires ...

# release-side offline verification against a trusted root
cargo run -p rauc-sign -- verify --repo _out/tuf --root <trusted root.json> [--datastore _out/tuf-trusted]

# device-side verification (baked anchors + persistent version state)
cargo run -p rauc-sign --bin rauc-verify -- \
  --repo _out/tuf --state _out/uptane-state.json \
  [--target update-1.0.0.raucb]

# produce an offline lockbox (no keys involved; static file copies)
cargo run -p rauc-sign -- lockbox --repo _out/tuf --out /media/usb/lockbox \
  [--target update-1.0.0.raucb]

# device-side update client: mirror metadata, select, download, import
cargo run -p rauc-sign --bin rauc-update -- sync \
  --url http://mirror.example/tuf --repo /var/lib/mos/tuf-mirror
cargo run -p rauc-sign --bin rauc-update -- check \
  --repo /var/lib/mos/tuf-mirror --state <state.json> \
  [--identity /usr/share/mos/release-identity.env | --board cx3576 --profile prod --current-version 1.0.0] \
  [--channel stable] [--allow-downgrade]
cargo run -p rauc-sign --bin rauc-update -- probe --max-bytes 500000000
cargo run -p rauc-sign --bin rauc-update -- fetch \
  --repo /var/lib/mos/tuf-mirror --state <state.json> \
  --url http://mirror.example/tuf --max-bytes 500000000 [--install]
cargo run -p rauc-sign --bin rauc-update -- import \
  --lockbox /media/usb/lockbox --state <state.json> \
  --max-bytes 500000000 [--install]
```

All expiration instants are explicit RFC 3339 arguments. Nothing derives an
expiration from the wall clock, so a release is reproducible and tests are
deterministic. `--root-expires` is on `init` and on the two root ceremonies, and nowhere else,
because `root.json` is the one role the online path never re-signs. `rauc-sign verify --datastore` persists
the last trusted metadata for the release side; the device side's equivalent is
the mandatory `--state` file.

## Packaging

The device half of this crate ships as one Debian package, `mos-rauc-update`,
built by the producer at `pkgs/rauc-sign/deb/rauc-update/`:

```
make os-deb-rauc-update
  -> bash build-env/deb/build.sh --producer rauc-update --arch <amd64|arm64>
  -> _out/debs/<arch>/pool/mos-rauc-update_<version>_<arch>.deb
```

`/usr/bin/rauc-update` and `/usr/bin/rauc-verify`, and nothing else. It ships
no unit, because nothing on a device schedules this client yet, and no
maintainer script: the identity file it reads is written by the composition,
not by dpkg.

**`rauc-sign` is not in it, and that is asserted rather than intended.** The
producer's `PREPARE` hook (`hack/build-deb.sh`) compiles with `--bin
rauc-update --bin rauc-verify` into a producer-private `CARGO_TARGET_DIR` and
then fails by name if a `rauc-sign` binary is anywhere in that directory. The
signing tool loads the offline root key; a device that carried it would carry
the one program whose whole purpose is to make metadata devices trust.

The version is the pool's — `<crate version>+git<commit>[.dirty]-1`, from
`build-env/deb/version.sh`, the one rule every producer in this repository
asks for. This is a first-party package, so it declares no `VERSION_FROM`;
the upstream repacks beside it (`mos-rauc`, `mos-podman`) are the case that
key exists for.

`rootfs/packages/feature-rauc.pkgs` names the package alongside `mos-rauc`,
so both boards install it and `MOS_ROOTFS_WITHOUT=rauc` declines the client
with the installer it feeds. `verify`'s `packed-update-client` and
`packed-release-identity` checks are what refuse an image missing either
half.

## Checks

This crate is **its own cargo workspace**, so `pkgs/mosd/hack/check.sh` does not
cover it — that script's `--workspace` flags stop at the mosd members. The gate
for this code is its twin, next to the crate:

```sh
bash pkgs/rauc-sign/hack/check.sh
```

Same five checks in the same order, against this workspace's own `Cargo.lock`
and `deny.toml`. `.github/workflows/check.yml` runs both scripts, and the
second one is the only thing on that job that checks this code.

The update client has its own suite (`tests/update.rs`), against the same
fixture plus a loopback static HTTP server with range support (and a
variant that drops the connection mid-body) and a workspace laid out in the
tempdir whose mount table is a fixture file: manifest publication and the
signed selection block, selection across every compatibility axis (board,
profile, channel, schema floor, version — each rejection with a
discriminating reason), downgrade admission only under the explicit flag,
the workspace contract (the production default, every reserve directory
outside `downloads/` refused, every unready kind and its status named by
the probe — missing namespace, unmounted, missing pool, missing directory,
tmpfs, rootfs and STATE devices, symlinked namespace and directory, foreign
mount, read-only bind/superblock/pool, spent budget, insufficient free
space, unreadable mount table — an unready workspace refusing `fetch` and
`import` before any request, an interrupted download leaving only its
`.part` and never anything in `verified/`, and `installable` admitting only
a verified regular file), resumable download (fresh, resumed with a real
range request, idempotent re-fetch), the byte budget (too-small budget,
budget already spent), digest refusal with partial deletion (corrupted
partial, tampered bundle), metadata sync including the per-file cap, the
lockbox round trip (full lockbox verifies whole; partial lockbox imports its
selected target through `staging/`; tampered lockbox refused), and the
binary's exit-code contract (`probe`/`fetch` exit 3 with the verdict line).

The device-side verifier is tested against the same in-repo fixture the signer
tests use (`pkgs/rauc-sign/tests/`): the honest publish sequence verifies, and
a published rollback, a tampered target, a tampered-metadata edit, expired
metadata (timestamp and root alike), an unmet root threshold, a complete
repository authored with foreign keys, a trusted root missing one of the four
roles, and targets metadata carrying a (fully resolvable, validly signed)
delegation are each rejected.

The root ceremonies have their own suite, not split along the signer/device
line, because the property being tested is that a device pinned to the
*outgoing* anchor reaches the incoming one — which the signer half alone proves
nothing about. Both directions of the overlap window, releases published after
a rotation verifying from either anchor, and seven refusals: a rotation the
outgoing key did not sign (accepted by the new anchor, refused by the old), a
broken outgoing signature, a withdrawn rotation as a root rollback across a
restart, rotating to the incumbent key, rewriting a published root version,
rotating from an anchor its own keys do not sign, and either ceremony run with
the wrong outgoing key. The online-key rotation has its own suite
(`tests/online_rotation.rs`) with the same shape: the anchor still reaches the
rotated repository and the release host publishes with the incoming keys,
while the revoked keys can neither publish through the signer nor forge a
timestamp a client accepts, and rotating to an incumbent online key is
refused.
