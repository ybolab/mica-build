# RFCT-087 An offline U-Boot A/B handshake harness on the sandbox build (spike)

- **status**: complete — FEASIBLE; the shipped boot.cmd runs byte-unmodified under sandbox, harness 72/72 PASS, offline after first build
- **completedAt**: 2026-08-23 07:35
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-21 10:25
- **claimedAt**: 2026-08-21 10:25

Base `db57f2c` (RFCT-083 commit). One of the five roadmap workstreams the
RFCT-083 audit named and deferred; scope and outcome recorded at completion.

## Question

Can the SHIPPED `os/boot/cx3576-boot.cmd` — the A/B handshake contract of
docs/design/uboot-ab-handshake.md §5.3 — be executed byte-unmodified under a
`u-boot` sandbox build, with (a) a host-backed block device standing in for
eMMC, (b) the environment persisting across repeated sandbox invocations so
that one process invocation models one boot cycle, and (c) `booti` failing
naturally as "slot did not boot"? Only then is the state machine (decrement /
failover / refill / burn) testable without hardware.

## Verdict

**FEASIBLE — with one emulated transition.** The shipped script runs
byte-unmodified (compiled by the same `mkimage -T script` invocation
os/mkimage-v2.sh uses); no fork, no doctored copy, and the routing delta
outside `os/boot/handshake-test/` is the single `os-uboot-handshake-test`
Makefile target. All five mandated assertions run green offline; see
"What was built". The one thing sandbox cannot do natively is HAND CONTROL
to a kernel — `booti` always returns — so the "slot booted (and then hung
before mark-good)" cycle ending is emulated by a harness-seeded load address;
everything below is the evidence and the exact mechanics.

## What was established, per sub-question (all against the pinned source `ece349ade297`, the board's own U-Boot commit)

### (a) Host-backed block device — YES, but only as devtype `mmc`, and the script insists on it

The script hardcodes the device type and number: all four media accesses are
`load mmc 0:${bootpart}` (verity env ×2, Image, dtb). It does NOT flow
`${devtype}/${devnum}` from a bootflow, so sandbox's native `host bind`
devices (devtype `host`) can never serve it. What makes `mmc 0` possible
anyway: `drivers/mmc/sandbox_mmc.c` reads a `filename` DT property and maps
that file via `os_map_file(..., OS_O_RDWR | OS_O_CREAT, ...)` →
`mmap(PROT_READ|PROT_WRITE, MAP_SHARED)`. Reads AND writes go straight to a
host file. The harness build appends one mmc node (+ `mmc0` alias) to the
sandbox devicetree pointing at `mmc0.img`, and fabricates that image as a
layout-v2 GPT: real partition numbers, start sectors, labels, GUIDs and
typecodes for p1–p5 from `os/layout/cx3576-v2.env` (p6/p7 present at the real
p6 start, token-sized). The script's literal `bootpart` values 4/5 land on
real FAT filesystems at the real byte offsets.

### (b) Persistent env across invocations — YES, natively, at the board's own offsets

Because the mmc backing is a shared writable mapping, the harness binary
simply carries the board's env contract from
`board/cx3576/uboot/Dockerfile --target build-mos`: `ENV_IS_IN_MMC`,
redundant pair at `0x1000000`/`0x1100000`, `ENV_SIZE 0x10000`, mmc device 0 —
the same absolute offsets as the uenv-a/uenv-b partitions in the disk
fixture. The script's own `saveenv` persists into `mmc0.img`; the next
process invocation reads it back. No env-file shim, no import/export
plumbing: the persistence mechanism under test is the same env driver family
the board uses. Every counter readout is itself a separate sandbox process,
so each green assertion is a cross-process persistence proof.

Two invocation-model facts had to be established from source:

- `reset` on sandbox re-execs argv[0] (`sandbox_reset()` →
  `os_relaunch()` → `execv(argv[0])`), which would let one process run an
  unbounded number of boot cycles (and loop forever on the refill path). The
  harness pins argv[0] to `/dev/null/mos-boot-cycle` via bash `exec -a`; the
  re-exec then fails and `os_relaunch` falls through to `os_exit(1)`. A
  `reset` therefore ENDS the invocation with exit 1, and the next invocation
  is the post-reset boot. No U-Boot change involved — argv[0] is the
  caller's to set.
- `-c` command lists run at `sandbox_main_loop_init()` and the process exits
  with the list's return value when non-interactive — so counter readouts
  (`printenv`) terminate cleanly, and a boot cycle can only end by leaving
  U-Boot (reset or abort), never by falling into a console prompt.

### (c) `booti` failing naturally — YES, unconditionally, which cuts both ways

`CMD_BOOTI` explicitly supports sandbox (`depends on ARM64 || RISCV ||
SANDBOX`), but `arch/sandbox/lib/bootm.c: booti_setup()` fails
unconditionally ("Booting is not supported on the sandbox."). So:

- The "slot did not boot" ending is native and free: booti prints its error,
  returns, and the shipped script's fall-through tail runs — `mos: booti
  returned, slot X is bad`, credits zeroed, saveenv, reset. Asserted as
  scenario 3.
- BUT the inverse cycle — kernel boots and hangs before the health gate runs
  `rauc status mark-good`, which is the case the 3→2→1→0 decrement
  trajectory exists for — is IMPOSSIBLE natively: every cycle that reaches
  booti burns the slot to 0 in the same process, so the counter would never
  be observed at 2 or 1. This is the one place the harness emulates: sandbox
  treats any access above its RAM as a hard `os_abort()`
  (`arch/sandbox/cpu/cpu.c: phys_to_virt`), so seeding
  `kernel_addr_r=0xf0000000` with RAM pinned at 2048 MiB makes `load mmc
  0:${bootpart} ${kernel_addr_r} Image` kill the process at exactly the
  semantic point where control leaves U-Boot — after the decrement's
  saveenv, before the burn. `kernel_addr_r` is board-env-provided on
  hardware (the script never sets it), so seeding it is environment, not a
  script change. RAM must be 2048 MiB regardless: the script's hardcoded
  `verityaddr 0x40f00000` sits above the sandbox default of 256 MiB, and
  would abort every cycle otherwise.

## What was built

Everything inside `os/boot/handshake-test/` plus the one Makefile routing
target (`make os-uboot-handshake-test`):

- `Dockerfile` — `src` stage (kept from the spike's first pass: toolchain +
  the SAME U-Boot commit pin as the board build) + `build` stage
  (sandbox_defconfig, board env contract, 2048 MiB RAM, mmc node appended to
  the sandbox DT, `.config` assertions in the board-Dockerfile style, a
  headless smoke test that mmc 0 binds) + scratch `artifact` stage exporting
  `u-boot`, `u-boot.dtb`, `mkimage`, `mkenvimage`.
- `run.sh` — builds once (network only here), caches artifacts under
  `_out/handshake-test/`, then runs the harness in the builder image with
  the repo mounted read-only. Offline on every subsequent run.
- `harness.sh` — fabricates fixtures in the mkimage-v2-selftest style
  (synthetic Image/dtb, one-line `verity_args=` env files, FAT slots, the
  GPT above, `mkenvimage -r` seeded env), then drives three scenarios:
  1. decrement persists 3→2→1→0 across invocations (slot A), the other
     slot is chosen at zero (A=0 → B), B decrements 2→1→0, both-zero
     refills to 3/3 with `mos: no bootable slot left` and no slot booted
     that cycle, and the post-refill cycle boots A again — with the exact
     chosen-slot banner `mos: booting slot X (A=n B=m left)` asserted every
     cycle, plus the absence of `booti returned`/`saveenv FAILED`;
  2. a slot missing `mos-verity-a.env` (and the unsuffixed fallback —
     asserted absent in the fixture, anti-vacuity) is burned to 0 after the
     decrement, and the next invocation moves to slot B;
  3. booti runs, fails natively, and the script burns the slot it tried.
  PASS/FAIL per assertion, non-zero exit on any FAIL.

## Measurements

- 72 PASS / 0 FAIL / `RESULT: PASS`, exit 0, across 3 scenarios and 11 boot
  cycles (each a separate sandbox process) plus one counter-readout process
  per cycle.
- End-to-end `make os-uboot-handshake-test` with the sandbox-build layer
  uncached but the src stage cached: 1 m 06 s (sandbox U-Boot compiles in
  ~30 s at -j8; it is a small fraction of a board build). Fully cached,
  offline run: 28 s wall, of which the harness itself (fixtures + 22 sandbox
  invocations) is the bulk; each boot cycle is well under a second.
- Artifacts cached under `_out/handshake-test/`: `u-boot` 13 MiB (sandbox
  ELF), `u-boot.dtb` 17 KiB, `mkimage`, `mkenvimage`.
- Cycle endings observed exactly as designed: rc=134 (SIGABRT at the
  emulated kernel handoff), rc=1 (script `reset` through the poisoned
  argv[0] re-exec). rc=0 never occurs — asserted, since it would mean
  boot.scr fell off its own end.

## Blockers hit and resolved

- The spike's first pass died mid-Dockerfile with only the `src` stage
  written; the stage was correct (same commit pin, and it already carried
  mtools/dosfstools/gdisk for fixture work) and was kept verbatim — its
  cached image (`mos-hs-src`) made every rebuild cheap.
- `sandbox_defconfig` does not build in a plain toolchain container: EFI
  capsule authentication wants `cert-to-efi-sig-list` (efitools) at build
  time (Error 127 at `lib/efi_loader/Makefile` `capsule_esl_file`). Rather
  than grow the toolchain for a subsystem the handshake never touches,
  `EFI_LOADER` is off — which forces `UNIT_TEST` off (test/boot/bootflow.c
  links EFI symbols unconditionally) which forces `UPL`/`CMD_UPL` off
  (cmd/upl.c links the test suite's `upl_get_test_data`; `CMD_UPL` declares
  no Kconfig dependency on `UNIT_TEST`). Three link-error iterations at
  ~90 s each; all four disables are asserted or self-evident in the build.
- The real spike finding among the blockers: enabling `ENV_IS_IN_MMC` is NOT
  sufficient on sandbox. `board/sandbox/sandbox.c` overrides
  `env_get_location()` with a hardcoded priority list {NOWHERE, EXT4, FAT,
  SPI_FLASH}; `ENVL_MMC` is never offered, and env/env.c's driver-lookup
  loop stops at the first priority with no compiled driver, so the board
  dies at the `env_init()` initcall (-ENODEV, "Please RESET the board").
  Fixed by a one-word substitution in the CONTAINER's U-Boot checkout
  (`ENVL_NOWHERE` → `ENVL_MMC`, first slot), asserted in the build. This is
  a harness-binary patch in the same spirit as the board Dockerfile's DTS
  append — the shipped script and the shipped board build are untouched.
- The sandbox console colorizes output; `printenv` values arrive with a
  trailing ANSI escape. The readout parse captures leading digits only.

## What this spike does NOT cover (honest scope)

- The env DRIVER binding differs: the board writes eMMC through the Rockchip
  MMC stack; sandbox writes a mmap. Offsets, redundancy scheme and env
  format are shared; the storage path is not. A saveenv-failure injection
  (the script's `saveenv FAILED` warning line) needs a different fixture and
  is not exercised.
- `bootargs` correctness (verity_args splice, rauc.slot=) is invisible here:
  nothing consumes bootargs on sandbox. The mkimage-v2 selftest pins the
  contract from the other side.
- The `Cannot map sandbox address` abort is an emulation of "control left
  U-Boot", not of a hang; nothing here can observe a slot that boots and
  LATER gets marked good (that requires the fw_setenv/rauc side, which is
  userspace and out of scope for a U-Boot harness).

## Recommendation

Adopt the harness as a durable regression gate for `cx3576-boot.cmd`, with
its scope stated honestly: it proves the HANDSHAKE STATE MACHINE (selection,
decrement-before-boot persistence, failover, refill, both burn paths, the
exact console contract lines) against the real hush parser, the real env
machinery at the real offsets, and the real FAT/GPT geometry — it does not
prove kernel handoff, bootargs consumption, or the Rockchip storage path.
Follow-ups worth considering, none blocking:

- Wire `os-uboot-handshake-test` into whatever CI lane runs the other
  docker-needing targets (`os-repart-test` precedent); the image caches make
  it cheap after the first build.
- A saveenv-failure fixture (exercising the script's watchdog-disarmed
  warning line) would need the mmc backing file made read-only mid-cycle;
  feasible but left out of the spike.
- If `cx3576-boot.cmd` ever grows a path that must NOT reach `reset`, the
  poisoned-argv[0] trick stops distinguishing it; revisit the execution
  model note in harness.sh before extending.
- The upstream facts this harness leans on (mmap-backed sandbox mmc,
  booti_setup's unconditional failure, os_relaunch semantics,
  env_get_location override) are pinned by the UBOOT_COMMIT build arg; a
  future U-Boot bump re-runs the same assertions and will fail loudly, not
  silently, if any of them shifts.
