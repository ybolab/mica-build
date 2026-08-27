# RFCT-139 No production RAUC keyring is provisioned, so rauc install fails closed on every shipped device

- **status**: in progress
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-26

`os/update/rauc/system.conf.in:71-78` points RAUC's CMS keyring at
`/etc/rauc/keyring.pem` and states what is there instead: *"Production keyring
provisioning is out of scope here; until one is installed, `rauc install` on
device fails closed."* The development keyring is deliberately not in git, and
`os/rootfs/overlay-v2/etc/rauc/keyring.pem` is gitignored, so a built image
ships no keyring at all.

The image verifier agrees and asserts the absence rather than the presence:
`packed-no-dev-keyring` (`os/verify/src/checks-root.ts:629-633`) exists to
catch a development keyring baked into the signed root, because a keyring
inside the read-only root is a trusted signer on every device.

Everything downstream of that is complete. `mosd/mosd/src/rauc.rs` wraps
RAUC's D-Bus API, `InstallUpdate` is served on the bus
(`mosd/mosd/src/bus.rs:654`), path validation and lifecycle recording are
tested (`bus.rs:899`, `:930`, `:983`). The one missing piece is the key
material, and it is the piece that decides who may sign an update for a
customer device — a product decision about key custody and rotation, not a
code change.

Until it exists, on-device update cannot be accepted as working, and any plan
that schedules it as unblocked is wrong about its prerequisites.
