# RFCT-139 No production RAUC keyring is provisioned, so rauc install fails closed on every shipped device

- **status**: completed
- **priority**: P2
- **owner**: bkd/nlijystw
- **createdAt**: 2026-08-26
- **completedAt**: 2026-08-27

`os/pkgs/rauc/system.conf.in`'s `[keyring]` section points RAUC's CMS keyring
at `/etc/rauc/keyring.pem` and states what is there instead: *"Production keyring
provisioning is out of scope here; until one is installed, `rauc install` on
device fails closed."* (`os/pkgs/rauc/system.conf.in:82-83`) The development keyring is deliberately not in git, and
`os/rootfs/overlay-v2/etc/rauc/keyring.pem` is gitignored, so a built image
ships no keyring at all.

The image verifier agrees and asserts the absence rather than the presence:
`packed-no-dev-keyring` (`os/verify/src/checks-root.ts:601-620`) exists to
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

## Resolution

**Decided: document the provisioning path and its testable halves; change no
behaviour.** `rauc install` keeps failing closed on a shipped device, exactly
as designed. The key-custody and rotation decision — who signs, who holds the
CA, which channel delivers the keyring — is recorded as the user's open
product decision, not resolved here.

(a) The provisioning path is now documented in the two places that own it:

- `os/pkgs/rauc/system.conf.in` `[keyring]` comment (rendered to the shipped
  `/etc/rauc/system.conf`), directly extending the existing "fails closed"
  statement: what RAUC reads is the `path=` below; `/etc` is a read-only
  squashfs, so a production keyring must arrive through a provisioning
  channel and persist on STATE/META, reaching `/etc/rauc/keyring.pem` the
  way `/etc/ssh` does (seed + bind mount, `mos-seed-state`); no such bind or
  channel exists yet, deliberately.
- `docs/design/release-signing.md` section 2.3 — the design doc that owns
  updates' trust chain (named per the subtask spec): a new "what is pinned
  down today" block records the settled read path, the survival-across-
  updates mechanism a future channel must use, and the open decision stated
  as the user's, with the same candidate channels as the TUF root anchor.

(b) Testability: the absence assertion `packed-no-dev-keyring`
(`os/verify/src/checks-root.ts:601-621`) is untouched, and its complement
already exists — `rauc-keyring-path` (`os/verify/src/checks-rauc.ts:201`)
asserts the rendered system.conf reads exactly `/etc/rauc/keyring.pem`, so a
keyring provisioned at the documented path is what RAUC reads, by
configuration, provable per image build. No new check was added because the
pair already covers both directions; `os/verify/src` is unmodified. The one
step beyond configuration — a booted device's `rauc install` accepting a
production-signed bundle against a provisioned keyring — genuinely needs a
booted device with provisioned key material, and is left
documented-but-untested, stated as such in both documents.

Check evidence: `bash os/pkgs/rauc/render-config.sh --check` green after the
comment edits (config renders and matches); `bash docs/verify-citations.sh`
905/905 and `bash docs/verify-index.sh` 525/525 green. Two pre-existing
quoted citations into `system.conf.in` (`docs/design/api.md:3444`,
`docs/design/dashboard.md:834`) were renumbered because this task's and
RFCT-142's comment insertions shifted the cited lines — line numbers only,
no text changed.
