# Releases and obtaining an image

This page covers what a mos release consists of, how to choose one for a
board, and how to obtain the artifacts. The honest headline first: **there is
no hosted download service today.** A release is built from this repository —
by you, or by the integrator who ships your product — and the roadmap for
published releases, channels and download metadata is a plan, not a shipped
service.

## 1. What a release consists of

A board build produces three artifacts under `_out/<board>/`:

| Artifact | What it is |
|---|---|
| `<board>-mos-<epoch>.img` (and a `<board>-mos-latest.img` symlink) | the whole-disk A/B image to flash onto a new device |
| `rootfs-verity.img` + `rootfs-verity.env` | one rootfs slot — squashfs with its dm-verity hash tree — and the parameters that identify it |
| the RAUC bundle (`.raucb`) | the signed update for a device already running mos |

The dm-verity root hash in `rootfs-verity.env` is the identity of a release's
root filesystem: two builds with the same hash carry the same bytes. The full
package inventory of an image ships inside it at `/usr/share/mos/manifest.tsv`,
with per-package versions and the source tree's git stamp.

> status: shipped — evidence: `docs/design/build.md`, `rootfs/compose/90-pack.Dockerfile`

## 2. Choosing a release

Three axes select an artifact:

- **Board.** An image is built for exactly one board and does not boot on
  another. Two boards exist: `cx3576` (CX3576-Z, Rockchip RK3576, arm64) and
  `x64` (generic UEFI x86_64, the QEMU and CI baseline). Supported hardware
  and its standing are described in [support.md](support.md) and on the
  hardware page at [../website/hardware.md](../website/hardware.md).
- **Profile.** `dev` or `prod`, selected at build time and written immutably
  into the image. Both profiles ship SSH off by default; the profile is
  recorded inside the verity root so a production device cannot be edited into
  a development one.
- **Version.** Images are named by build epoch; update bundles carry the
  version string given at build time. See
  [release-notes.md](release-notes.md) for how a release is identified.

> status: board-dependent — evidence: `boards/cx3576/board.env`, `boards/x64/board.env`, `rootfs/packages-src/profile`

## 3. Obtaining an image today: build it

The supported acquisition path is a source build. The build runs entirely in
docker, refuses stale inputs by name, and is documented end to end — the x64
sequence in [quickstart.md](quickstart.md), the cx3576 sequence (which
cross-compiles on an amd64 host with no host-level emulation) in the build
guide.

```sh
# cx3576, end to end — see docs/design/build.md for each step's role
MOS_BUILD_PLATFORM=linux/arm64 bash build-env/build.sh
make cx3576-uboot cx3576-uboot-mos
make cx3576-kernel
make os-debs
bash rootfs/build.sh
bash build/run.sh --mkimage-cx3576
make os-verify-cx3576
```

If you are an end customer of a product built on mos, your image comes from
your product integrator, not from this repository; the integrator's release
process owns which mos release you receive.

> status: shipped — evidence: `make os-image-cx3576`, `docs/design/build.md`

## 4. Verifying what you have

For an update bundle, the verification chain is real and usable today on the
host side: a bundle is CMS-signed and verified against a keyring at install
time, and the TUF tooling (`rauc-sign verify`, against a trust anchor held out
of band) verifies published repository metadata. The signing runbook — key
ceremonies, custody, rotation — is `../design/release-signing.md`.

What does not exist yet: per-artifact checksum and signature files published
alongside images, a machine-readable release manifest naming compatibility and
digests, SBOMs, or a download channel to fetch any of it from. Until that
lands, the trustworthy statement is narrower: an image you built yourself is
exactly what your tree produced, and `make os-verify-cx3576` (or
`bash verify/run.sh --verify --board x64`) checks the assembled image against
the image contract, check by check.

> status: shipped — evidence: `pkgs/rauc-sign/README.md`, `make os-verify-cx3576`

## 5. Published releases, channels and download metadata

The plan for release identity covers: one signed machine-readable release
manifest per release (version, channel, board/profile compatibility, artifact
digests and sizes, build and source identity), per-artifact checksums and
signatures, SPDX/CycloneDX SBOM and source-offer inventory, and a
development/candidate/stable promotion flow with publication gates. The
downloads page brief for the official site is
[../website/downloads.md](../website/downloads.md).

> status: proposed — evidence: `docs/plan/PLAN-043.md`

TODO(PLAN-043): revisit after this plan merges
