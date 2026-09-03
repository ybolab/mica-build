# RFCT-296 Ship `iptables` in the base image, with no policy

- **status**: in_progress
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
