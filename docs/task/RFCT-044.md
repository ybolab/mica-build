# RFCT-044 Dashboard technology posture and live-value transport

- **status**: completed — proposal complete, the technology decision is the user's, and open
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 10:17
- **claimedAt**: 2026-08-19 12:45
- **completedAt**: 2026-08-19 13:50

Campaign `l1-o7ee8v0o-20260819101756-venus` (research/design-proposal, documents
only). Branch `bkd/ya2hiwxx`, merged by L2 into `bkd/sqexk7je`.

## Description

RFCT-043 deliberately proposed a dashboard without choosing a rendering or
live-update technology, and deferred three things to this task. This task
answers one question: **can the dashboard designed in sections 2 and 3 be
delivered inside `webd`'s existing constraints — server-rendered `maud`, no
JavaScript build chain, rustls-only — and if so, how do live-ish values reach
the screen?** (`docs/design/dashboard.md:844-847`.)

## Deliverable

`docs/design/dashboard.md` **section 5** (lines 842-1585), added in place to the
file RFCT-043 created. Thirteen subsections: the re-verified constraint set, the
criteria, four transport options costed individually, a side-by-side, the
recommendation, the three deferred items resolved, a summary, and an explicit
unverified/gaps subsection.

## Recommendation

**Option A — full-page refresh — as the dashboard's only live-value mechanism,
at a 15-second default interval, with a no-JavaScript off switch**
(`docs/design/dashboard.md:1273-1276`).

Four facts carry it, not a preference (`:1278-1298`):

1. **The push options have nothing to push.** `mosd` has exactly one signal and
   it is about *settings* (`mosd/mosd/src/bus.rs:249-254`); there is no
   live-state change notification of any kind. Server-Sent Events and WebSocket
   therefore do not deliver push — they deliver `webd` polling `mosd` with a
   persistent browser connection stapled on.
2. **Freshness is identical across all four options**, because the binding
   constraint is `mosd`'s single mutex, not the wire format.
3. **Works-without-JavaScript is the only criterion on which the options
   genuinely differ**, and against a headless appliance whose operator may be on
   an unfamiliar phone browser attached to a setup access point, it outweighs
   the bytes per refresh.
4. `webd`'s bus client already degrades per request
   (`mosd/webd/src/bus_client.rs:22-25`) — exactly the right behaviour for a
   page that re-fetches itself, and exactly the wrong shape for a long-lived
   stream.

**What it buys**: the section 2 dashboard becomes deliverable with no new crate,
no new `mosd` mechanism, no new client-side technology, and no change to the
zero-JavaScript posture.

## The three deferrals RFCT-043 handed over, resolved

| deferred from | subject | resolved at |
| --- | --- | --- |
| section 2.5 | the live install-progress tile | `docs/design/dashboard.md:1338` (5.9) |
| section 3.2 | can partial refresh coexist with POST + 303 + full re-render | `:1403` (5.10) |
| section 3.3 | can the `?saved=1` banner carry what `mosd` already computed | `:1445` (5.11) |

## The hard constraint, stated as a finding rather than an assumption

No npm, no bundler, no TypeScript, no SPA framework, no component library and no
CSS framework is proposed or assumed anywhere. That is recorded as a **finding**:
*no option evaluated requires one* (`docs/design/dashboard.md:868-874`). The
document says plainly that if it were not true, the correct recommendation would
have been to abandon the dashboard rather than acquire a front-end toolchain.

## One line left open for RFCT-046

Section 5.8 left the `mosd` mutex question open for the process-architecture
section, and RFCT-046 closed it: a merge does not shorten the lock hold at all,
so the recommendation here is unaffected by the process decision
(`docs/design/dashboard.md:2260-2265`).

## Status of the decision

Proposal. The user decides.

<!-- dated-record: a measurement record frozen at its commit; its citations name the tree as it was then (pre-PLAN-019 layout, pre-rewrite design documents); exempt from docs/verify-citations.sh (RFCT-172) -->
