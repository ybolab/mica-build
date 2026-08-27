# RFCT-046 Dashboard process architecture, external contract, rename, and phasing

- **status**: completed — proposal complete, the process decision and the rename decision are the user's, and both are open
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 10:17
- **claimedAt**: 2026-08-19 13:00
- **completedAt**: 2026-08-19 14:30

Campaign `l1-o7ee8v0o-20260819101756-venus` (research/design-proposal, documents
only). Branch `bkd/z2pjo6lc`, merged by L2 into `bkd/sqexk7je`.

## Description

Sections 1-5 designed a dashboard and chose how its values reach the screen.
This task answers the question underneath all of it: **should the management UI
keep being a separate process at all, and if it does, what is the boundary
between it and `mosd` actually for?** (`docs/design/dashboard.md:1589-1592`.)

Three options are analysed, each with two columns — what it **costs to adopt**
and what it **forecloses**, the second being the one usually omitted. A rename
sub-question and a phased delivery plan follow.

## Deliverable

`docs/design/dashboard.md` **sections 6-8** (lines 1587-2762), added in place.

| section | line | subject |
| --- | --- | --- |
| 6 | `docs/design/dashboard.md:1587` | The process question: one daemon, two hardened daemons, or a generic bus |
| 7 | `:2350` | Is `com.mos.mosd1` a supported external contract? |
| 8 | `:2573` | Phased delivery |

## Recommendation: HARDEN, DO NOT MERGE

**Adopt option 2, together with the read half of option 3 — primitives (a) and
(b). Defer option 3's action verb (c). Do not merge.**
(`docs/design/dashboard.md:2196-2199`.)

**This is the opposite of the user's own proposal**, which was to merge `webd`
into `mosd`. It is recorded that way on purpose. **The decision is the user's
and it is open** — section 6 exists to make the costs visible in both security
directions, not to close the question, and the document says so at
`docs/design/dashboard.md:1596-1599`.

The document argues the other direction as well, rather than reading as
one-sided (`:2234-2245`): option 2 concentrates nothing but *fixes* nothing the
operator can see, and if the user judges that the appliance's threat model
includes neither a hostile local uid nor a pre-auth HTTP CVE, **option 1 is a
coherent choice**. Four conditions are then attached to it as part of the
option, not as follow-ups (`:2248-2258`).

## The two findings that constrain the outcome either way

These are recorded here, in the task record, because they hold **whatever the
user decides**. They are not arguments for one option; they are properties any
option must satisfy.

### 1. A merged process makes a provisioning failure fatal to the UI

`mosd` exits hard on an unwritable STATE, **on purpose**. The comment says so:
*"Hard failure on purpose: an unwritable STATE means no device identity and no
device credential, so there is no usable device to serve. A loud exit is better
than a daemon that quietly serves an unprovisioned tree the operator cannot log
in to."* (`mosd/mosd/src/main.rs:53-56`; the failure propagates at `:63`.)

Today `webd` **survives that**. Its bus client degrades per request rather than
crashing (`mosd/webd/src/bus_client.rs:22-25`), so the operator gets a 502 page
reading *"The management daemon is unavailable."*
(`mosd/webd/src/routes.rs:95-105`) instead of a dead socket.

Merged, there is no process left to explain anything. The operator gets a device
with **no interface and no message**, at the moment they most need one — and on
a headless appliance whose operator may be on a phone attached to a setup access
point, the fallback is a serial console.

### 2. `com.mos.mosd1` is not a UI convenience

It has a real second consumer, and breaking it does not produce a broken UI.

`os/health/mos-health:155-159` probes the interface:

```
elif run busctl --system --quiet call com.mos.mosd /com/mos/mosd \
     com.mos.mosd1 GetState s "" >/dev/null 2>&1; then
    log "probe mosd: OK"
else
    fail "mosd did not answer com.mos.mosd1.GetState on the system bus"
```

`fail` is `exit 1` (`os/health/mos-health:18`). So control **never reaches**
`rauc status mark-good` at `os/health/mos-health:203`.

**Breaking that interface therefore produces a device that never confirms its
slot and rolls back its own updates.** No UI symptom announces it.

`mos-health` calls the interface a second time — `ReportHealth`
(`os/health/mos-health:47-48`). That call is **not** fatal: it logs a note and
continues on failure (`:48-49`). So of the two call sites in the health gate,
only `GetState` carries the rollback consequence. Stated separately because
conflating them would overstate the finding.

The direct consequence for the process question: a merge does not delete the
bus, **it deletes one consumer** (`docs/design/dashboard.md:2202-2207`). The
remaining consumer keeps the open-D-Bus-policy problem alive in full, so option
1's simplification shrinks to one fewer unit and one fewer state directory.

## Section 7.4 — the rename sub-question

**Recommendation: do not rename `webd` as a standalone change. Rename only if
and when the option-2 unit rewrite happens, in the same change.**
(`docs/design/dashboard.md:2541-2544`.)

The reason is ordering, not aesthetics: option 2 already rewrites the unit,
already adds a D-Bus policy rule to a file that has no rename cost today and
would acquire one at that moment, and already forces new verifier assertions.
Bundling is roughly half the work of sequencing. **The name itself is the
user's choice**; section 7.4.3 offers input, not a decision.

## Section 8 — phasing, and the property that matters

**Everything in phase 1 is unchanged by whichever of options 1, 2 and 3 is
chosen** (`docs/design/dashboard.md:2581-2584`). That independence is stated
first, and explicitly, because it is the property that keeps the architecture
question from blocking the product: the dashboard can ship while the process
decision stays open.

## Section 6.7 — one correctness risk recorded so it cannot be lost

The U-Boot environment writer-versus-writer hazard **is already handled** and
must not be re-reported (`docs/design/dashboard.md:2267-2300`, section 6.7). The interlock is
boot-time systemd ordering between two boot oneshots
(`os/health/mos-health.service:10-13`, `os/health/mos-machine-id:15-18`) and
buys nothing outside that window; there is no lock. The window is the first boot
of a *freshly flashed* device, not the first boot after an update — which is why
anyone testing the update path finds nothing and concludes there is nothing to
find.

## Scope fence

`docs/design/access.md`, `docs/design/provisioning.md` and `docs/design/mosd.md`
belong to the parallel `sshweb` campaign. They are quoted and cited and never
edited. The `SetTransientRootPassword` method that campaign is adding is
**announced only** — it is not in this tree and no branch of it was read; where
it changes a count, that is said in line
(`docs/design/dashboard.md:1614-1618`).

## Status of the decisions

| decision | recommendation | status |
| --- | --- | --- |
| merge `webd` into `mosd` | **no — harden instead (option 2 + 3a/3b)** | **open, the user's** |
| rename `webd` | not standalone; bundle with the option-2 unit rewrite | **open, the user's** |
| option 3's action verb (c) | defer | open |
