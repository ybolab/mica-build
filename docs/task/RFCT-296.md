# RFCT-296 Ship `iptables` in the base image, with no policy

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

Put `iptables` in `mos-system`, the base package, beside `iproute2` and `curl`.
That is the whole change. No default rule set, no allow/deny policy, no
`netfilter-persistent`, no management API and no console surface -- the image
gains a tool, not a firewall.

## ActiveForm

Shipping `iptables` in the base image with no policy.

## Acceptance

- `iptables` is in `mos-system`'s `Depends`, and the package description says
  why it is written out there rather than derived.
- The verify register carries a check that the packed root really holds an
  executable `iptables`, with a negative test that drives it red on a root
  without one.
- The closure `iptables` drags in, and the size it costs, are measured from
  `tests/install-closure-gate.sh` and from the shipped manifest, and recorded.
- Operator documentation states three things that are support cases otherwise:
  that this is `iptables-nft` over the same `nf_tables` subsystem netavark uses
  and that nothing selects the legacy backend; that `iptables -S` and
  `nft list ruleset` are not the same view and that netavark's tables are
  netavark's; and that nothing persists a rule across a reboot.
- The English and Chinese operator pages change in the same commit.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Plan

- [PLAN-075](../plan/PLAN-075.md)

## Notes

The user asked for this change directly, in the words the Description
transcribes, so the request itself is the approval for exactly that scope. It
does not extend to anything under *Not in scope* in the plan.

**WHAT IS NOT DONE, said plainly, because the word "iptables" reads as a
firewall.** This image has no firewall. It has no default rule set, no allow or
deny policy, no `netfilter-persistent`, no `iptables-save`/`restore` unit, no
API and no console surface for rules, and nothing that reapplies a rule after a
reboot. A rule an operator writes lives in the kernel until the next boot and
then does not. The change is one dependency, two verify checks and a section of
the operator page.

`nftables` was NOT moved out of `mos-podman` and is not in the base. On a
container-less profile the operator therefore has `iptables` and not `nft`,
which means they have the front-end that cannot show the whole `nf_tables`
subsystem. That is a real gap; PLAN-075's annotations carry the measurement and
the recommendation, and it is a question for the user rather than something this
task decided.

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

- complete: `iptables` in `mos-system`'s `Depends`; `verify/src/checks-iptables.ts`
  with `packed-iptables-present` and `packed-iptables-nft-backend`, their
  fixture seed and thirteen tests, four of which drive the checks red;
  `docs/user/security.md` section 5.1 and its Chinese mirror. Verified by
  `make os-debs`, `tests/deb-package-gate.sh` (264/264),
  `tests/install-closure-gate.sh` (99/99), a composed x64 image and
  `verify/run.sh --verify --board x64` (309/309, 22 skipped), the verify and
  build suites, and `make docs-verify`.
