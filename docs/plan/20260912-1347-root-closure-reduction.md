# 20260912-1347-root-closure-reduction Reduce the read-only root closure

- **status**: draft
- **createdAt**: 2026-09-12 13:47
- **approvedAt**: (pending)
- **relatedTask**: 20260912-1347-root-closure-reduction

## Context

Source: [root-closure.md](../research/root-closure.md), a measurement report
taken at `677d326f` from the cx3576 dev root (radios and containers on). It
proposes six changes in its section 8. This plan re-measured the current tree
and checked each proposed change against the decisions recorded since, and
takes only the subset that is both still accurate and still authorized.

### Current measurement (x64, dev, containers on, no radios)

Read from `_out/x64/factory-root.oci` of the clean build at `a6b7b55c`
(source now `7742a596`; the pack path is unchanged: squashfs zstd-19 plus a
dm-verity hash tree). Compressed figures are `gzip -6` over the group's
bytes, the same conservative proxy the research uses.

| | |
|---|---|
| Composed root, unpacked | 200.4 MB, 2153 files, 11 selected mos packages |
| `rootfs-verity.img` as shipped | 71.2 MB |
| Whole root, gzip-6 proxy | 78.5 MB |

| Group | x64 unpacked | x64 gzip-6 | Research, cx3576 compressed |
|---|---:|---:|---:|
| podman family (7 executables) | 63.1 MB | 24.34 MB | 21.1 MB |
| five Rust binaries (`apid` 12.2, `mosd` 7.8, `mos-mqttd` 5.2, `mos-mqtt-broker` 4.9, `mos-deploy` 2.1) | 32.13 MB | 12.89 MB | 11.5 MB |
| `gconv` (255 objects) | 8.04 MB | 2.66 MB | 3.35 MB |
| `curl` + its exclusive library closure | 9.54 MB | 3.90 MB | ~1.7 MB (section 8) |
| `iproute2` + libtirpc/krb5/libdb chain | 6.96 MB | 2.83 MB | ~2.6 MB |
| openssh client programs | 4.83 MB | 2.07 MB | ~1.5 MB |
| `quota` + libext2fs | 1.25 MB | 0.54 MB | — |
| iptables family (12 files) | 0.56 MB | 0.21 MB | 0.53 MB |
| e2scrub (9 files) | 0.02 MB | 0.01 MB | — |
| package-manager residue | `/usr/bin/dpkg-realpath` only | — | seven paths |

The research's ranking survives: compressed bytes, not unpacked bytes, decide
the order, and the Rust binaries and `gconv` are the two largest items that
no standing decision excludes.

### Corrections to the research document

1. **Section 3.1, health gate.** `mos-health` does not degrade to SKIP when
   curl is absent. It tries curl, then wget, then fails with "neither curl nor
   wget is in this image". That was already true at `677d326f`. The
   conclusion (probe replacement and package removal are one change) stands;
   the failure mode is loud, not silent.
2. **Section 2.3, purge residue.** Six of the seven listed paths are gone from
   the current root; `/usr/bin/dpkg-realpath` remains. The finding is now
   only the by-name assertion in `package-manager-purge.sh`.
3. **Section 4, one workspace.** The five binaries span two workspaces.
   `mos-deploy` lives in `pkgs/mos-deploy/` with `lifecycle-sys`, and that
   workspace also produces the static `mos-init` and `mos-shutdown` that
   [20260911-1927](20260911-1927-boot-artifact-size.md) measures. The
   profile and multicall levers apply to the four `pkgs/mosd/` binaries
   (30.1 MB unpacked); `mos-deploy` is out of this plan.
4. **Section 4, "touches one repository".** The four binaries ship as four
   packages from two producers (`mosd` produces `mosd` and `mos-apid`;
   `mqtt` produces `mos-mqttd` and `mos-mqtt-broker`). A multicall binary
   crosses package boundaries and changes unit `Exec=` lines, the package
   graph, `rootfs/runtime/consumers.json` and the release-manifest package
   pins. It is not a one-repository change.
5. **Section 2.1, mechanism.** Since PLAN-086 S3 the shipped root is an
   explicit selection (`rootfs/runtime/select.py`). The hwdb precedent has
   two halves: `hwdb-remove.sh` deletes from the installed tree, and
   `select.py`'s `excluded()` refuses the same paths. A `gconv` exclusion
   needs both halves, not a pack-time delete alone.
6. **Authorization.** Section 8 items 3 (curl probe in Rust, drop the
   closure), 4 (host-key generation in Rust, drop `openssh-client`) and the
   iptables half of item 6 are the content of
   [PLAN-086](PLAN-086.md) S5, which the user declined on 2026-09-08 (not
   deferred, not owed) and reaffirmed on 2026-09-10: no general shell or
   network-tool reduction and no outbound-SSH removal. This plan excludes
   them; Alternatives records what reversing that decision would require.
7. **Section 7, network programming.** Out of this plan. The research's own
   acceptance criteria are kept in Alternatives for a separate plan.
8. **Section 8 item 1, "3–5 MB expected".** Still unmeasured. Measuring it is
   this plan's first step, and the multicall step is gated on the result.

## Proposal

Four steps. Each reports, at equal feature selection, before/after unpacked
bytes, the gzip-6 proxy and the shipped `rootfs-verity.img` size on x64;
virt-arm64 and cx3576 are re-measured when their builds exist.

**R1. Release profile for `pkgs/mosd/`.** Add to the workspace `Cargo.toml`:

```toml
[profile.release]
lto = "fat"
codegen-units = 1
```

Build once, record per-binary sizes. Then build a second variant with
`panic = "abort"` and record it separately, because that line is a behavior
change and not only a size change: a panicking task currently ends that task,
with `abort` it ends the daemon and systemd restarts it. Adopt `panic` only
if its measured saving is material and the behavior change is accepted
explicitly; the default outcome of R1 is the two-line profile.

**R2. Multicall measurement, not merge.** After R1, build one prototype
binary that links the four crates and dispatches on `argv[0]`, and measure
it. Do not change packaging in this plan. If the measured saving justifies
the changes in correction 4, open the packaging change as its own task with
that number in its description; if it does not, record the number and stop.

**R3. Exclude `gconv`.** Add `/usr/lib/<triplet>/gconv/` to
`select.py`'s `excluded()` set and add `gconv-remove.sh` beside
`hwdb-remove.sh` in `90-pack.Dockerfile`, recorded in
`transform-sources.sha256` the same way. Its assertions:

- the directory is gone from the packed root;
- the conversions glibc compiles in still resolve in the packed root
  (`iconv -f UTF-8 -t UTF-16`, `-t ASCII`, `-t UCS-4`);
- a legacy code page fails with a clear error (`-t ISO-8859-1`), which is
  the documented consequence: the image's locale is C.UTF-8 only.

The thirteen `iconv_open` users on x64 (`bash`, `printf`, `tar`, `cmp`,
`diff`, `diff3`, `sdiff`, `iconv`, libc, libglib, libidn2, libpsl,
libunistring) all convert to or from the locale charset; a guest smoke that
runs `printf` and `tar` on a UTF-8 name is the runtime half of the check.

**R4. Small decided removals.**

- e2scrub: exclude the five units, the timer, the udev rule, the two scripts
  and `/etc/e2scrub.conf` (which `consumers.json` currently retains). DATA is
  a plain ext4 partition without LVM, so `e2scrub_all` has nothing to act on;
  fsck at mount time is unchanged. Record the decision in the removal script.
- `package-manager-purge.sh`: remove `/usr/bin/dpkg-realpath` and assert by
  the package's remaining path list rather than by five binary names.

### Order and independence

R1 → R2 is sequential. R3 and R4 are independent of each other and of R1.
R3 and R4 touch `rootfs/runtime/` and `rootfs/scripts/`, which campaign B
(RFCT-336, S3/S6) owns; they are proposed as one small change coordinated
with that owner, not as a parallel rewrite.

### Verification

| Step | Checks |
|---|---|
| R1, R2 | `make os-rust-gate`; size table per binary; x64 rootfs rebuild; `make os-smoke-test`; for the `panic` variant also the apid API suite in QEMU |
| R3, R4 | x64 rootfs rebuild with `select.py verify`; `make os-rootfs-manifest-test`, `os-install-closure-gate`, `os-smoke-test`; the iconv assertions above; guest smoke; fixed-count assertions revised deliberately where they pin today's file counts |
| All | `make docs-verify`; before/after bytes recorded in the task |

## Risks

| Risk | Handling |
|---|---|
| `panic = "abort"` turns a task panic into a daemon restart | Measured as a separate variant; not adopted by default |
| Fat LTO with one codegen unit lengthens every mosd build, including the arm64 cross build | Accept if R1's saving is material; otherwise record and drop to `lto = "thin"` |
| A multicall changes four packages, units and consumer declarations | R2 measures only; packaging is a later task with the number in hand |
| `gconv` removal breaks a conversion something actually performs | Builtin conversions asserted at pack time; guest smoke on UTF-8 paths; legacy code pages are declared unsupported |
| Tests pin file or package counts that R3 and R4 change | Revise the assertion to the new count with the reason, never widen it |
| Reproducible packing | New scripts are hashed into `transform-sources.sha256` like the existing ones |
| Ownership race with campaign B on `rootfs/runtime/` | One coordinated change with RFCT-336's owner; no parallel edits |

## Scope

- `pkgs/mosd/Cargo.toml` (R1); a prototype crate under `pkgs/mosd/` for R2
  that is not packaged.
- `rootfs/runtime/select.py`, `rootfs/runtime/consumers.json`,
  `rootfs/scripts/gconv-remove.sh` (new), `rootfs/scripts/package-manager-purge.sh`,
  `rootfs/compose/90-pack.Dockerfile` (R3, R4).
- Tests for the new assertions; the affected fixed-count tests.
- This task and plan, `docs/changelog.md`, and a pointer in the research
  document.

Expected recovery on x64, gzip-6 proxy: R3 2.66 MB; R4 under 0.1 MB; R1 and
R2 unmeasured until R1 runs. Not in scope: podman, radios, the floor
(section 6), `mos-deploy`, and everything listed under Alternatives.

## Alternatives

**Section 8 as written, including the S5 items.** Blocked by the 2026-09-08
decision. If the user reverses it, each item would need:

| Item | x64 gzip-6 | What it takes |
|---|---:|---|
| curl probe in Rust, drop curl and its closure | 3.90 MB | the apid health-check mode PLAN-086's policy table already designs; drop the wget fallback with it; `mos-system` Depends edit |
| host-key generation in Rust, drop `openssh-client` and the sftp server | 2.07 MB | `ssh-key` crate work in `mos-seed-state`'s replacement; `mos-system` Depends edit; SSH/SFTP acceptance |
| drop the iptables family | 0.21 MB | `mos-system` Depends edit; reverses the "operator habit" rationale its control file records |
| `setquota` via `quotactl(2)` | 0.54 MB | a native data-layout step; `mos-system` Depends edit |

**Section 7, mosd programs the network.** Separate plan. Its acceptance
criteria, taken from the research: the WireGuard private key stops being
readable by a second unprivileged process, and deleting a virtual device stops
needing an `ip link del` shell-out. DHCP, RA and DHCPv6 stay with networkd.
A proposal that cannot show both criteria is not opened.

**Pack-time deletion only for `gconv`.** Rejected: `select.py`'s exclusion
set is the declared contract since S3, and the hwdb precedent uses both halves.

**Multicall first, profile later.** Rejected: the profile is a two-line
change with no packaging impact, and the multicall's value is the residual
after it.

## Annotations

- 2026-09-12: The user asked for the plan only. Implementation waits for
  explicit approval.
