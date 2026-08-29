# RFCT-066 Trust, migration and phasing, and what API-first forecloses

- **status**: completed — the signing recommendation, the six phases and eleven foreclosures are written; two contradictions it found were routed rather than fixed, and closed later by RFCT-069
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-19 15:27
- **claimedAt**: 2026-08-19 15:28
- **completedAt**: 2026-08-19 16:40

Campaign `l1-o7ee8v0o-20260819152142-api` (design proposal, documents only).
Branch `bkd/gd8ea5do`, merged by L2 into `bkd/ml2dtd5k` at `0af77e1`.

## Description

The last of the three proposal tasks, and the only one whose job was to argue
against the campaign's own direction. It answers who may install a UI, how the
whole thing ships without a flag day, and — the section this project asks for
by convention — **what adopting it forecloses**.

## Deliverable

`docs/design/api.md` sections 7, 8, 9 and 10.3, written into the stubs RFCT-063
laid. Four stub lines consumed, verified at merge.

| section | line | subject |
| --- | --- | --- |
| 7.1 | `docs/design/api.md:3774` | The channels that actually exist — **[implemented]** |
| 7.2 | `:3436` | The honest baseline: anyone with SSH is already root — **[implemented]** |
| 7.3 | `:3477` | The signing machinery this project already has, having read it — **[implemented]** |
| 7.4 | `:3534` | Recommendation |
| 8.1 | `:2731` | What happens to today's server-rendered pages |
| 8.2 | `:2806` | Six phases |
| 8.3 | `:3194` | What is deliberately not phased |
| 9 | `:3218` | Eleven foreclosures |
| 10.3 | `:3607` | Fourteen routed findings |

## Decisions

**Do not sign UI bundles in phase 1 or phase 5.** The recommendation runs
against the instinct, so it is argued as three separately checkable claims
(`docs/design/api.md:3908-3931`):

1. **A signature and the upload credential authorise the same blast radius.** A
   caller holding a token can already power the appliance off, flip
   `access.ssh.enabled` and add an authorized key — and every authorized key is
   a **root** key (`mosd/webd/src/routes.rs:944`). §3.2 states there are no
   scopes in phase 1. Requiring the attacker to sign the bundle does not take
   the root key away.
2. **A signature does not defend what a bundle actually threatens.** The blast
   radius is content served on the management origin, and what bounds it —
   §4.3's `nosniff` and fixed MIME allowlist, §4.4's install-time rejection,
   §5.3's validate-then-rename — bounds a signed and an unsigned bundle
   **identically**. *"A signature attests who built the artifact, not what it
   does."*
3. **The threat signing answers is a supply chain mos does not have.** Today the
   bundle goes from the operator's laptop to the operator's own device over one
   TLS connection. *"Building for the distribution model before it exists
   produces key material nobody rotates."*

§7.3 reached that conclusion **having read the signing machinery rather than
assuming it away**: RAUC's CMS verification against `/etc/rauc/keyring.pem`
with `plain` format refused (`os/pkgs/rauc/system.conf.in:72-102`) is real and is
described, and §7.4 endorses unit sandboxing (`ProtectSystem=`,
`ReadWritePaths=`) as *"the concrete substitute for a signing scheme"* — a
control that bounds what a compromised bundle can do, rather than one that
attests who built it.

**Today's maud pages stay, as the built-in fallback (§8.1 option B).** Three
options, all costed. Option A — one asset pipeline for both UIs — is rejected
because §6.4 already rejected it by argument: a DATA-level fault would take
**both** UIs at once and convert a recoverable failure into `access.md` §9.1's
unrecoverable one. Option C — retire the maud handlers — is rejected because it
deletes the mechanism §6 exists to provide. Option B's real cost ("every
capability twice") is named and then paid down by defining what the built-in UI
is *required* to do rather than assuming parity.

**Six phases, and phase 1 ships before any API exists**: recover the error
classification first, because §2.4's error shape cannot be honoured while every
bus failure collapses into one 502 page.

## The finding that was corrected by execution, not by reading

§8.2 phase 2 needs `access.apiTokens`, which needs a `SCHEMA_VERSION` bump.
The task ran the rollback cases rather than reasoning about them, and §8.2
phase 2 records **four cases with their verbatim output**. The load path
answers:

```
on-disk schema_version 5 is newer than supported 4
```

at `mosd/mosd-settings/src/store.rs:63-67` — **before** `migrate` is reached at
`:68`. An older binary has no `MigrateV4ToV5` to walk down with in any case
(`no migration targeting schema version 5`), and `#[serde(deny_unknown_fields)]`
rejects the field even without a version bump:

```
unknown field `apiTokens`, expected one of `webAdmin`, `ssh`, `console`, `device`
```

Because `mosd/mosd/src/main.rs:45-48` propagates a failed load with `?` under
`Restart=on-failure` (`mosd/dist/mosd.service:9`), the consequence is a **mosd
crash loop** and an appliance serving only the 502 page.

**This is pre-existing** — the shipped v3 → v4 bump has the same property — so
it is recorded as not the API's cost and not this document's to fix. §8.2 phase
2 is gated on the owning decision existing. RFCT-069 later sharpened the same
finding into its defect class; see `docs/task/RFCT-069.md`.

A second claim was likewise evidenced rather than asserted: §7.1's "the factory
image ships DATA **empty**" was rewritten to carry the two references that
actually exist — `grep -n "data\.img" os/mkimage-v2.sh` returns exactly two
lines, `:378` creating it with `mkext4` and `:450` `dd`ing it in, with nothing
mounting or copying into it (commit `531025d`).

## What it found and deliberately did NOT fix

This is the part of the record that matters most, because it is the behaviour
the campaign was trying to produce. Reading the whole document, this task found
two contradictions **in sections it did not own**, and routed them instead of
editing across the ownership boundary:

- **§10.3 item 2 — §3.2 versus §3.3, the cookie and CSRF.** Whether a session
  cookie ever reaches an `/api/v1/` route. Two candidate shapes were recorded
  with the routing.
- **§10.3 item 3 — §2.1 versus §6.1, one version or a served set.**

Both belonged to RFCT-064's sections. **RFCT-069 was created to resolve them**,
and took the first of the two shapes item 2 recorded. Items 2 and 3 were kept in
the register with their resolutions recorded rather than deleted.

§10.3 item 1 remains an **open contradiction**, recorded rather than resolved:
§2.1 and §4.1 disagree about whether today's paths are reserved.

## The section that is now partly stale, with an owner

**§9 item 8 (CSRF and the cookie path) was written against the contradiction
RFCT-069 later resolved.** Its verdict — *"Not mitigated as written; the design
does not currently say enough to be checked"* — and its two quoted sentences
attributing the cookie mint to an `/api/v1/` path no longer describe §3.2.
RFCT-069 correctly cited §9 rather than editing a section it did not own and
routed it as **§10.3 item 14**. §9 belongs to this task; **whoever next edits it
owes the restatement to "partly mitigated"**. RFCT-067's consistency pass
reports this as a known, recorded inconsistency rather than as a clean document.

## Scope fence

Sections 0 and 1 not edited. `docs/design/access.md`, `docs/design/mosd.md` and
`docs/design/dashboard.md` cited and never edited.

No product code changed.
