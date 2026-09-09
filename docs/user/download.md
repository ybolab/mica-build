# Obtaining and identifying an image

Build the current system from source or obtain a complete image from your
integrator. This repository does not provide a hosted public download service.

## 1. Choose the target

Current system-image targets are `x64`, `virt-arm64` and `cx3576`. Artifacts name
an exact board and architecture. The userspace profile (`dev` or `prod`) is
recorded in the verified root. All current acceptance starts from a complete
latest factory image; there is no old-layout installation or migration path.

> status: shipped — evidence: `boards/x64/board.env`, `boards/virt-arm64/board.env`, `boards/cx3576/board.env`, `build/src/file-layout.ts`

## 2. Keep the artifact set together

| Artifact | Purpose |
|---|---|
| `disk.img` | Complete factory image with two authenticated deployment records |
| Signed deployment envelope | Exact board, generation, kernel and root association |
| Kernel package | Signed UKI/FIT and verity-protected matching support data |
| Root component | Userspace image, verity geometry and detached root-hash signature |
| Firmware package | Independently signed maintenance artifact |
| `.mosupd` archive | Bounded offline deployment update, containing required objects |

The disk image and offline update have different purposes. Flash the complete
image for current development acceptance. A signed update changes the named
components of an already running current system. It never installs loader
firmware through the ordinary OS update action.

> status: shipped — evidence: `build/src/component-cli.ts`, `build/src/file-image.ts`, `build/src/component-archive.ts`

## 3. Build and verify

Follow [quickstart](quickstart.md) and [the build guide](../design/build.md).
Offline verification requires the complete image and the trusted metadata public
key file; obtain the key independently of an untrusted download.

```sh
bash verify/run.sh --verify --board x64 \
  --image /path/to/image/disk.img --public-key /path/to/metadata-public.key
```

Verification authenticates the signed records and checks referenced content,
geometry, firmware receipt and root policy. Boot acceptance separately proves
UEFI/FIT enforcement with the selected boot anchor. A checksum downloaded beside
an image alone does not establish authenticity.

> status: shipped — evidence: `verify/src/file-image.ts`, `verify/run.sh`, `docs/design/release-signing.md`

## 4. Publication and evidence

The update server accepts independent component objects and signed release
metadata, validates publication and serves the selected channel. Its firmware
maintenance artifact flow is separate. A running server and its actual catalog
are operator-managed; no public hosting is implied by these tools.

Keep the package manifest, BSP build identity, component digests, source commit,
release notes and exact verification logs with a delivered image. Physical board
claims require corresponding hardware evidence. See
[release identification](release-notes.md) and [release artifacts](../design/release-artifacts.md).

> status: shipped — evidence: `update-server/src`, `docs/design/updates.md`
