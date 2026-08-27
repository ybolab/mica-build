# RFCT-083 Close the second repository audit: trust-chain gaps, inverted crash-safety ordering, and the half-fixed patch-loop bug

- **status**: completed — 30 findings fixed across 56 files, three recorded as no-action, seven named as roadmap
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-21 06:10
- **claimedAt**: 2026-08-21 06:10
- **completedAt**: 2026-08-21 08:20

Base `a9c25c3` (RFCT-082's commit).

This is the remediation half of the second whole-repository audit, run against
`1b5d796` with four parallel reviewers plus live gate measurement. Every item
below is an audit finding, not a plan step. One P1 finding — the newer-schema
rollback crash loop — was fixed independently by RFCT-082 while the audit was
still running, and is not re-fixed here.

## What the audit measured before anything changed

`mosd/hack/check.sh` green (fmt, clippy `-D warnings`, nextest 383, cargo
deny); the five offline suites green (docs-verify 276, docs-verify-test,
os-health-test 54, os-shadow-test 220, os-ui-location-test 8);
`os-dbus-policy-test` blocked (host lacks dbus-daemon), `os-repart-test`
blocked (needs a built image), and `mkimage-v2-selftest` failing **for a
reason that was itself a finding** — its assertion phase ignored the
container fallback its assembly phase already had.

## The P1 findings, and what closed them

**Dev RAUC keyring bake-in.** The documented local-dev flow drops the dev CA
into the overlay; `build-v2.sh` staged it unconditionally, and
`verify-image-v2.sh` asserted only the config path while its PASS text
claimed the keyring "is deliberately not shipped". A prod-profile image built
on any workstation that ever ran the dev flow shipped an unprotected dev CA
as its trusted update signer, all checks green. Now: the build refuses to
stage `etc/rauc/keyring.pem` and the verifier FAILs on it in the packed root,
both waivable only by `MOS_EXPECT_DEV_KEYRING=1` with an unmissable warning;
the ui-location harness proves both directions (17/17).

**The kernel patch loop could half-apply silently** — the exact bug 1ccac4e
fixed for U-Boot, unfixed in `kernel/Dockerfile`: a `for` loop's status is
its last iteration's, `ls 2>/dev/null` made an empty patch directory apply
zero patches green, and `patch` leaves partial hunks besides. Now strict
mode, an exact patch-count assertion, and a compiled-tree marker grep per
patch (mirroring the U-Boot `case BOOT_LOADER:` shape).

**The apid login guard was bypassable under concurrency, and argon2 ran on
the async workers.** Check and record were two lock acquisitions with the
verification between them, so N parallel submissions shared one backoff
window; the verify itself pinned a runtime worker per attempt.
`LoginGuard::begin_attempt` now charges the attempt at admission under one
lock, `confirm_failure` re-arms the window from the outcome so verification
time does not eat the wait, and both argon2 operations run on
`spawn_blocking`. api.md §1.4 — which still described the pre-RFCT-081 flat
five/30s rule — now describes the curve that ships.

## The P2/P3 findings, by area

| area | fixed |
| --- | --- |
| `mosd/mosd/src/transient.rs` | marker written FIRST (the old order manufactured exactly the "changed shadow, no marker = password that never expires" state its own comment names); parent-directory fsync after rename; bus writes serialized under the service lock with bcrypt on `spawn_blocking` |
| `mosd/mosd/src/reconciler/network.rs` | iface names and static address/gateway/DNS validated before rendering (path escape and newline injection now structurally impossible); the sweep anchored to its own `50-mos-*` namespace so an iface like `a-mos-b` cannot make it eat a wifi unit |
| `mosd/mosd/src/reconciler/sshd.rs` | `ListenAddress` values must parse as addresses before they reach the drop-in |
| `mosd/mosd/src/reconciler/wifi_ap.rs` | subtree widened to `wifi`: a `wifi.client` write now re-runs the conflict check, so the conflict is reported when it appears and cleared when it resolves, not at the next `apply_all` |
| `mosd/mosd/src/reconciler/wifi_client.rs` | passphrases outside WPA2's 8..=63 rejected before wpa_supplicant would refuse the whole config file while the state said `applied` |
| `mosd/mosd/src/bus.rs` | `ReportHealth` capped (component/status/detail lengths, 128 components) — the one unbounded write surface into daemon RAM |
| `mosd/mosd/src/identity.rs` | `read_ap_psk`'s stale allow removed (it has a caller); `read_device_password` moved behind `#[cfg(test)]` — its only readers are provisioning tests |
| `mosd/dist/*.service` | both root daemons sandboxed (NoNewPrivileges, Protect*, MemoryDenyWriteExecute, RestrictAddressFamilies, …) and ordered after their STATE mount with `RequiresMountsFor` |
| `mosd/apid/src/session.rs`, `routes.rs` | lock poisoning recovered instead of propagated — one panic while holding the guard/session lock must not become a permanent panic on every later login |
| `mosd/apid/src/assets/serve.rs` | 32 MiB per-asset serving ceiling: bundle install validates entry types, not sizes, and assets are read whole per request |
| `os/bundle.sh` | caller CERT/KEY/KEYRING finally win (the "point CERT/KEY at real ones" message was false — both branches hardcoded `.devkeys`, so no production bundle was buildable); mkimage-v2's verity cross-checks ported, tying the shipped `mos-verity-{a,b}.env` to the shipped `rootfs.img`; the stale unsuffixed-env rollback comment rewritten |
| `os/rootfs/…/mos-seed-state` | run-once stamp replaced by convergent every-boot seeding (`cp -an`/`mkdir -p`): a later image's new STATE directory now seeds on fielded devices instead of being silently absent |
| ROOT_PASSWORD on v2 | the pack assertion always rejected it, so the advertised flow was unbuildable; plumbing removed, and four prose sites (README, access.md, ro-root.md, reconciler comments) now describe the real dev story: transient password via mosd, serial console with locked root |
| `os/boot/cx3576-boot.cmd` | the watchdog `saveenv` failure is loud (an unpersisted decrement is boot-forever); handshake doc §5.3 kept in sync |
| error-path diagnostics | three sites where `set -e`/pipefail killed the script before its written message fired (`build-v2.sh` grow_defs, `render-config.sh` line count, `mkimage-v2.sh` sgdisk verify) restructured so the diagnostics actually print |
| `os/mkimage-v2-selftest.sh` | assertion-phase tools fall back to the same container the assembly already used — the suite now passes on a tool-less host (166/166 here) instead of emitting misleading FAILs |
| `os/repart-loader-test.sh` | loop devices detached by trap on the failure path (they are host-global under `--privileged`) |
| repart.d comments | "Seven partitions" corrected to eight, positional numbers restated against the real post-loader layout — in files whose whole function is positional matching |
| `board/cx3576/uboot/Dockerfile` | the two env-placement symbols the A/B env depends on added to the assertion loop (names `[V]`-verified in uboot-ab-handshake.md); `BOOTDELAY`/`SYS_BOOTM_LEN` greps anchored; patch count asserted |
| `board/` prose + Makefile | dead `*.ppm` exclusion removed; `sha256sum` preferred over `shasum`; board.yaml/x64/extensions no longer claim retired Talos consumers, and the root README no longer claims board.yaml is consumed |
| `.gitea/workflows/check.yml` | first-run robustness: `--component` repeated, cargo-deny 0.19.5 + nextest 0.9.133 pinned as prebuilt binaries with measured sha256s, fail-loud dependency step, concurrency group, push restricted to main, the not-covered disclosure extended to the board targets |
| root `Makefile` | the invalid `.PHONY` pattern entry removed |
| `update/sign` | `verify` requires an explicit `--root` (self-verification proves only internal consistency); explicit lower snapshot/timestamp versions need `--allow-rollback`; a threshold above the role's key count is rejected |
| `os/layout/cx3576-v2.env` dead constants | left in place — see no-action below |

## Recorded as no-action

- **bootdev-order is asserted textually**; binding the `mmc0` alias to the
  eMMC controller needs hardware. A comment at both assertions says so.
- **v1's ROOT_PASSWORD via `--build-arg`** (process-listing visibility):
  v1 is the retiring dev image; not worth a BuildKit-secret rework.
- **`IMAGE_HEAD_MIB` / `BOOT_CMD_SOURCE`** in `cx3576-v2.env`: consumer-less
  but load-bearing as documentation of the layout head and the boot.cmd
  source; deleting them buys nothing and the file is measured by tests.

## Roadmap (out of scope here, in audit order of value)

Device-side Uptane client and trust-anchor provisioning; a mosd
update-orchestration module (RAUC install/confirm, `Reboot` aware of an
unconfirmed slot); brute-force counter persistence to META (access.md §6);
an audit-log subsystem; the automated U-Boot credit-exhaustion/rollback
harness; CI privileged-runner suites (image assembly/verify, repart, dbus);
a production key ceremony for bundle signing — the tooling now accepts real
keys, owning them is an operational act.

## Verification, after

`mosd/hack/check.sh` ALL CHECKS PASSED (400 tests, including the new guard,
validation, and psk suites); `cargo test` in `update/sign` 7/7;
`docs-verify` 276/276, `docs-verify-test`, `os-health-test` 54/54,
`os-shadow-test` 220/220, `os-ui-location-test` 17/17 (two new keyring
cases); `TMPDIR=_out/tmp mkimage-v2-selftest` 166/166 PASS on a host with no
sgdisk/mtools — the condition that used to produce the misleading FAILs.
Runtime-unverified, stated plainly: the kernel/U-Boot image builds (hours,
cross toolchains), the hardened units on a booted image, and check.yml's
first run on a real Gitea runner.
