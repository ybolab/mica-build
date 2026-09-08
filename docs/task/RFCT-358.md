# RFCT-358 Two latent hazards from the first hardware boot: host-resolved symlinks in verify, and the ESP automount a generator writes for a RAUC boot slot

- **status**: completed
- **priority**: P1
- **owner**: bkd/na7l21jo
- **createdAt**: 2026-09-08 14:00
- **relatedPlans**: (none)

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

Two things RFCT-355 found while triaging the first cx3576 hardware boot, named
there and deliberately left. Both are safe today for a reason nobody chose.

1. **`regularFileFollowingLinks` resolves symlinks against the HOST.** It is
   `statSync(join(root, path))`, which hands the whole path to the host kernel,
   so an ABSOLUTE symlink inside the unpacked root resolves against the
   verifying machine's `/`. RFCT-355 hit it for real on `wifi-regdb-present`
   and closed it in the three regdb checks only, naming the rest.
2. **`systemd-gpt-auto-generator` writes an ESP automount for a RAUC-owned boot
   slot.** Nothing in this tree wrote `efi.automount`; the generator writes it
   because the boot slots are typed ESP and appear in no fstab. It is inert on
   cx3576 only because `CONFIG_AUTOFS_FS` is off.

## ActiveForm

Migrating the verifier's path resolution into the unpacked root, and closing the
generated ESP automount independently of a kernel symbol

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- Item 1: every call site classified, the migrated ones' verdicts compared
  before and after on a real assembled image, discriminating tests added
  wherever a migrated site has a fixture, and the fate of
  `regularFileFollowingLinks` decided in writing.
- Item 2: closed independently of `CONFIG_AUTOFS_FS`, with an assertion that
  reads the image, and the three boards' exposure measured rather than assumed.
- `verify/run.sh --verify --board cx3576` and `--board virt-arm64` green on
  images built here; every verdict that moved reported with its cause.
- `verify/run.sh` and `make docs-verify` green, the latter from a `git archive`
  into an empty directory.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/changelog.md` untouched;
  nothing display- or kernel-config-related, and neither the factory-root gate
  nor the smoke build record.

## Notes

### 1. Item 1: the classification, and what "call site" turned out to mean

The brief counted "40 call sites across 7 files". Measured, the register in
those seven modules is:

| module | `regularFileFollowingLinks` calls | other `join(root, …)` resolutions | after |
| --- | --- | --- | --- |
| `checks-dbus.ts` | 6 | 4 | 0 |
| `checks-engine.ts` | 6 | 6 | 0 |
| `checks-system.ts` | 6 | 11 | 1 (a comment) |
| `checks-home.ts` | 12 | 5 | 0 |
| `checks-connd.ts` | 3 | 7 | 0 |
| `checks-root.ts` | 0 | 17 | 5 (the resolver's own 3 steps, 2 comments) |
| `script-commands.ts` | 0 | 3 | 0 |
| **total** | **33** | **53** | **6** |

**What moved.** All 33 predicate calls, and every read, stat, listing, readlink
and realpath beside them in those modules: a presence test that resolves inside
the root paired with a `readFileSync(join(root, path))` that does not is worse
than either, because it reports the host's bytes as the image's while the
check's own guard says the file is the image's. `checks-root.ts` now exports the
whole set -- `entry` (lstat, chain resolved), `statInRoot`, `regularFileInRoot`,
`pathInRoot`, `linkTargetInRoot` -- and owns the only walk.

**What stayed, and why.**

- **Host paths, deliberately.** `join(ctx.metaDir, …)` in `checks-root.ts` (the
  repository's own `meta/`, which is the thing the image is compared AGAINST)
  and `join(MOSD_SRC, file)` in `checks-system.ts` (mosd's Rust sources). These
  are not image paths; resolving them inside the packed root would be the
  defect in the other direction.
- **The interior of a walk.** `wantsLink`, `findUnder`, `shippedUnder`,
  `sshWants`, `discardOverrides` and the `.network` sweep descend by name and
  lstat each entry; a symlink is reported and never descended through, which is
  what `find` does and is strictly narrower than the resolver. Only their ENTRY
  POINTS moved, which is where a tree named through an absolute symlink would
  have been enumerated on the host.
- **`entry()`'s last component.** Still lstat, because "what is AT this path" is
  the question and a symlink is its own answer. What changed is the chain above
  it.

**What is NOT in this task's scope, stated rather than rounded up.** The same
shape survives at **79 sites in 15 other modules** of the verify package
(`checks-hwdb` 14, `checks-mqtt` 11, `checks-debug` 10, `checks-firewall` 9,
`checks-board` 7, `checks-kernel` 6, `checks-busybox` 5, `checks-shadow` 5,
`checks-time` 3, `checks-update` 2, `checks-fstab` 2, `checks-rauc-units` 2,
`checks-rauc` 1, `checks-ext4` 1, `checks-cmdline` 1), measured 2026-09-08.
`checks-fixture.ts`'s 48 are not on that list: it BUILDS fixtures on the host,
where `join(root, …)` is the correct spelling. Nothing here says the 79 are
safe; they are the same defect, in modules this task did not name.

### 2. The fate of `regularFileFollowingLinks`: DELETED

Not deprecated, not kept for a named use. It was `statSync(join(root, path))`
under a name that reads like the safe one, and a host-resolving helper left in
the tree with no callers is how this comes back -- the next reader takes it for
the normal helper, because it is the one that is spelled like one. There is no
legitimate use for it in this package: every path it was ever handed came out of
an image.

The rule it leaves behind is checkable, so it is checked: a test in
`checks-root.test.ts` greps the six migrated modules for `join(root` outside a
comment and fails on any occurrence, with the 15 unmigrated modules named in the
test's own comment so the boundary is not mistaken for a claim. Driven: planting
one `join(root, '/x')` in `checks-dbus.ts` turns it red.

### 3. The discriminating tests

RFCT-355's `/proc/version` probe is the pattern -- a regular file on any Linux
host, a path no fixture contains -- and it is used wherever the migrated site
only asks whether something is there. Where the site READS, the probe is
stronger: the fixture's own bytes are copied to a host temp file and the image
path is replaced by an absolute symlink to it, so the two implementations differ
by nothing except which filesystem resolved the path, and host resolution
answers PASS.

Nine cases, in six suites. All nine go red under a faithful mutation --
`statInRoot`/`pathInRoot`/`entry`/`linkTargetInRoot` restored to their
pre-RFCT-358 host spellings -- which is the only way to show they test the
implementation rather than the helper.

### 4. Item 2: RFCT-355 named the right board for the wrong reason

**The reason matters, because it is what the other two boards' safety rests
on.** RFCT-355 recorded the generated `efi.automount` as cx3576's, on the
reading that "x64 and virt-arm64 mount their ESP from `fstab`, which is what
makes the generator skip it there". Both halves of that are wrong.

**They do not mount it from fstab.** `rootfs/overlay/etc/fstab.in` carries no
ESP row on any board; the two UEFI boards mount theirs from
`boards/<board>/overlay/etc/systemd/system/boot.mount.in`, a UNIT.

**A unit could not suppress the generator anyway.** In systemd 257.13 -- the
pinned version, `rootfs/debian/packages/systemd.json` --
`process_loader_partitions()` consults `fstab` twice
(`fstab_has_mount_point_prefix_strv(("/boot","/efi"))`, then
`fstab_has_node(p->node)` inside `add_partition_esp()`) and consults the unit
set never. What it writes is an `.automount`, which no `.mount` unit shadows.

**What actually decides it is the BOOT PATH.** `process_loader_partitions()`:

```c
if (!is_efi_boot()) { log_debug("Not an EFI boot, skipping loader partition UUID check."); goto mount; }
r = efi_loader_get_device_part_uuid(&loader_uuid);
if (r == -ENOENT) { log_debug_errno(r, "EFI loader partition unknown, skipping ESP and XBOOTLDR mounts."); return 0; }
```

- **cx3576 boots by U-Boot, which is not an EFI boot**, so the UUID check is
  skipped and the mount is generated: `efi.automount` at `/efi` and not
  `/boot` (`path_is_busy("/boot")` is true -- the packed root carries
  `/boot/config-6.1.115`), over BOOT-A rather than BOOT-B because
  `dissect_image()` keeps the first partition of each designator. That is the
  unit the 2026-09-08 hardware boot reported.
- **x64 and virt-arm64 boot through GRUB**, which sets no
  `LoaderDevicePartUUID`, so the generator returns early. **Measured**, not
  inferred: a virt-arm64 QEMU boot of the pre-change image on 2026-09-08
  reached `multi-user.target` (startup 1m36s under TCG), mounted the ESP at
  `/boot` from `boot.mount`, and carried exactly one `.automount` subject in
  the whole boot -- `proc-sys-fs-binfmt_misc.automount`, skipped on its own
  `ConditionPathExists`. No `efi.automount`, nothing at `/efi`.

**So there are three accidents, not one, and none of them is a decision.**
cx3576 generates the unit and builds no autofs, so it is refused; the UEFI
boards do build autofs (`CONFIG_AUTOFS_FS=y`, read out of their shipped
`/boot/config-*`) and are spared only by their boot loader's choice of EFI
variables. A board that gains an EFI boot path -- which is RFCT-357's open
question for cx3576 -- or a loader that sets `LoaderDevicePartUUID` moves the
exposure with nobody editing a mount. That is why the mask is not board-scoped.

### 5. Why masking the generator, and what the other two cost

**Masking the generated unit by name** (`/etc/systemd/system/efi.automount ->
/dev/null`) closes today's spelling and encodes a systemd internal:
`add_partition_esp()` picks `/boot` the moment `/boot` is empty, and the unit
is then `boot.automount` -- a name the mask does not carry, on a board where
`/boot` really is a mountpoint. It also leaves the generator running and its
other outputs in place.

**Naming the boot slots in `fstab`** works through `fstab_has_node()`, but it
declares a mount of a RAUC-owned boot partition in order to suppress one; with
`noauto` it is an entry that documents a mount nobody performs, and on cx3576
there are two boot slots and no legitimate mount for either. It also has to be
per board.

**`systemd.gpt_auto=0` on the kernel command line** is the generator's own
switch and is equivalent in effect, but it moves the guarantee into the
bootloader environment -- a writable uenv partition on cx3576, grub.cfg on the
ESP for the UEFI boards -- and any rescue or manual boot that types its own
cmdline loses it. The point of this task is that the guarantee should not live
somewhere it can be switched off by accident.

**Masking the generator** is one file, in one package, on three boards, and it
states the policy the tree already follows: mos declares its mounts; nothing is
discovered from the partition table. It is systemd's documented mechanism and
the mechanism is in the shipped version's own source: `execute_directories()`
enumerates generators with `CONF_FILES_FILTER_MASKED`, `files_add()` stats
through the link, `null_or_empty()` recognises the null device and the name is
dropped for every lower-priority directory; `/etc/systemd/system-generators`
precedes `SYSTEM_GENERATOR_DIR` in `system_generator_paths`.

Nothing is lost: the verity root comes from the kernel command line, `/mnt/*`,
`/var` and `/tmp` from `/etc/fstab`, the ESP on a UEFI board from `boot.mount`,
and every other subject the generator has -- `/home`, `/srv`, `/var`, swap,
root-rw -- is keyed on a discoverable-partition type GUID that no mos layout
uses. `LOADER_TYPECODE` on cx3576 is already chosen so that no auto-mount path
acts on it (`boards/cx3576/board.env`); this is the same argument, finished.

### 6. The runtime measurement, on the board that can be booted

`verify` reads a symlink out of the image; it cannot say whether systemd honours
it. So the mechanism was driven on a real mos guest: virt-arm64 under
`qemu-system-aarch64`, booted through AAVMF and GRUB from the disk, with a probe
script seeded into STATE and run by `systemd.run=` at `multi-user.target`
(`pkgs/mosd/tests/apid-api/src/qemu.ts --prepare-only`,
`tools/qemu-seed-state.sh`, then `--capture`). The probe raises the log level,
runs `systemctl daemon-reload` -- which re-runs the generators -- and prints
every "About to execute" line the manager logged.

**Before (the pre-change image, no mask), 2026-09-08:** twelve generators
executed, `systemd-gpt-auto-generator` among them; the only automount subject in
the boot was `proc-sys-fs-binfmt_misc.automount`; `systemctl cat efi.automount`
answered "No files found"; nothing was mounted at `/efi`; and `/boot` carried
the ESP from `boot.mount`. That is the pair the correction above rests on: the
generator RUNS on this board and writes nothing, because the board boots
through EFI and GRUB sets no `LoaderDevicePartUUID`.

**After (the image this task built, masked):** eleven generators executed and
`systemd-gpt-auto-generator` is not among them, with systemd's own journal
giving the reason in the two lines `files_add()` logs:

```
File '/etc/systemd/system-generators/systemd-gpt-auto-generator' is a mask.
File '/usr/lib/systemd/system-generators/systemd-gpt-auto-generator' is masked by previous entry.
```

The probe also settles the claim the boot-path argument rests on: with the mask
in place the guest's `/sys/firmware/efi/efivars/` holds 23 variables and **not
one `Loader*`** among them, so GRUB really does set no `LoaderDevicePartUUID`,
and the generator's early return on the UEFI boards is that absence and nothing
else.

The masking mechanism is board-independent -- it is the same systemd 257.13
arm64 binary on cx3576 -- so a run that shows the generator dropped from the
executed list on one board is the mechanism working on all three. What stays
bench-only is cx3576's own `no-efi-automount` row in `docs/bsp/cx3576-bench.md`,
which is the one place the outcome can be read on the board that actually
generates the unit.

### 6b. The verdict comparison

**cx3576 — no verdict moved.** Main's verifier on the image this task built:
`RESULT: PASS (440/440 checks, 3 skipped)`. This branch's verifier on the same
image: `RESULT: PASS (442/442 checks, 3 skipped)`. Diffing the two conclusion
lists line by line leaves exactly the two new gpt-auto conclusions and ONE
changed message:

```
- PASS: /usr/lib/aarch64-linux-gnu/libcrypt.so.1 resolves to rch64-linux-gnu/libcrypt.so.1.1.0 in the image
+ PASS: /usr/lib/aarch64-linux-gnu/libcrypt.so.1 resolves to /usr/lib/aarch64-linux-gnu/libcrypt.so.1.1.0 in the image
```

That is `libcryptReal`, and the cause is worth stating because it is the defect
class in miniature. The old spelling was
`realpathSync(join(root, link))` and the caller printed
`real.slice(root.length)`. `realpath` canonicalises the WHOLE path, prefix
included, so when the unpacked root is reached through a symlink the returned
prefix is not the one the caller measured -- here the before-run's tree reaches
`_out` through a symlink whose name is eleven characters longer, and exactly
eleven characters were eaten off the front of the path in the message. The
verdict was the same either way; the sentence was wrong. `pathInRoot` never
canonicalises the prefix, so the message is right whatever the root path is.

**virt-arm64 — the same shape.** main: `PASS (321/321, 24 skipped)`. branch:
`PASS (323/323, 24 skipped)`. The diff is the same two added conclusions and
the same one corrected `libcrypt` message. **No verdict moved on either
board.**

### 7. Evidence

| what | result |
| --- | --- |
| `bash verify/run.sh` | PASS 1396/1396 |
| `bash verify/run.sh --verify --board cx3576` | PASS 442/442, 3 skipped |
| `bash verify/run.sh --verify --board virt-arm64` | PASS 323/323, 24 skipped |
| the same two runs with main's `verify/src`, same images | cx3576 PASS 440/440 and virt-arm64 PASS 321/321 -- the diff on each board is the two new conclusions and one corrected message, no moved verdict |
| `make docs-verify` from a `git archive` into an empty directory | PASS |
| `make os-shell-pipefail-lint` | PASS 95/95 |
| `make os-rootfs-manifest-test` | PASS 44/44 |
| the mask in the built package | `dpkg-deb -c mos-system_…_all.deb` shows `./etc/systemd/system-generators/systemd-gpt-auto-generator -> /dev/null` |

Both images were composed from the arm64 pool built at `0857e0ee`, the commit
that carries the code; the corrections in sections 4 and 6 landed after them and
change comments and documents only, no package bytes.

**Re-measured after merging main** (`0368beaf`, which brought RFCT-356). That
merge touches `rootfs/build.sh`'s build-commit record, the factory-root gate and
`verify/src/smoke*.ts` -- the smoke side, not the packed root and not the image
contract's register -- so the images stand. Both contract runs were repeated on
the merged tree against the same images anyway: cx3576 `PASS (442/442, 3
skipped)`, virt-arm64 `PASS (323/323, 24 skipped)`, and `verify/run.sh`
`PASS (1396/1396)`.
