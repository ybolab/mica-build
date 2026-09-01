# RFCT-277 Upstream package versions, an on-image manifest, and the radios producer split

- **priority**: P1
- **status**: completed
- **completedAt**: 2026-09-01 22:20
- **owner**: roy
- **plan**: [PLAN-041](../plan/PLAN-041.md)

## Goal

1. Packages that repack upstream software carry the upstream version
   (`mos-podman` 5.8.6+git…, `mos-rauc` 1.13+git…), not the workspace 0.1.0;
   first-party packages keep the workspace version. One git stamp still spans
   the pool.
2. The composed image ships `/usr/share/mos/manifest.tsv` listing every
   installed package and version, written before the package-manager purge,
   asserted by os/verify.
3. The `radios` producer splits into independent `wifi` and `bluetooth`
   producers, and `wifi` / `bluetooth` become individually declinable feature
   tokens; the umbrella `radios` token and `--radios` argument go away.

## Acceptance

- `make os-debs` produces a pool whose `manifest.txt` shows
  `mos-podman 5.8.6+git<commit>-1` and `mos-rauc 1.13+git<commit>-1` while
  every first-party package shows `0.1.0+git<commit>-1`; `deb-package-gate.sh`
  passes, and fails by mutation when two archives carry different git stamps.
- A composed x64 image verifies with the new manifest check green; the
  manifest lists the installed set with matching versions.
- `MOS_ROOTFS_WITHOUT="bluetooth"` resolves a set with mos-wifi and
  mos-wifi-ap and without mos-bluetooth, and vice versa; `--radios` is gone;
  producer discovery counts 11 producers and `deb-preflight-test.sh` passes.

## Notes

- mos-mqtt-broker is a workspace crate, not an upstream repack; it keeps the
  workspace version on purpose.
- Component pins inside mos-podman (crun, conmon, netavark, aardvark,
  catatonit) stay in `os/pkgs/podman/versions.env`; the deb version carries
  podman's number only.

## Completion

All three goals accepted on a composed x64 image at stamp
`gitbebde92afbe5.dirty-1`: pool shows `mos-podman 5.8.6+git…` and `mos-rauc
1.13+git…` beside first-party `0.1.0+git…` (gate 230/230; two-stamp mutation
red both per-pool and cross-pool); `/usr/share/mos/manifest.tsv` ships and
verifies (293/293, check `packed-mos-manifest`: 182 packages, 10 mos, one
stamp); `--without bluetooth` keeps Wi-Fi and vice versa, `--without radios`
refuses, producers count 11 (rootfs-manifest-test 36/36,
deb-preflight-test 25/25). See PLAN-041's Completion for the
`@SYSTEM_VERSION@` pin defect the acceptance run surfaced and fixed.
