# RFCT-064 The API surface and authentication for a programmatic client

- **status**: completed — the surface and the token mechanism are proposed; two internal contradictions it left were resolved later by RFCT-069
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-19 15:27
- **claimedAt**: 2026-08-19 15:28
- **completedAt**: 2026-08-19 16:12

Campaign `l1-o7ee8v0o-20260819152142-api` (design proposal, documents only).
Branch `bkd/9brsyhyo`, merged by L2 into `bkd/ml2dtd5k` at `811a31d`.

## Description

Given the measured surface in section 1, this task answers the two questions
that make an API real rather than aspirational: **what is the surface**, and
**how does a script authenticate to it** — given that everything shipped today
authenticates with a browser session cookie that a script cannot reasonably
hold.

## Deliverable

`docs/design/api.md` sections 2, 3 and 10.1, written into the stubs RFCT-063
laid. Ten stub lines consumed, verified at merge.

| section | line | subject |
| --- | --- | --- |
| 2.1 | `docs/design/api.md:655` | Versioning and path shape |
| 2.2 | `:673` | Resource model, derived from mosd's two trees plus an actions namespace |
| 2.3 | `:847` | Operation inventory: today's form posts, tomorrow's API |
| 2.4 | `:943` | Error shape |
| 3.1 | `:1102` | Browser session versus programmatic client — **[implemented]**, the mechanics that rule the cookie out |
| 3.2 | `:1166` | The proposal: a bearer API token |
| 3.3 | `:1389` | Threat model, and what it does not protect against |
| 10.1 | `:3441` | Twelve routed findings |

## Decisions

**Path-segment versioning under `/api/v1`, with an unauthenticated
`GET /api/versions` probe.** The probe is unauthenticated deliberately, and the
cost is stated rather than hidden: anyone who can reach port 443 learns which
API versions the appliance serves (`docs/design/api.md:769-773`). It is accepted
because `/healthz` already answers the literal `ok` unauthenticated to the same
caller, so the probe discloses a strictly smaller fact than what already ships.

**One resource model, derived from mosd's two trees.** Settings and state are
mosd's own division (§1.5) and the API reproduces it rather than inventing a
third shape, plus an `actions` namespace for the operations that are verbs and
not resources (poweroff, reboot).

**The operation inventory is a per-route table, not a summary.** All nineteen
method+path pairs measured in §1.2 appear with their API equivalent, so a reader
can check coverage rather than trust it.

**One error shape that translates mosd's classification while passing its
message through** (§2.4). The reason is measured: apid today converts every
`zbus` failure into `anyhow::Error` (`mosd/webd/src/bus_client.rs:70`) and
renders one 502 page — *"The management daemon is unavailable."*
(`mosd/webd/src/routes.rs:106-116`) — so a settings value mosd rejected and a
dead mosd are indistinguishable to a caller. §8.2 owns the fix; §2.4 specifies
the shape it must land in.

**One credential: a long-lived, revocable bearer token in `Authorization`,
stored hashed at `access.apiTokens` on STATE.** Nothing else — no cookie, no
custom header, no signature, no timestamp (`docs/design/api.md:1381`). It is
hashed with SHA-256 rather than argon2id, and the asymmetry is argued rather
than assumed: argon2id guards a human-chosen password
(`mosd/webd/src/auth.rs:13-19`), while a token is 256 bits of `OsRng`, for which
a slow hash buys nothing. `sha2` is already a dependency
(`mosd/webd/Cargo.toml:25`), so this adds nothing to the dependency list.

## What it named as NOT protected

§3.3 states four attacks the design does not stop, rather than claiming a
threat model it does not have. The one that matters most is the honest one:
**no scopes in phase 1.** apid runs as root and every route sits behind one gate
(`mosd/dist/webd.service:1-13`, `mosd/webd/src/routes.rs:66`), so a token can do
everything the operator can do — including adding a root SSH key
(`mosd/webd/src/routes.rs:944`). §7.4 later leaned on exactly this to reject
bundle signing in phase 1.

Also named: **bearer verification is not rate-limited.** The five-attempt
lockout (`mosd/webd/src/auth.rs:9-10`) gates only `POST /login`
(`mosd/webd/src/routes.rs:500-508`).

## The two contradictions this task left, and why that is recorded here

This record is written after RFCT-069 resolved them, and records them as **left
by this task** rather than quietly attributing the resolution here.

1. **§3.2 versus §3.3 — does a session cookie ever reach an `/api/v1/` route?**
   §3.2 said the bearer token is *"the **only** accepted credential on
   `/api/v1/` routes"* and also that a session cookie may mint one. If that mint
   were reachable at an `/api/v1/` path, `SameSite=Lax` would be the only
   control between a cross-site page and a permanent credential. RFCT-066 found
   it, correctly declined to fix a sibling's section, and routed it as §10.3
   item 2. **RFCT-069 resolved it** by moving the mint to a form POST under
   §6.3's built-in prefix so no `/api/v1/` route accepts a cookie at all.
2. **§2.1 versus §6.1 — one version or a set?** §2.1 named a versions array;
   §6.1's failure check compared against a single value. **RFCT-069 resolved
   it** by making the check membership in the served set, firing on empty
   intersection rather than on inequality.

Both are recorded as a campaign success rather than a defect: the contradiction
was found by a sibling reading the whole document, routed to a register instead
of being patched across an ownership boundary, and closed by a task created for
it.

## Scope fence

Sections 0 and 1 were not edited (hash-verified across every merge, see
`docs/task/RFCT-063.md`). `docs/design/dashboard.md` belongs to campaign
`l1-o7ee8v0o-20260819152009-apid` and is cited, never edited.

No product code changed.
