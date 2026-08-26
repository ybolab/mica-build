# RFCT-142 Reading the U-Boot boot credits races a writer that no lock orders

- **status**: pending
- **priority**: P1
- **owner**: (unclaimed)
- **createdAt**: 2026-08-26

Two processes write the redundant U-Boot environment, and the file that
configures access to it says what protects them from each other:

```
# Two writers exist for this environment (RAUC slot marking and the first-boot
# machine-id oneshot), and libubootenv gives no cross-process locking, so their
# writes must never overlap.
```

at `os/rootfs/overlay-v2/etc/fw_env.config.in:23-25`. What keeps those two
apart is boot-time systemd ordering, not a lock: the machine-id oneshot runs
`After=local-fs.target` and is deliberately ordered before no target at all
(`os/rootfs/overlay-v2/usr/lib/systemd/system/mos-machine-id.service:6-8`),
and RAUC writes `BOOT_A_LEFT`/`BOOT_B_LEFT` through `fw_setenv` as part of slot
marking (`os/update/rauc/system.conf.in:35`). Ordering that holds during boot
says nothing about two processes that meet afterwards.

A dashboard that polls `BOOT_A_LEFT`/`BOOT_B_LEFT` is a reader with no
ordering relationship to either writer. A UI-triggered `rauc install` is worse:
it is a writer created on operator demand, outside any boot sequence, so the
ordering that separates the two existing writers does not reach it either. The
redundant pair exists so a torn write leaves one good copy, and a reader that
lands mid-write reads whichever copy the tool selects — which is a correctness
question nobody in this tree has answered.

What a resolution owes: whether `fw_printenv` against the redundant pair is
safe to run concurrently with `fw_setenv` at all, and if it is not, what
serialises them — a lock file both writers take, a single owning process, or a
mosd-side cache that is the only reader.

`docs/design/dashboard.md` section 8.2 phase 4d gates the boot-credits work on
this hazard and must keep doing so until it has an answer.
