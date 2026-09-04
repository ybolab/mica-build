# RFCT-304 Resolve the x64/cx3576 legacy netfilter asymmetry, by measurement

- **status**: completed
- **priority**: P2
- **owner**: netfilter-legacy-asymmetry/bkd-nksjhmcu
- **createdAt**: 2026-09-04 13:50

## Description

PLAN-074 §7h recorded eleven netfilter symbols that are weaker on x64 than on
cx3576, which still asserts them in its board loop, and left the resolution to
the firewall work. PLAN-073 had excluded them from the shared floor as policy,
on the then-true premise that nothing in the image used the legacy back-end.
PLAN-075 then shipped `iptables` in the base image as the documented
compatibility path — which created the consumer. So `iptables -t nat -j
REDIRECT` works on cx3576 and fails on x64: a compatibility path that is
compatible on one board and not the other.

The eleven are two different questions and were answered separately.

## ActiveForm

Measuring which netfilter symbols the shipped `iptables` actually needs.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- The measurement, with the commands and their output.
- The symbols placed with their reason, in the fragment or removed from the
  board loop, and `verify/src/checks-kernel.ts` in agreement with the fragment.
- Both boards rebuilt from this tree and re-verified with
  `verify/run.sh --verify --board {x64,cx3576}`; no artefact copied from
  another checkout.
- `tests/netavark-kernel-config-test.sh` green and in the gate table.
- `(cd verify && bun test)`, `(cd build && bun test)`, `make docs-verify` green.
- Operator documentation updated if what `iptables` can do changes, mirrored
  into `docs/zh/` in the same commit.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

## Measurement

Two subjects, because neither alone answers the question. A container on the
host kernel carrying the image's own `iptables` 1.8.11 / `nftables` 1.1.3
answers *what the front-end emits*; the x64 kernel this tree builds, booted
under QEMU on an initramfs holding that same userland plus the modules the
build produced, answers *what happens when the module is not there*.

### The hypothesis, and the correction it needed on the way

The hypothesis under test was that `iptables-nft` emits an `nft_compat` xt
expression and therefore needs the `xt_*` module even though the front-end is
nft. **It is right.** But the first run appeared to refute it, and the reason
is worth recording because it would have produced a confidently wrong answer:

`nft list ruleset` renders an `xt` expression by running it back through
libxtables' `xlate` callback, so a compat rule prints as `masquerade`,
`fib daddr type local` or `meta mark set 0x1` — exactly as a native rule does.
Classified from that text, ten of the eighteen rules looked native. Read
instead from `nft --json`, which prints the stored expression list, every one
of them is `{"xt": {...}}`. Two probes disagreeing is what forced the recheck;
the text output was the wrong instrument.

### What the kernel stores, read from `nft --json`

```
v4-masq         COMPAT counter,xt:target MASQUERADE
v4-redirect     COMPAT match,counter,xt:target REDIRECT
v4-dnat         COMPAT match,counter,xt:target DNAT
v4-checksum     COMPAT match,counter,xt:target CHECKSUM
v4-ct-notrack   COMPAT match,counter,xt:target CT
v4-ct-zone      COMPAT match,counter,xt:target CT
v4-addrtype     COMPAT xt:match addrtype,counter,accept
v4-MARK         COMPAT counter,xt:target MARK
v4-conntrack    COMPAT xt:match conntrack,counter,accept
v4-raw-accept   native counter,accept
v4-mark-match   native match,counter,accept
```

and the ip6 half identically. Only the plain verdict and the builtin matches
(`-p`, `--dport`, `-m mark`) are native.

### What absence does, on the x64 kernel itself

`6.12.107` as this tree configured it before the change, booted under QEMU:

```
PROBE-MOD  xt_REDIRECT  ABSENT modprobe: FATAL: Module xt_REDIRECT not found in directory /lib/modules/6.12.107
PROBE-RULE v4-redirect  FAIL rc=4 :: Warning: Extension REDIRECT revision 0 not supported, missing kernel module?
PROBE-RULE v4-checksum  FAIL rc=4 :: Warning: Extension CHECKSUM revision 0 not supported, missing kernel module?
PROBE-RULE v4-ct-notrack FAIL rc=4 :: Warning: Extension CT revision 0 not supported, missing kernel module?
PROBE-RULE v6-redirect  FAIL rc=4 :: Warning: Extension REDIRECT revision 0 not supported, missing kernel module?
PROBE-RULE v6-checksum  FAIL rc=4 :: Warning: Extension CHECKSUM revision 0 not supported, missing kernel module?
PROBE-RULE v6-ct-notrack FAIL rc=4 :: Warning: Extension CT revision 0 not supported, missing kernel module?
```

The rule is **refused**, with an error naming the missing module — not a silent
no-op. The `=m` half of the split behaves the other way and the measurement
says so: `xt_MASQUERADE`, `xt_mark`, `xt_addrtype`, `xt_nat` all `RESOLVES`,
their rules all `OK`, and `PROBE-LSMOD` shows the kernel autoloaded each one
from the root on demand. **That half was cosmetic**, which is what the run was
there to decide rather than assume.

### The legacy tables answer the other way

`iptables-nft` builds `raw`, `nat`, `mangle` and `filter` in nf_tables. On the
same kernel, which sets `# CONFIG_IP_NF_RAW is not set`:

```
PROBE-RULE  v4-raw-accept OK native counter,accept
PROBE-RULE  v6-raw-accept OK native counter,accept
PROBE-LEGACY v4-raw rc=3 :: can't initialize iptables table `raw': Table does not exist
PROBE-LEGACY v6-nat rc=3 :: can't initialize ip6tables table `nat': Table does not exist
```

The only front-end that needs `IP_NF_*` / `IP6_NF_*` is `iptables-legacy`, and
nothing in this tree selects it: the alternatives group is left in auto mode
where nft outranks legacy, and `update-alternatives` is run nowhere here.

## Decision

**The `xt_*` half is floor.** Eight symbols moved into
`boards/common/mos-required.fragment`: `NETFILTER_XT_MARK`, `_NAT`,
`_MATCH_ADDRTYPE`, `_MATCH_CONNTRACK`, `_TARGET_CHECKSUM`, `_TARGET_CT`,
`_TARGET_MASQUERADE`, `_TARGET_REDIRECT`. cx3576's board loop stops restating
the seven it carried.

Eight rather than the six `xt_*` of PLAN-074 §7h's eleven:
`NETFILTER_XT_MATCH_CONNTRACK` had to move because cx3576's loop stopped
restating it and the assertion needed a home, and `NETFILTER_XT_NAT` is the
same `=y`-there/`=m`-here split as `TARGET_MASQUERADE` — not on §7h's list,
which was derived from what an earlier floor swap dropped rather than from
what the front-end needs. A nat compatibility path that answers `-j MASQUERADE`
and leaves `-j DNAT` a class weaker would keep the defect open.

**The `IP_NF_*` / `IP6_NF_*` half is not floor, and is not asserted anywhere
any more.** cx3576's loop dropped all ten legacy entries. No config changed on
that board — the vendor config still sets them — but an assertion that made a
leftover look like a requirement is gone.

## Size cost

| | before | after | delta |
|---|---|---|---|
| x64 `bzImage` | 14,971,904 B | 14,980,096 B | **+8,192 B, +0.055 %** |
| x64 `modules.tar` | 337,920 B | 286,720 B | −51,200 B |
| x64 loadable modules | 8 | 4 | −4 |
| cx3576 `Image` | 44,493,312 B | 44,493,312 B | **0 B** |

x64 is `=y` payload: permanent kernel RAM in both A/B slots against
`BOOT_SIZE_MIB`, and 8 KiB against a 96 MiB boot partition constrains nothing.
cx3576 is zero because its committed vendor config already set all eight `=y`.

**The cx3576 comparison is by size, not by hash.**
`boards/cx3576/bsp/kernel/Dockerfile` pins none of `KBUILD_BUILD_TIMESTAMP`,
`_USER` or `_HOST` — x64's does — so two builds of one unchanged tree already
differ. The two `Image` files have equal size and different sha256
(`559d7669…` before, `5bb2f1b2…` after); that difference is the build clock,
not this change. Recorded, not fixed.

## Found and deliberately NOT closed

The same run against the rebuilt x64 kernel found four more board differences
of exactly this class. Each needs a *direction* chosen — add the capability to
the board that lacks it, or take it from the board that has it — which is a
decision about what the product's compatibility path guarantees rather than a
measurement, so it is recorded in `docs/design/boards.md` §4.2.3 and left open:

| Extension | Symbol | x64 | cx3576 |
|---|---|---|---|
| `-m multiport` | `NETFILTER_XT_MATCH_MULTIPORT` | refused | works |
| `-m comment` | `NETFILTER_XT_MATCH_COMMENT` | refused | works |
| `-j CT --zone` | `NF_CONNTRACK_ZONES` | refused | works |
| `-j LOG` | `NETFILTER_XT_TARGET_LOG` | works (`=m`) | **refused** |

`-j LOG` runs the other way, so the board with the weaker surface is not the
same board for every rule. `-m limit` and `-m iprange` are refused on both.

## Not changed

- **x64's partial legacy surface.** `IP_NF_IPTABLES`, `IP_NF_FILTER`,
  `IP_NF_MANGLE`, `IP_NF_NAT` (`=m`) and the ip6 filter/mangle pair stay
  whatever `x86_64_defconfig` resolves; `raw` is absent in both families and
  ip6 `nat` too. Trimming it is a subtraction with its own size argument and no
  consumer asking either way.
- **`NETFILTER_XT_TARGET_REJECT` / `_TCPMSS`.** `=y` on both boards, so no
  asymmetry; pinning everything that happens to agree is a different task.
- **cx3576 kernel reproducibility**, above.
- **`docs/plan/index.md`, `docs/task/index.md`, `docs/CHANGELOG.md`** — L1 owns
  them.

## Gate results

Everything below ran at `06303fb6`, the merge with `main`, from artefacts
rebuilt out of this tree: both pools, both roots, both images. Neither board is
verified against a copied image — the cx3576 run's `factory: BOOT-A/BOOT-B
Image matches the local BSP artifact` compares against the `Image` this
worktree built, and x64's kernel checks read the `/boot/config-*` the image
carries.

| gate | result |
|---|---|
| `verify/run.sh --verify --board x64` | PASS 313/313, 0 FAIL, 22 skipped (x64/grub) |
| `verify/run.sh --verify --board cx3576` | PASS 416/416, 0 FAIL, 3 skipped (cx3576/uboot) |
| `tests/netavark-kernel-config-test.sh` | PASS 87/87 |
| `cd verify && bun test` | 1264 pass, 0 fail |
| `cd build && bun test` | 869 pass, 0 fail |
| `make docs-verify` | 5/5 sections, 1637 checks, 0 FAIL |
| x64 compose | 296 MB of 520 MB |
| x64 kernel gate | all 54 mos-required options set |
| cx3576 kernel gate | all 54 mos-required options set |

The x64 image checks name the new symbols directly, which is what makes them
more than a config diff:

```
PASS: the shipped kernel config builds in ... NETFILTER_XT_MARK, NETFILTER_XT_NAT,
      NETFILTER_XT_MATCH_ADDRTYPE, NETFILTER_XT_MATCH_CONNTRACK,
      NETFILTER_XT_TARGET_CHECKSUM, NETFILTER_XT_TARGET_CT,
      NETFILTER_XT_TARGET_MASQUERADE, NETFILTER_XT_TARGET_REDIRECT ...
PASS: modprobe resolves ... xt_mark, xt_nat, xt_addrtype, xt_conntrack,
      xt_CHECKSUM, xt_CT, xt_MASQUERADE, xt_REDIRECT as built in ...
      Every object named by the 4 modules.dep entry/entries this root ships is present
```

That last clause is the one to keep an eye on. Moving four symbols from `=m`
to `=y` shrank this root's loadable-module set from 8 to 4, and the dependency
walk's subjects with it. It is still populated, and `verify/src/checks-kernel.ts`
now states the count so the next reduction has to notice that an empty walk
would pass silently.

## Result

- complete: the shipped `iptables` now answers the same on both boards, and
  the two halves of PLAN-074 §7h's eleven were separated by measurement rather
  than by taste.

  The `xt_*` half is floor because `nft_compat` refuses a rule whose module is
  absent — measured on the x64 kernel itself, with the error it prints. The
  legacy `IP_NF_*` half is not floor because `iptables-nft` never reaches it —
  measured on the same kernel, `-t raw` succeeding natively with
  `IP_NF_RAW` unset while `iptables-legacy -t raw` refuses.

  The hypothesis under test was right, and the first instrument was wrong:
  `nft list ruleset` renders an xt expression through libxtables' xlate
  callback, so ten of eighteen compat rules read as native until the same run
  was repeated against `nft --json`. Two probes disagreeing is what caught it.
