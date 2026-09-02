# Page brief: Downloads

- **Purpose**: let a visitor select a release, then the image for their board
  and profile, and know how to verify what they downloaded — without the site
  ever hand-maintaining a release table.
- **Audience**: integrators fetching an image to flash; support engineers
  re-downloading a specific release named in a case.
- **Navigation position**: page 3. Links to
  [supported hardware](hardware.md) for board compatibility,
  [security](security.md) for the trust chain behind the signatures, and the
  user guides [../user/download.md](../user/download.md) and
  [../user/install.md](../user/install.md) for the procedure itself.

## Content outline

1. How selection works: release → board → profile.
2. What a release contains: the artifact kinds and their naming facts.
3. Verification: what the visitor checks, and against what.
4. The release list itself — rendered from release facts, never typed.

## Draft copy

### Selecting a download

A download is identified by three choices: the **release** (a version on a
release channel), the **board** (each release ships one image per supported
board — see [supported hardware](hardware.md)), and the **profile** —
`dev` or `prod`, baked into the image at build time; a production device
cannot be edited into a development one.

> status: shipped — evidence: `docs/design/access.md`, `rootfs/packages-src/profile`

### What a release contains

For each board, a release build produces a whole-disk image for initial
flashing and a signed RAUC bundle for A/B updates of already-fielded devices.
Both are produced by the repository's build; the bundle carries the release
version in its name.

> status: shipped — evidence: `make os-image-cx3576`, `make os-bundle-cx3576`, `docs/design/build.md`

The downloads page must state these artifact facts per entry: exact artifact
filename, board, profile, release version and channel, size, digest, and the
signature material a client verifies against. It must not invent any of them.

### Verification

A mos release is signed twice, by two unrelated key hierarchies: TUF metadata
pins the bundle's digest, length and verity root hash, and a CMS signature
over the bundle itself is what the device verifies at install time. The
host-side tooling to sign and verify a published repository ships in this
repository today.

> status: shipped — evidence: `pkgs/rauc-sign/`, `docs/design/release-signing.md`

The page links each release's public trust anchor and shows the verification
command; it never asks the visitor to trust a bare checksum typed into HTML.

### The release list

**This brief deliberately contains no release list.** The machine-readable
release manifest the list would be rendered from now exists: it binds the
version, the channel (`development`, `candidate`, `stable`), the board and
profile, the source commit and every artifact's size and digest, and a
publication gate refuses a release directory that does not match it. The site
regenerates from those facts, per the [content contract](contract.md), and
never from hand-typed prose.

> status: shipped — evidence: `docs/design/release-artifacts.md`, `make os-release-gate`

What is still missing is anywhere to point at. No release is published and no
channel is hosted, so there is nothing to list; support windows have a written
policy and no mechanism binding one to a release. A list rendered today would
be fabricated, which is why this brief has none.

> status: unsupported

Until then, the downloads page states plainly that releases are not yet
published and points evaluators at the build documentation
([../design/build.md](../design/build.md)) to produce a development image from
source.
