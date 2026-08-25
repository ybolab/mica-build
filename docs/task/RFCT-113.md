# RFCT-113 PLAN-014 M7: built artifacts smoke-run on the base rootfs

- **status**: pending
- **priority**: P1
- **owner**: -
- **createdAt**: 2026-08-25 10:50
- **plan**: PLAN-014 (M7)

Close the gap between "it linked" and "it runs": every self-built binary is
executed inside the base rootfs before an image ships it, and the version it
reports must equal the pin in `versions.env`.

## Scope

- The base stage exports an OCI image of the factory root (arm64 via the
  same binfmt/qemu-user path the rootfs build already uses).
- Smoke runner (TS, in `os/verify/`): for mosd, apid, mos-mqttd,
  mos-mqtt-broker, rauc, podman, quadlet, crun, conmon, netavark,
  aardvark-dns — minimal invocation inside that image, assert exit 0 and
  reported version == the recorded pin. catatonit (static, no --version
  contract) gets an exec-only check.
- Explicitly a smoke test: execution + version identity, not behaviour.
  QEMU boot tests keep functional coverage; ldd/NEEDED checks stay where
  they are.

## Acceptance

- A deliberately wrong-arch binary, a missing-soname binary, and a
  version-skewed binary each fail the build (three negative tests).
- The full artifact list above passes on both boards' base roots.
- The version loop is closed: bumping a `versions.env` pin without
  rebuilding the artifact turns the smoke run red.

## Dependencies

- After RFCT-108 (pinned environments) and RFCT-111 (the base stage that
  exports the factory root).
