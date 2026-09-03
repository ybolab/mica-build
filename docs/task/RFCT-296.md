# RFCT-296 Ship the firewall tools in the base image, with no policy

- **status**: completed
- **priority**: P1
- **owner**: iptables-base/session-20260903
- **createdAt**: 2026-09-03 19:40

## Description

A mos image that declines containers has NO firewall tooling at all. `nftables`
reaches the image only through `mos-podman`, whose control file records why it
is there: netavark 2.1.0 defaults to the nftables firewall driver and runs `nft`
off PATH, so without it the first `podman run` fails. That dependency belongs to
the engine and moves with it, which leaves a container-less profile with nothing
an operator can inspect or write a rule with.

Put **both `nftables` and `iptables`** in `mos-system`, the base package, beside
`iproute2` and `curl`. `nft` is the native front-end and the complete view;
`iptables` is the compatibility path for third-party tooling and operator habits
that cannot speak nft. That is the whole change. No default rule set, no
allow/deny policy, no `netfilter-persistent`, no management API and no console
surface -- the image gains two tools, not a firewall.

`nftables` STAYS in `mos-podman`'s `Depends`. A package that needs a tool
declares it: `mos-podman` needs `nft` because netavark execs it off PATH, and
`mos-system` carries it because the base image's firewall vocabulary is nft
whether or not containers are present. Two independent true statements, not a
duplication, and the base package's contents are not something `mos-podman` may
assume.

Ship the preset that keeps `nftables.service` disabled. The unit is not enabled
today only because nothing enables it, and an absence is not a decision: no
preset in the image matched the unit, and an unmatched unit presets to ENABLE.

## ActiveForm

Shipping the firewall tools in the base image with no policy.

## Acceptance

- `nftables` and `iptables` are both in `mos-system`'s `Depends`, and the
  package description says why each is written out there rather than derived,
  and why `nftables` staying in `mos-podman` is not a duplication.
- `mos-system` ships `/usr/lib/systemd/system-preset/50-mos-nftables.preset`
  with `disable nftables.service`, in the shape `50-mos-ssh.preset` establishes,
  and the postinst asserts the outcome the way it does for `ssh.service`.
- The verify register carries checks that the packed root really holds an
  executable `nft` and an executable `iptables`, that the iptables alternatives
  group ends at the nft multi-call, and that `nftables.service` is present,
  unenabled, and resolved to `disable` by the shipped presets -- each with a
  negative test, and none of them able to pass over a root that lost the thing
  it is about.
- The closure both packages drag in, and the size they cost, are measured on a
  clean root and on the composed image, each number labelled with the image it
  is true of, including what a container-less profile now pays.
- Operator documentation carries the coexistence contract: which tool answers
  which question, which one to reach for, that `iptables` here is `iptables-nft`
  and nothing selects the legacy backend, that the container driver's tables are
  its own, and that nothing persists through either tool.
- The English and Chinese operator pages change in the same commit.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Plan

- [PLAN-075](../plan/PLAN-075.md)

## Notes

The user asked for this change directly, and then answered the open question
this task's first round put back to them: ship both front-ends. Round 1 shipped
`iptables` alone; round 2 adds `nftables` beside it and the preset that keeps
`nftables.service` disabled. The request is the approval for exactly that scope
and does not extend to anything under *Not in scope* in the plan.

**WHAT IS NOT DONE, said plainly, because "the image ships nft and iptables"
reads as a firewall.** This image has no firewall. It has no default rule set,
no allow or deny policy, no `netfilter-persistent`, no `iptables-save`/`restore`
unit, no shipped ruleset config that anything loads, no API and no console
surface for rules, and nothing that reapplies a rule after a reboot. A rule an
operator writes lives in the kernel until the next boot and then does not. The
change is two dependencies, one preset, four verify checks and a section of the
operator page.

`nftables` was NOT removed from `mos-podman`'s `Depends`, deliberately, and both
control files now say why so that a future reader does not "clean it up".

Two claims written during investigation were WRONG and were corrected from
measurement rather than left standing:

- "Seven packages, 3012 KiB." That is what a root WITHOUT containers pays. The
  composed x64 dev image pays six and 2768 KiB, because `libnftnl11` is already
  there -- `nftables` depends on it and `nftables` arrives with `mos-podman`.
  The package description now states both, and says which image each is true of.
- "No rule file anywhere in the image." False. `/etc/nftables.conf` and
  `nftables.service` are in the composed root today, from that same `nftables`
  package. Neither is enabled and nothing runs them, which is why the claim
  looked true; the operator page now names them and says why their absence of
  effect matters in both directions.

A third was found in round 2 and it is the reason that round shipped a file
rather than only a dependency: **`nftables.service` was not enabled because
nothing enabled it, which is not the same fact as being disabled.** No preset in
the image matched the unit, and measured in a clean trixie root with the stock
preset set, `systemctl preset nftables.service` CREATES
`sysinit.target.wants/nftables.service` -- the unmatched fallback is enable.
With `disable nftables.service` in a preset file, the same command writes
nothing. Declaring `nftables` in the base without that file would have left the
image one `systemctl preset-all` from a boot that runs `nft -f
/etc/nftables.conf`, whose first line is `flush ruleset`.

- complete: `nftables` and `iptables` in `mos-system`'s `Depends`;
  `50-mos-nftables.preset` shipped and asserted in the postinst;
  `verify/src/checks-firewall.ts` with `packed-nft-present`,
  `packed-nftables-service-disabled`, `packed-iptables-present` and
  `packed-iptables-nft-backend`, their fixture seed and twenty-four tests, ten
  of which drive a check red; `docs/user/security.md` section 5.1 and its
  Chinese mirror carrying the coexistence contract. Verified by `make os-debs`,
  `tests/deb-package-gate.sh`, `tests/install-closure-gate.sh`, a composed x64
  image and `verify/run.sh --verify --board x64`, the verify and build suites,
  and `make docs-verify`; PLAN-075's *Round 2* section carries the counts.
