# RFCT-206 PLAN-022 M7: kernel fragment and on-image proof

- **status**: completed
- **priority**: P1
- **owner**: bkd/r2pouxx6
- **createdAt**: 2026-08-28
- **claimedAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-022 (M7)
- **design**: RFCT-200 section 5 (the per-board kernel deltas), section 8's M7 cut; PLAN-022 Amendment 1 as amended (the `networkd-secrets` path correction RFCT-204 forced)

M1 through M6 taught mosd to render VLAN, bridge and WireGuard interfaces and
apid to write them, and every one of those milestones was verified against a
process rather than against a device. This one closes that: it makes the two
kernel symbols a build-time requirement on the board that compiles its own
kernel, reads the other board's kernel off the image it ships, and then creates
all three device kinds on a booted guest — the only evidence that answers
whether the kernel hands a device back.

It also produces the M6 verdict RFCT-205 could not: *"`make os-apid-api-test` |
**not run — the artefact it takes as input does not exist on this host.**"*
(`docs/task/RFCT-205.md:314`). An image now exists, so the suite ran.

## Scope

| file | change |
| --- | --- |
| `os/boards/common/mos-required.fragment` | `CONFIG_VLAN_8021Q=y` and `CONFIG_BRIDGE=y` appended below the WireGuard line |
| `os/verify/src/checks-kernel.ts`, `checks-kernel.test.ts` | two x64 on-image checks and their failing-side cases |
| `os/verify/src/checks.ts`, `checks-fixture.ts` | the register entry, and the kernel facts a healthy packed root carries |
| `os/verify/src/checks-connd.ts`, `checks-connd.test.ts` | the sweep contract read as the LIST of suffixes M4 made it (see *Findings*) |
| `test/apid-api/guest/m7-net-smoke.sh` | the guest-side smoke: three `ip link add`s, `modprobe` resolution, the setpriv traversal pair |
| `test/apid-api/src/phases/05c-kernel-net.ts`, `src/main.ts` | the phase that reads those conclusions back, and its registry entry |
| `test/apid-api/run.sh` | seeds the script onto STATE and starts it from the kernel command line |
| `test/apid-api/src/phases/04-readonly.ts` | three assertions rewritten to the tree's current contract (see *The 04-readonly rows*) |
| `os/tools/qemu-run.sh` | three defects in the `MOS_QEMU_APPEND` block (see *Findings*) |

## 1. The kernel fragment

Two lines, appended rather than inserted so that every existing citation into
this file keeps its anchor:

```text
CONFIG_VLAN_8021Q=y
CONFIG_BRIDGE=y
```

The fragment now ends *"CONFIG_VLAN_8021Q=y"*
(`os/boards/common/mos-required.fragment:45`), then *"CONFIG_BRIDGE=y"*
(`os/boards/common/mos-required.fragment:46`).

**The assertion mechanism, quoted.** The board kernel copies its vendor config
to `.config`, merges this fragment, runs `olddefconfig`, and then requires every
`=y` line of the fragment to be present in the final `.config`:

```sh
    for line in $(sed -n 's/^\(CONFIG_[A-Z0-9_]*=y\)$/\1/p' /mos-required.fragment); do \
        grep -q "^${line}$" .config || { \
            echo "missing mos-required option: ${line}" >&2; \
            exit 1; \
        }; \
    done
```

The loop's own refusal is *"missing mos-required option: ${line}"*
(`os/boards/cx3576/bsp/kernel/Dockerfile:102`). It reads the fragment
at build time, so adding a line to the fragment adds an assertion; nothing else
had to change. That is what discharges the cx3576 functional need statically —
RFCT-200 measured both symbols already `=y` in the vendor file — it records
*"1244:CONFIG_BRIDGE=y"* (`docs/task/RFCT-200.md:435`) and
*"1250:CONFIG_VLAN_8021Q=y"* (`docs/task/RFCT-200.md:437`) — and the fragment is
what stops a regenerated vendor config dropping them silently.

**Measured, on a real cx3576 kernel build.** The merge reports only REDEFINED
values, and neither new symbol is redefined — both were already `=y`, exactly as
RFCT-200 measured:

```text
#15 0.658 Value of CONFIG_WIREGUARD is redefined by fragment /mos-required.fragment:
#15 0.658 Previous value: # CONFIG_WIREGUARD is not set
#15 0.658 New value: CONFIG_WIREGUARD=y
#15 0.676 # merged configuration written to .config (needs make)
#15 DONE 17.9s
```

The `DONE` is the evidence that matters: the assertion loop is the last command
of that stage, so the stage completing is the loop having found every `=y` line
of the fragment — including the two added here — in the compiled kernel's final
`.config`. A missing one exits 1 with `missing mos-required option: <line>`.

## 2. The x64 on-image checks

`os/verify/src/checks-kernel.ts` registers two checks, both scoped
`boards: ['x64']`. The scoping is the argument: cx3576 cannot ship an image
whose kernel lacks these symbols, because the build fails first, so a second and
weaker runtime opinion about that board would only add a way to disagree. x64
has no such build — the kernel is Debian's, installed whole as a package, and
*"The Debian config is not present in this repository, and nothing in-tree
proves what it sets."* (`docs/task/RFCT-200.md:493-494`). So it is read off the
artefact.

The two are separate checks because they fail for unrelated reasons. The first
reads `/boot/config-<release>`; the second asks whether the module a `=m` line
promises is actually in the root, resolved the way `modprobe` resolves —
`modules.builtin` first, then `modules.dep` with every object it names required
to exist. A module listed in `modules.dep` whose `.ko` was never packed fails at
load time with the config line still reading `=m`, so the config check alone
stays green while the device cannot be created.

**Measured against the built image** (`bash os/verify/run.sh --verify --board x64`):

```text
PASS: the shipped kernel config declares VLAN_8021Q, BRIDGE and WIREGUARD in /boot/config-6.12.105+deb13-amd64: CONFIG_VLAN_8021Q=m, CONFIG_BRIDGE=m, CONFIG_WIREGUARD=m
PASS: modprobe resolves 8021q, bridge and wireguard against /lib/modules/6.12.105+deb13-amd64: 8021q=kernel/net/8021q/8021q.ko.xz, bridge=kernel/net/bridge/bridge.ko.xz, wireguard=kernel/drivers/net/wireguard/wireguard.ko.xz
RESULT: PASS (292/292 checks, 22 skipped (x64/grub; each named above))
```

All three are `=m`, which is what RFCT-200 expected — and it said why the
expectation was not enough: *"the expectation is `=m` for all three, but
expectation is not measurement"* (`docs/task/RFCT-200.md:505`). It is a
measurement now. `=m` is acceptable on this board and not on the other, because
x64 ships `kmod` and a full Debian module set while cx3576 boots dm-verity with
no initramfs and *"cannot load modules, so these must be built-in =y, never
=m"* (`os/boards/common/mos-required.fragment:4-5`).

One incidental fact worth recording for M8: the kernel is
**6.12.105+deb13-amd64**, where RFCT-200 names
*"Debian's `linux-image-6.12.101+deb13-amd64`"*
(`docs/task/RFCT-200.md:474`). Both checks derive the release from the image
rather than pinning it, so neither is affected; the stale number is prose.

**Measured on the booted guest**, phase 05c's own PASS lines for the kernel half:

```text
PASS: the running kernel resolves the 8021q module -- modprobe -n 8021q resolved
PASS: the running kernel resolves the bridge module -- modprobe -n bridge resolved
PASS: the running kernel resolves the wireguard module -- modprobe -n wireguard resolved
PASS: the kernel creates a VLAN device on a declared parent -- 3: eth0.4094@eth0: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN mode DEFAULT group default qlen 1000\    link/ether 52:54:00:12:34:56
PASS: the kernel creates a bridge device -- 4: m7br0: <BROADCAST,MULTICAST> mtu 1500 qdisc noop state DOWN mode DEFAULT group default qlen 1000\    link/ether c6:49:d2:b6:eb:ce brd ff:ff:ff:ff:ff:ff
PASS: the kernel creates a WireGuard device -- 5: m7wg0: <POINTOPOINT,NOARP> mtu 1420 qdisc noop state DOWN mode DEFAULT group default qlen 1000\    link/none
```

The guest's own kernel log records the three subsystems coming up as those
`ip link add`s ask for them — `8021q: 802.1Q VLAN Support v1.8`, `bridge:
filtering via arp/ip/ip6tables is no longer available by default` and
`wireguard: WireGuard 1.0.0 loaded` — which is the module set the offline check
in section 2 could only say was PRESENT actually being loaded.

## 3. The booted-image smoke, and where it lives

`os/verify` has four modes and **none of them boots anything** — `--lint` reads
board definitions, `--verify` reads an assembled image, `--smoke` executes
self-built binaries inside the packed root, `--smoke-negative` rejects three
defective images. Its two new checks are the limit of what an offline reader can
honestly say: a config symbol is a claim about what was compiled, and
`modules.dep` is a claim about what was packed.

The apid-api harness already owns the only booted x64 guest in the tree: it
prepares a disk, boots it, puts journald on the serial line and captures the
console. So the smoke lands there, as **phase 05c**, and teaching `os/verify` to
boot QEMU would have been a second copy of all of it.

The guest half is `test/apid-api/guest/m7-net-smoke.sh`, seeded onto STATE by
`run.sh` and started with `systemd.run=` from the kernel command line. A unit
dropped into `/mnt/state/systemd-units` would NOT work: that path joins the unit
search only at `local-fs.target` — its source is *"What=/mnt/state/systemd-units"*
(`os/rootfs/overlay-v2/etc/systemd/system/usr-local-lib-systemd-system.mount:37`)
and it is enabled by *"WantedBy=local-fs.target"*
(`os/rootfs/overlay-v2/etc/systemd/system/usr-local-lib-systemd-system.mount:43`),
which is later than the boot transaction that would have to load such a unit.
The console is one-way, so the guest decides and the phase reads.

## 4. The setpriv traversal check

RFCT-204 left this explicitly to an on-image check rather than making it a hard
failure in the daemon: a store built with no group *"is left to the on-image
check rather than made a hard failure, because refusing there would abort the
whole network reconcile"* (`docs/task/RFCT-204.md:80-82`).

It is run **as the user**, never by reading mode bits, because mode bits are
exactly what missed the M5 defect: a key under a 0700 `secrets/` leaves every
mode assertion green while *"`PrivateKeyFile=` would be `EACCES` on every real
image with every mode assertion still green"*
(`docs/task/RFCT-204.md:58-59`). `setpriv --reuid --regid --clear-groups` drops
to the account systemd-networkd runs as and lets the kernel answer.

Both directions are asserted. The negative is not decoration: if
`systemd-network` could read `secrets/`, the amendment's premise would be false
and the path correction this milestone verifies would have been unnecessary.

**Measured on the booted guest**, phase 05c's own PASS lines:

```text
PASS: the image carries the systemd-network account mosd chowns key files to -- uid=998(systemd-network) gid=998(systemd-network) groups=998(systemd-network)
PASS: the systemd-network USER can read a 0640 root:systemd-network key under <state>/networkd-secrets/ -- run as that user, not inferred from mode bits -- systemd-network read /var/lib/mos/networkd-secrets/m7-probe.key (mode 640 root:systemd-network); every path component is traversable by that user
PASS: the same user CANNOT read <state>/secrets/, which is why the key store is a sibling of it and not a directory under it
```

And on the SECOND boot, where mosd has provisioned for real, the subject is no
longer a fixture. The key `wg-e2e` caused mosd to generate in boot 1 is read by
the same user, and the `secrets/` refusing it is mosd's own directory:

```text
M7-SMOKE: keystore-real-readable PASS systemd-network read the key mosd generated at /var/lib/mos/networkd-secrets/wg-wg-e2e.key (mode 640 root:systemd-network)
M7-SMOKE: secrets-unreadable PASS systemd-network cannot read /var/lib/mos/secrets/device-password (dir mode 700 root:root, the directory mosd provisioned)
```

That is RFCT-204's handoff discharged against M5's actual output rather than
against a lookalike. Phase 05c runs on the first boot, so the line it ASSERTS is
the fixture one and `keystore-real-readable` is honestly SKIPPED there; adding
`05c-kernel-net` to `MOS_APID_BOOT2_PHASES` would make the stronger pair an
assertion too, and is left as a stated improvement rather than taken now,
because it changes the phase list every other assertion in this run was measured
against.

## 5. Findings — defects found, and what was done with each

Five, none of them in M2..M6 product code. Each was diagnosed before anything
was touched.

### 5.1 The connd contract reader, broken by M4's widened sweep

`os/verify` extracts the reconciler's sweep predicate out of `network.rs` and
requires the suffix to be `.network`. M4 correctly widened that predicate to
cover the `.netdev` files it now renders — pre-merge
`file_name.starts_with("50-mos-") && file_name.ends_with(".network")`, post-merge
the predicate now also accepts `file_name.ends_with(".netdev")`
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:617`).
The extractor's pattern carried a leading greedy `.*`, so on a line holding two
`ends_with` calls it captured the LAST and reported it as the first: the
contract read `.netdev`, `read` went false, and ten connd assertions went red at
once.

**Proved pre-existing, not caused by this milestone.** Pointing
`MOS_VERIFY_RECONCILER_DIR` at the pre-merge reconciler sources gave
`RESULT: PASS (41/41 tests)`; the post-merge sources gave 10 failures with the
same working tree.

Repaired in `os/verify`, not in mosd: the sweep is now modelled as the LIST of
suffixes it actually is, and `.network` is required to be among them. This is
the co-change M4 owed; the mosd source was not touched.

### 5.2 `qemu-run.sh` read grub.cfg from the wrong partition

The `MOS_QEMU_APPEND` block computed `esp_off=$(( BOOT_A_START_MIB * 1048576 ))`
— naming the result `esp_off` while feeding it the boot slot. On x64 those are
two different partitions and only one holds a grub.cfg. Measured against the
built image: the ESP at 1 MiB carries `EFI/mos/grub.cfg` and `EFI/mos/grubenv`;
BOOT-A at 65 MiB carries `vmlinuz`, `initrd.img` and `cmdline.cfg` at its FAT
root and has **no `EFI` directory at all**. `mcopy` failed with
`File "::/EFI/mos/grub.cfg" not found` and took the whole prepare down.

### 5.3 ...and could not have matched the line even at the right offset

The pattern was `^    linux ` — four spaces. The template indents its own with
**eight**, and always has: *"        linux (${slot_a_root})/vmlinuz"*
(`os/boards/x64/grub.cfg:98`), and the B slot's
*"        linux (${slot_b_root})/vmlinuz"* (`os/boards/x64/grub.cfg:116`).
Matched as whitespace now.

### 5.4 ...and the guard that should have said so was unreachable

`before=$(grep -c "^    linux " grub.cfg)` under `set -e`: `grep -c` exits 1 when
it counts nothing, and a command substitution exiting non-zero aborts the shell
— **before** the next line's `[ "${before}" -ge 1 ] || { echo "error: ..." }`
could run. So a completely unmatched pattern presented as a prepare step that
printed nothing and failed. Both counts take `|| true` so their guards can fire.

5.2 through 5.4 are pre-existing and unrelated to PLAN-022 — the `esp_off` line
is unchanged since the harness was first written. Together they made
`make os-apid-api-test` unable to reach a boot at all, because the harness always
sets `MOS_QEMU_APPEND`: its readiness signal is the journald console line that
append produces. They are fixed here because the M6 verdict cannot be produced
without them.

### 5.4b The second boot was unreachable, for two more reasons

Both surfaced only once a run got past the defects above, and both are
pre-existing.

`MOS_APID_PHASES` defaulted to the empty string, which the runner reads as ALL
phases, so `07b-postreboot` ran in the FIRST boot — after phase 07 had
deliberately taken the guest down. It waited its full 180s deadline for apid on
a machine that was off, failed, and threw on `ECONNREFUSED`. HARNESS.md had
always described the intended split — *"phases 01-transport .. 07-reboot"*
(`test/apid-api/HARNESS.md:83`) — and the code did not implement it. The first boot's list is spelled out now, and the runner's
refusal of an unknown phase name makes a later rename fail loudly rather than
silently shrink the run.

Then the guard that decides whether to make a second boot compared the handoff
against `disk.img`. **The guest writes to `disk.img` for the whole boot**, so
its mtime always advances past a handoff written mid-boot at the POST — the
comparison was false on every successful run, and the harness skipped the second
boot reporting that 07 had not run on a run where 07 had run and the console
showed the guest going down. It compares against an empty stamp taken before
anything boots now.

### 5.5 Defects in this milestone's own first cut, found by running it

Recorded because they were found by the booted run and not by review, which is
the argument for the run:

- `systemd.run_success_action` defaults to `exit-force`, which in PID 1's
  context **powers the machine off** when the command returns. The smoke ended
  at 56.7s and the guest printed `reboot: Power down` at 62.1s. Both actions are
  pinned to `none`.
- `kernel-command-line.service` starts immediately after `sysinit.target` and
  **holds the rest of the boot** while it runs. The script's 120s wait for
  `<state>/secrets/` therefore deadlocked against mosd, the only process that
  creates it. The directory is now created at the mode `identity.rs` pins when
  absent and removed again; on a disk mosd has already provisioned, the real one
  is used untouched.
- The first cut discovered the VLAN parent from the default route, so it ran
  before DHCP and reported *"no interface carries the default route"* as a
  kernel defect. A VLAN parent must exist, not be up: any non-loopback link.
- `qemu-run.sh` appended unconditionally on the prepare and on every reuse boot.
  For `systemd.journald.forward_to_console=1` a repeat is the same value twice;
  for `systemd.run=` systemd takes each occurrence as another `ExecStart` and
  **ran the seeded script twice**. The append is idempotent now.

## 6. The 04-readonly rows

RFCT-205 predicted these precisely and declined to rewrite them blind:
*"rewriting them blind — against an image that cannot be booted here to check
the rewrite — would replace a visible skew with an invisible guess"*
(`docs/task/RFCT-205.md:341-343`). With a bootable image in hand they are
rewritten and checked.

`/api/versions` is a declared route answering 200, and the gate hands it off
unauthenticated by design: the router declares
*".route(VERSIONS_PATH, get(api_versions))"*
(`os/pkgs/mosd/apid/src/routes.rs:416`) and the gate releases it because
*"`/api/versions` is unauthenticated by design"*
(`os/pkgs/mosd/apid/src/routes.rs:536-537`).
It is therefore no longer listed among the paths that must produce the
not-found envelope, and the anonymous probe asserts 200 with a JSON content
type. The gate-wraps-the-reserved-subtree property it used to carry moves to
`/api/v1/settings`, which is undeclared and still redirects — keeping both
directions, because "the prefix is open" and "the prefix is correctly scoped"
otherwise produce identical evidence. `/api/v1/settings` remains a valid
not-found target: `{*path}` matches at least one character, so the bare root
reaches the subtree's own fallback: *"A root prefix with nothing after it names
none."* (`os/pkgs/mosd/apid/src/routes.rs:655`).

The `/mqtt` image-skew guard is deleted and its own stated remedy applied —
*"the image now serves /mqtt; add it to PANES and /mqtt/enable to POST_ONLY in
04-readonly, then update this guard."* The pane's marker is the notice `mqtt_page` renders unconditionally,
*"p { b { (MQTT_UPDATE_NOTICE) } }"*
(`os/pkgs/mosd/apid/src/routes.rs:6650`), rather than the switch text that moves
with the setting.

## 7. cx3576 — what ran, and what a hardware pass must still do

**The kernel built, and it asserted the fragment.** That is the half of M7 that
matters for this board, and section 1 records the measurement.

**The image did not.** `MOS_BOARD=cx3576 make os-rauc` refuses, by name:

```text
error: the 'default' buildx builder does not offer linux/arm64 on this host, and it is
the only builder that can be used here: every stage of os/pkgs/rauc/Dockerfile is FROM a
localhost/mos-build-* tag, which lives in the local docker image store, and a
docker-container builder treats 'localhost/' as a registry hostname. Register the emulator
on the HOST -- docker run --privileged --rm tonistiigi/binfmt --install arm64 -- so that
the default builder can reach it; a docker-container builder would not help
```

The precise missing capability is a **host arm64 binfmt registration**, and it
cannot be obtained here. `/proc/sys/fs/binfmt_misc/` is empty, the documented
remedy reports success — `"emulators": ["qemu-aarch64"]` — and the directory is
**still empty afterwards**: the registration does not stick in this container's
namespace. The `mos-arm64` docker-container builder does not close the gap and
the refusal says why; it genuinely executes arm64, proved by a throwaway build
whose `uname -m` printed `aarch64` (`docker buildx ls` under-reports it as
amd64/386 only), but it cannot resolve the `localhost/mos-build-*` bases these
Dockerfiles are built FROM. The container engine is blocked the same way, by a
refusal reading
*"the 'default' buildx builder does not offer linux/${MOS_ARCH} on this host"*
(`os/pkgs/podman/build.sh` as it stood at a86ab46; RFCT-231 replaced that
refusal, so the line anchor is gone and the quote is kept as the record of what
ran here).

**A booted cx3576 smoke is not executable here** under any arrangement: there is
no cx3576 image and no cx3576 hardware on this host.

Pre-declared for a later hardware pass, so the gap is a stated obligation rather
than a silence:

1. Build the cx3576 image on a host with arm64 binfmt registered. Its verify
   script needs **both** U-Boot variants present (`uboot` and `uboot-mos`) or it
   reports a misleading near-pass; both were built here and are in `bsp/out/`.
2. Boot it on real hardware and run `test/apid-api/guest/m7-net-smoke.sh`. It is
   board-independent by construction — it discovers its VLAN parent, reads the
   kernel release from `uname -r`, and hard-codes no interface name — so it is
   the script to run, not a new one to write.
3. Expect `modprobe -n` to resolve all three as **built-ins** rather than
   modules there, cx3576 being `=y`-only, and the `link-*` checks to pass
   identically.

The kernel half is not deferred: the fragment assertion is a build-time hard
failure, and it ran.

## 8. Verification

| gate | result |
| --- | --- |
| `bash os/pkgs/mosd/hack/check.sh` | `Summary [ 52.823s] 681 tests run: 681 passed, 0 skipped`, `advisories ok, bans ok, licenses ok`, `ALL CHECKS PASSED` |
| `bash os/pkgs/rauc-sign/hack/check.sh` | `Summary [ 0.254s] 15 tests run: 15 passed, 0 skipped`, `ALL CHECKS PASSED` |
| `bash docs/verify-citations.sh` | `1315/1315 PASS`, RFCT-206 at 0 unquoted citations |
| `bash docs/verify-index.sh` | `728/728 PASS` |
| `bash os/verify/run.sh` (the suite) | `RESULT: PASS (1080/1080 tests)` |
| `bash os/verify/run.sh --verify --board x64` | `RESULT: PASS (292/292 checks, 22 skipped)`, both new checks green |
| `make os-shell-pipefail-lint` | `RESULT: PASS (32/32 files clean, 32 scanned)` |
| x64 image build | green — `_out/x64/x64-mos-v2-latest.img` |
| cx3576 kernel build | green, fragment assertion passed |
| cx3576 image build | **blocked** — no host arm64 binfmt; section 7 |
| `make os-apid-api-test` | `RESULT: PASS (329/329 checks)` — boot 1 `PASS (299/299)`, boot 2 `PASS (17/17)`, 9 skipped |

## 9. Out of scope, and untouched

No file under `os/pkgs/mosd/` was edited: the M4 defect found in section 5.1 was
repaired on the `os/verify` side, which is where the reader lives, and the
reconciler's widened sweep is correct as M4 wrote it. No design prose was
touched — `api.md` and `mosd.md` are M8's, and the stale kernel version in
RFCT-200 section 5.2 is flagged in section 2 rather than edited, this record
having no licence over another task's file. Peer pre-shared keys stay excluded
by PLAN-022 Amendment 1. No other task or plan file was edited beyond this
record and its index row.
