# PLAN-075 Ship the firewall tools in the base image, with no policy

- **status**: completed
- **createdAt**: 2026-09-03 19:40
- **approvedAt**: 2026-09-03 19:40 (the request itself; see *Approval boundary*)
- **relatedTask**: RFCT-296

## Approval boundary

The user asked for this change directly and in detail -- which package the
dependency goes in, what the verify check must assert, what the record must
measure, and what is explicitly out of scope. That request is the approval, and
it is the approval for exactly that scope: a dependency, a check, a measurement
and three sentences of operator documentation. It is not approval for a rule
set, a policy, a persistence mechanism, a management surface, or moving
`nftables` out of `mos-podman`. Those are listed under *Not in scope* below and
the diff must not contain them.

## Context

Measured on this tree at `354dac69`, before any edit.

**The base package has no firewall tool.**
`rootfs/packages-src/system/control/mos-system.control` declares
`Depends: systemd, systemd-sysv, systemd-resolved, systemd-repart,
systemd-timesyncd, udev, dbus, kmod, openssh-server, iproute2,
libubootenv-tool, curl, passwd`. Nothing there can read or write a netfilter
rule.

**`nftables` reaches the image only through the container engine.**
`pkgs/podman/deb/podman/control/mos-podman.control` declares it and says why in
its own words: netavark 2.1.0 has three firewall drivers (Firewalld, Nftables,
Fwnone), the iptables driver was removed in 2.x, nftables is the compile-time
default, and netavark runs `nft` off PATH -- without it the first `podman run`
fails with "netavark: nftables error: unable to execute nft". `mos-podman` is
selected by `rootfs/packages/feature-containers.pkgs`, which a board declines
with `WITH_CONTAINERS=0`. So the profile that declines containers has no
firewall tooling at all, and that is the hole this plan closes.

**What `iptables` costs, measured.** A clean `debian:trixie-slim` at the pinned
digest `IMAGE_DEBIAN_TRIXIE`, with `mos-system`'s current Depends installed
`--no-install-recommends` (144 packages, 184965 KiB), then `iptables` added the
same way:

| package | version | installed KiB |
|---|---|---|
| `iptables` | 1.8.11-2 | 2406 |
| `libnftnl11` | 1.2.9-1 | 244 |
| `libnetfilter-conntrack3` | 1.1.0-1 | 144 |
| `libip4tc2` | 1.8.11-2 | 66 |
| `libip6tc2` | 1.8.11-2 | 66 |
| `libnfnetlink0` | 1.0.2-3 | 51 |
| `netbase` | 6.5 | 35 |
| **total** | | **3012** |

Seven packages, 151 from 144, and 3012 KiB installed (187977 from 184965 KiB) --
2.9 MiB. The archives are 535 KB of download. Two entries are worth naming
because they are not what the request predicted: **`libmnl` is NOT dragged in**,
because `iproute2` already depends on it and the base root has it; and
**`netbase` is**, unpredicted, because `iptables` needs `/etc/protocols` and
`/etc/services` to name a protocol or a port. The biggest single file is
`/usr/sbin/xtables-nft-multi` at 228768 bytes; the rest of the weight is the
`/usr/lib/*/xtables/lib*.so` match and target modules.

**And on the image the project actually ships, it is SIX and 2768 KiB.** The
composed x64 dev root before this change (`/srv/mos/_out/x64/rootfs-report.txt`,
pool stamp `git882429eb3dab-1`) carries 208 packages and 450035 KiB; the one
composed from this branch (pool stamp `git84e54597e84d-1`) carries 214 and
452803 KiB. `882429eb` is an ancestor of this branch and the only commit between
the two that touches `rootfs/`, `boards/`, `pkgs/` or `build-env/` is this
change, so the delta is attributable. The seventh package is missing from it
because **`libnftnl11` was already there**: `nftables` depends on it and
`nftables` arrives with `mos-podman`. Both numbers are true of different images
-- 3012 KiB is what a container-less profile pays, 2768 KiB is what the shipped
dev image pays -- and the package description states both.

**What `nftables` in the base would cost, measured the same way**, since the
report has to answer it: on a trixie root that already has `iptables`, adding
`nftables` is three packages and 1339 KiB (`nftables` 185, `libnftables1` 1054,
`libjansson4` 100), and it brings `/usr/lib/systemd/system/nftables.service`
with it -- a unit that loads `/etc/nftables.conf` at boot, which is a
persistence mechanism this plan's scope explicitly excludes and which would then
need an enablement decision.

**On trixie, `iptables` IS `iptables-nft`.** `update-alternatives --display
iptables` in that root reports auto mode, `/usr/sbin/iptables-nft` at priority
20 against `/usr/sbin/iptables-legacy` at priority 10, and the link resolving to
the nft side. The chain is `/usr/sbin/iptables` -> `/etc/alternatives/iptables`
-> `/usr/sbin/iptables-nft` -> `xtables-nft-multi`, and `iptables --version`
answers `v1.8.11 (nf_tables)`. The legacy binaries ARE in the image --
`/usr/sbin/xtables-legacy-multi`, 91112 bytes, with `iptables-legacy`,
`iptables-legacy-save` and `iptables-legacy-restore` pointing at it, all from
the same `iptables` package -- and nothing in this image selects them: the
alternatives group is left in auto mode, no `update-alternatives --set` runs
anywhere in `rootfs/`, and no unit or script names the legacy front-end.

**Two front-ends, one backend.** `iptables-nft` programs the same `nf_tables`
kernel subsystem netavark writes to, so on a device with containers there are
two writers and one backend. They are not symmetric views: `iptables -S` lists
only what the iptables front-end created, in the `filter`/`nat`/`mangle` tables
it owns, while `nft list ruleset` lists the whole subsystem including netavark's
own `netavark` table. The complete view is `nft list ruleset` -- and `nft` is in
the image only when containers are, which is the same conditional this plan
leaves alone.

**Nothing persists, and one file in the composed image looks like it might.**
No `netfilter-persistent`, no `iptables-save` unit, nothing in
`rootfs/overlay/`, and the root is a read-only verity image. But the composed
x64 root DOES carry `/etc/nftables.conf` and
`/usr/lib/systemd/system/nftables.service`, both from the `nftables` package
that arrives with `mos-podman` -- a fact that predates this change. The unit is
NOT enabled: no `.wants` link anywhere in the packed root names it, and the two
system presets the image ships (`50-mos-ssh.preset`, `90-systemd.preset`) do
not either. It never runs, which is the answer in both directions, because its
`ExecStart` is `nft -f /etc/nftables.conf` and that file begins with
`flush ruleset` -- enabling it would clear netavark's tables at every boot. The
operator page states this rather than claiming the image has no rule file in
it, which is the claim that would have been false.

**The register's shape.** `verify/src/checks.ts` concatenates one family per
module; `verify/src/checks-busybox.ts` is the closest precedent -- one package,
one binary, present-and-executable plus the negatives around it -- and
`verify/src/checks-busybox.test.ts` drives each of them red from a fixture
asserted green first. `verify/src/checks-fixture.ts`'s `packedRootFixture`
seeds the healthy root the tests mutate.

## Proposal

1. **`rootfs/packages-src/system/control/mos-system.control`**: add `iptables`
   to `Depends`, after `iproute2`, and add one description paragraph in the
   file's existing voice -- what the tool is, that on trixie it is the nft
   front-end, and that the package ships no rule and no policy.

2. **`verify/src/checks-iptables.ts`**, a new family with two checks:
   - `packed-iptables-present` -- `iptables` resolves through the image's own
     PATH directories and its symlink chain, INSIDE the root, to a regular file
     with an execute bit. The chain is the assertion and not a detail: on trixie
     the name is an alternatives link three hops from the binary, and a dangling
     `/etc/alternatives` entry is exactly the shape a `[ -e ]` test resolves
     against the verifier host instead.
   - `packed-iptables-nft-backend` -- that endpoint is the nft multi-call
     binary and not `xtables-legacy-multi`. This is the check that keeps the
     operator documentation true: the two front-ends write different kernel
     rule stores, so a silent flip to legacy would leave an operator's rules
     invisible to `nft list ruleset` and unrelated to netavark's, with every
     other check green.

3. **`verify/src/checks-iptables.test.ts`**: the negative tests. A root without
   the binary, a chain that dangles, a binary with no execute bit, and an
   alternatives link re-pointed at the legacy multi-call -- each from a fixture
   asserted green first.

4. **`verify/src/checks-fixture.ts`**: seed the alternatives chain into the
   healthy packed root, in the shape the composed image has it.

5. **`verify/src/checks.ts`**: register the family.

6. **`docs/user/security.md`** and **`docs/zh/user/security.md`**: the three
   statements, under *Network exposure*, in the same commit.

## Not in scope

Any default rule set, any allow/deny policy, `netfilter-persistent`, an
`iptables-save`/`restore` unit, a management API, a console surface, and moving
`nftables` out of `mos-podman`.

## Risks

- **The name reads as a firewall.** An image that ships `iptables` and no policy
  can be read as "mos has a firewall now". Mitigated only by saying the opposite
  plainly in the operator page and in the package description, which is why both
  are in the scope above rather than optional.
- **A second front-end over one backend.** On a device with containers an
  operator can now write rules into the same subsystem netavark reconciles.
  Rules in netavark's own table will be reverted by netavark; that is stated in
  the documentation rather than prevented, because preventing it is policy.
- **3 MiB on every image, including profiles that will never write a rule.**
  Accepted: the alternative is a feature set, and a tool an operator reaches for
  when the network is wrong is worth nothing if the build in their hands
  declined it -- the same argument `rootfs/packages/common.pkgs` already records
  for `mos-busybox`.
- **`packed-iptables-nft-backend` goes red on a Debian rename.** If trixie ever
  renamed `xtables-nft-multi` the check would fail on a correct image. Accepted:
  the check names the file it found, so the failure is one line to read, and the
  alternative is a check that cannot see the failure it exists for.

## Scope

Seven files: one control file, three verify sources (two new), one verify test
(new), and the two `security.md` pages.

## Alternatives

- **A new `mos-firewall` package.** Rejected: there is no payload. The package
  would exist only to hold one `Depends` line, and `mos-system` is already where
  base tooling beside `iproute2` and `curl` is declared.
- **A `feature-firewall.pkgs` set.** Rejected for `common.pkgs`'s own reason: a
  declinable firewall tool is absent from exactly the image whose operator needs
  it, and nothing at the time of the build knows which one that is.
- **`nftables` in the base instead of, or beside, `iptables`.** Not taken here
  and deliberately not decided in this diff -- it is a question the user has not
  answered, so it belongs in the report. See *Annotations*.
- **Assert presence with `resolvesInRoot` from `script-commands.ts`.** Rejected:
  it answers a boolean and this check has to name the chain and the endpoint,
  which is the whole content of the alternatives question.

## Annotations

- 2026-09-03: the user's request is the approval; recorded at the top of this
  file and in RFCT-296's Notes.
- 2026-09-03: **open question, for the report and not for this diff** -- should
  `nftables` also be in the base? Today it is in the image only when containers
  are, so the complete rule view (`nft list ruleset`) is available only on a
  device that runs containers, while `iptables` from this change is everywhere.
  The recommendation is yes, in a later change: measured at three packages and
  1339 KiB, it is the only tool that can show netavark's tables, and an operator
  debugging a rule on a container-less device currently has the front-end that
  cannot show them the whole subsystem. It is NOT quite a one-line change, which
  is the other half of the answer: the `nftables` package ships
  `nftables.service`, a unit that loads `/etc/nftables.conf` at boot. That is a
  persistence and policy surface, exactly what this task excludes, so putting
  the package in the base means deciding about that unit's enablement in the
  same change. It is not in this diff because it was not asked for.
- 2026-09-03: **that question is ANSWERED -- ship both.** The user chose to have
  the compatibility front-end alongside the native one, so `mos-system` depends
  on `nftables` and `iptables`. The half of the recommendation that was a
  caveat -- `nftables.service` and its `flush ruleset` -- became a requirement
  rather than an objection, and is delivered as
  `50-mos-nftables.preset`. See *Round 2*.
- 2026-09-03: **`nftables` stays in `mos-podman`'s `Depends`**, decided by the
  user, and this is not a duplication to clean up later. Recorded in both
  control files so that the reader who finds it there does not have to come
  here to learn why.

## Outcome

Delivered as proposed, with two corrections the measurements forced and one
message fix the composed image forced.

**What shipped.** `iptables` in `mos-system`'s `Depends` with a description
paragraph naming what it is and is not; `verify/src/checks-iptables.ts` (renamed
to `checks-firewall.ts` in *Round 2* below, as are the two references after
this one) with
`packed-iptables-present` and `packed-iptables-nft-backend`; the alternatives
chain seeded into `packedRootFixture` in the four-hop shape the composed root
really has; thirteen tests in `verify/src/checks-iptables.test.ts`, four of them
driving a check red and one of them proving the chain is not resolved against
the verifier host; and section 5.1 of `docs/user/security.md` with its Chinese
mirror.

**Verification, at this branch.**

| gate | result |
|---|---|
| `make os-debs` (both architectures) | exit 0, 16 archives per pool |
| `bash tests/deb-package-gate.sh` | PASS 264/264 |
| `bash tests/install-closure-gate.sh` | PASS 99/99, 14 clean roots, 2 architectures |
| composed x64 image + `bash verify/run.sh --verify --board x64` | PASS 309/309, 22 skipped |
| `bash verify/run.sh` | PASS 1237/1237 |
| `bash build/run.sh` | PASS 869/869 |
| `make docs-verify` | PASS across all five checkers |

The two new conclusions on the real image read:

    PASS: iptables is executable in the packed root: /usr/sbin/iptables ->
      /etc/alternatives/iptables -> /usr/sbin/iptables-nft ->
      /usr/sbin/xtables-nft-multi, mode 0755, 228768 bytes
    PASS: the iptables alternatives group is the nf_tables front-end: all of
      iptables, iptables-save, iptables-restore end at xtables-nft-multi ...
      /usr/sbin/xtables-legacy-multi ships beside it, from the same Debian
      package, and nothing resolves to it

**Three corrections, each from a measurement rather than a re-reading.**

1. The closure is six packages and 2768 KiB on the shipped image, not seven and
   3012 -- `libnftnl11` arrives with `nftables` and `nftables` arrives with
   `mos-podman`. Both numbers are in the package description, each labelled with
   the image it is true of.
2. "No rule file anywhere in the image" was false: `/etc/nftables.conf` and
   `nftables.service` are in the composed root, from the same `nftables`
   package. Neither is enabled -- no `.wants` link names the unit and neither
   shipped preset enables it -- so nothing runs them, and the operator page says
   that rather than claiming the files are absent.
3. `packed-iptables-nft-backend` first reported
   `/usr/sbin/xtables-legacy-multi /sbin/xtables-legacy-multi`, two names for
   one inode on a usr-merged root, which reads as two legacy binaries. Deduped
   by `(dev, ino)`, with a test that seeds the `/sbin` link.

**One observation worth keeping**, from `tests/install-closure-gate.sh`'s
transcript of the postinst:

    update-alternatives: using /usr/sbin/iptables-legacy to provide
      /usr/sbin/iptables (iptables) in auto mode
    update-alternatives: using /usr/sbin/iptables-nft to provide
      /usr/sbin/iptables (iptables) in auto mode

Both front-ends are registered in one transaction and the group is pointed at
legacy first and then at nft, because priority decides and nft's is higher. Only
the final state ships; but the intermediate is a real state the package passes
through, and it is the reason the second check asserts the endpoint rather than
trusting that "trixie means nft".

**What was NOT done.** No rule set, no policy, no `netfilter-persistent`, no
save/restore unit, no API, no console surface, and `nftables` was not moved out
of `mos-podman`. RFCT-296's Notes say the same thing in the same words, because
"the image ships iptables" is a sentence that reads as a firewall to anyone who
does not read the next one.

**One operational finding, not about this change.** `tests/deb-package-gate.sh`
and `tests/install-closure-gate.sh` CANNOT RUN CONCURRENTLY. The package gate's
reproducibility leg rebuilds a producer, and `build-env/deb/build.sh` removes
that producer's archives from the pool before writing the new ones -- its own
comment says the pool ends with no archive for the producer -- so a closure gate
copying the pool at that moment gets an index that names
`mos-board-cx3576_..._arm64.deb` and a pool that does not hold it. Run
concurrently once here, the closure gate reported FAIL 79/105 with `apt-get
install exited 100` and "File not found - /dist/pool/mos-board-cx3576...".
Re-run alone against the same pool it is PASS 99/99. The failure was the
scheduling, not the tree, and the gate's own vacuity guards are what made it
loud rather than green over an empty root.

**Build inputs borrowed, disclosed.** This worktree is a fresh checkout, so
three gitignored artefact trees were reused rather than rebuilt:
`pkgs/podman/out-{amd64,arm64}` and `pkgs/rauc/out-{amd64,arm64}` copied from
`/srv/mos` after `pkgs/podman/versions-stamp.sh --check` accepted both, and
`BOARD_DIR=/srv/mos/boards/cx3576/bsp` for the cx3576 kernel, dtb, modules and
u-boot that `make os-debs` and the package gate's reproducibility rebuild need.
Nothing was written into `/srv/mos`. The x64 half -- the composition, the image
and the verifier run -- reads none of those inputs.

## Round 2: both front-ends, and the preset

Round 1 shipped `iptables` alone and put one question back to the user: should
`nftables` also be in the base? The answer was **ship both**, and it supersedes
everything above that reads as "iptables only". The *Context* section is left as
it was written -- it is the measurement round 1 made, and it is what the answer
was decided against.

### The end state

`mos-system` depends on **`nftables` and `iptables`**. `nft` is the native
front-end and the complete view; `iptables` is the compatibility path for
third-party tooling and operator habits that cannot speak nft.

`nftables` **stays** in `mos-podman`'s `Depends`, and both control files now say
why so that a future reader does not remove it as a duplicate: a package that
needs a tool declares it. `mos-podman` needs `nft` because netavark execs it off
PATH; `mos-system` carries it because the base image's firewall vocabulary is nft
whether or not containers are present. Two independent true statements about two
packages, and the contents of the base package are not something `mos-podman`
may assume.

### The preset, which is a requirement and not a caveat

Round 1 argued `nftables` should not be a one-line base dependency, because the
package ships `nftables.service`, its `ExecStart` is `nft -f
/etc/nftables.conf`, and that config begins with `flush ruleset` -- an enabled
unit clears netavark's container-network rules at every boot. Shipping the
package anyway turns that argument into work, and the work is one file.

`mos-system` now ships
`/usr/lib/systemd/system-preset/50-mos-nftables.preset` containing
`disable nftables.service`, in the shape `50-mos-ssh.preset` established, and
the postinst asserts the outcome the way it does for `ssh.service` -- an
assertion, not the mechanism.

**Why an absence was not good enough, measured** in a clean `debian:trixie-slim`
at the pinned digest with `systemd` and `nftables` installed:

- No preset in the image matched `nftables.service` at all -- not
  `90-systemd.preset`, not `50-mos-ssh.preset`.
- `systemctl --root=<copy> preset nftables.service` with that stock set printed
  `Created symlink '/etc/systemd/system/sysinit.target.wants/nftables.service'`.
  **The unmatched fallback is enable.**
- With `disable nftables.service` added as a preset file, the same command wrote
  nothing.

So the unit being unenabled today is an ABSENCE, and one `systemctl preset-all`,
one future preset file or one upstream packaging change turns it into a boot
that flushes the ruleset. The file makes it a decision the tree owns and states.

### Verify

The family moved from `checks-iptables.ts` to
**`verify/src/checks-firewall.ts`** -- it is no longer about one tool -- and now
carries four checks:

- `packed-nft-present` -- `nft` resolves through PATH and its symlink chain,
  inside the root, to a regular executable file.
- `packed-nftables-service-disabled` -- the unit is in the root, no `.wants` or
  `.requires` link names it, and the first preset rule that claims it is a
  `disable`. All three, because the third is the one that is easy to omit: a
  root with no link and no rule is correct today and one preset-all from the
  failure, and a check that counted links would call it green.
- `packed-iptables-present` and `packed-iptables-nft-backend` -- unchanged from
  round 1 and kept deliberately. The second was offered up as beyond the literal
  ask and the answer was to keep it: statement 1 is otherwise prose that rots
  silently.

`packed-nft-present` deliberately coexists with `checks-engine.ts`'s
`container-engine-nft`. They are two independent statements that share a binary,
exactly as the two `Depends` entries are: the engine check asks whether the
container engine can run and is scoped with the engine family, this one asks
whether the base image has its firewall vocabulary and is true of an image that
declines containers. `checks-firewall.test.ts` asserts their matchers cannot
claim each other's conclusions, generically and again by name.

Preset resolution is systemd's, not a grep: files are masked by basename across
`/etc`, `/run` and `/usr/lib` in that precedence order, the merged set is read
in basename order, and the FIRST matching rule wins with `*`/`?` globbing. A
grep for `disable nftables.service` would find its line and report green over a
root where an `enable nftables.*` in a file sorting earlier is what systemd
would obey. Two tests cover exactly that -- an earlier-sorting `enable`, and an
`/etc` file masking the shipped one -- and one covers the vacuity case where the
unit itself is gone.

Twenty-four tests in the family; ten drive a check red.

### The cost, measured again, because the attribution moved

On a clean `debian:trixie-slim` holding `mos-system`'s other dependencies (144
packages, 184965 KiB), installing **both** `nftables` and `iptables`
`--no-install-recommends` gives 154 packages and 189316 KiB: **ten packages,
4351 KiB installed, 983180 bytes of archives.**

| package | version | installed KiB |
|---|---|---|
| `iptables` | 1.8.11-2 | 2406 |
| `libnftables1` | 1.1.3-1 | 1054 |
| `libnftnl11` | 1.2.9-1 | 244 |
| `nftables` | 1.1.3-1 | 185 |
| `libnetfilter-conntrack3` | 1.1.0-1 | 144 |
| `libjansson4` | 2.14-2+b3 | 100 |
| `libip4tc2` | 1.8.11-2 | 66 |
| `libip6tc2` | 1.8.11-2 | 66 |
| `libnfnetlink0` | 1.0.2-3 | 51 |
| `netbase` | 6.5 | 35 |
| **total** | | **4351** |

**On the shipped x64 dev image the closure delta is unchanged from round 1: six
packages and 2768 KiB**, 450035 KiB over 208 packages before to 452804 over
214. The one KiB that is new since round 1's 452803 is
`50-mos-nftables.preset` -- this package's own payload, not a dependency's.
Adding `nftables` to the base costs that image nothing, because
`nftables`, `libnftables1`, `libjansson4` and `libnftnl11` were already in it
through `mos-podman`. What moved is the ATTRIBUTION, not the bytes: those four
are now there by two declarations instead of one.

**The profile this decision actually changes is the container-less one, and it
pays 4351 KiB where round 1 had it paying 3012.** That is the number to quote
when someone asks what the base firewall vocabulary costs: ten packages and
4.2 MiB on an image that declines containers, and nothing at all on one that
does not.

### Verification

| gate | result |
|---|---|
| `make os-debs`, both architectures | exit 0, 16 archives per pool |
| `bash tests/deb-package-gate.sh` | PASS 264/264, 1390 payload paths (1388 in round 1; the preset is the two) |
| `bash tests/install-closure-gate.sh` | PASS 99/99, 14 clean roots, 2 architectures |
| composed x64 image + `bash verify/run.sh --verify --board x64` | PASS 311/311, 22 skipped |
| `bash verify/run.sh` | PASS 1248/1248 |
| `bash build/run.sh` | PASS 869/869 |
| `make docs-verify` | PASS across all five checkers |

The four conclusions on the real image:

    PASS: nft is executable in the packed root: /usr/sbin/nft, mode 0755,
      26776 bytes
    PASS: nftables.service is disabled by a preset:
      /usr/lib/systemd/system/nftables.service is in the root, no .wants or
      .requires link names it, and the first preset rule that claims it is
      'disable nftables.service' in
      /usr/lib/systemd/system-preset/50-mos-nftables.preset. The tool ships and
      no ruleset is loaded at boot
    PASS: iptables is executable in the packed root: /usr/sbin/iptables ->
      /etc/alternatives/iptables -> /usr/sbin/iptables-nft ->
      /usr/sbin/xtables-nft-multi, mode 0755, 228768 bytes
    PASS: the iptables alternatives group is the nf_tables front-end: all of
      iptables, iptables-save, iptables-restore end at xtables-nft-multi ...

`tests/install-closure-gate.sh` also shows the postinst assertion firing in the
clean roots -- "nftables.service left DISABLED in the image (the tool ships; no
ruleset is loaded at boot)", twice, once per architecture.

Two gate runs were serialized rather than run together, on the finding recorded
above: the package gate empties a producer's archives out of the pool while it
rebuilds, and the closure gate copying the pool in that window fails on a
missing archive.

### Still not done

No rule set, no policy, no `netfilter-persistent`, no `iptables-save`/`restore`
unit, no shipped ruleset that anything loads, no management API, no console
surface, and nothing that reapplies a rule after a reboot. Two tools and one
preset that keeps a unit off.
