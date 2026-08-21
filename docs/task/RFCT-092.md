# RFCT-092 A mechanism that checks docs citations, because five of them rotted in two merges

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
- **createdAt**: 2026-08-21 21:10

Roadmap item raised by PLAN-011 campaign 1, deliberately not folded into it.

`docs/design/api.md` §1 is built to be checkable against the tree — §0 calls it
"the measured surface those sections must be derived from". Its `path:line`
citations are hand-maintained, and PLAN-011's M1-M3 merges falsified a large
number of them mechanically: roughly 87 lines were added to
`mosd/mosd/src/bus.rs` and 11 to the head of `mosd/apid/src/bus_client.rs`, so
nearly every citation into those files past the insertion points now lands on
the wrong line. It surfaced only because a subtask happened to be measuring
nearby.

`docs/verify-index.sh` verifies index membership in both directions. Nothing
verifies that a `path:line` citation still resolves, or — the failure §0 names
as the worst kind — that the line it lands on still says what the citing
sentence claims:

> "Re-pointing a citation while leaving the value it quotes untouched produces
> the worst failure a citation has: the reference resolves, and the line it
> lands on contradicts the sentence citing it." (`docs/design/api.md` §0)

The repo's own doctrine applies to its documentation: prose that no mechanism
will ever notice is absent. A hand pass buys accuracy that silently rots at the
next merge; a checker does not.

Open questions for whoever claims this: whether to check resolution only or
also content (an anchor/quote-match discipline); whether citations should move
to symbol anchors rather than line numbers; whether the check gates CI or runs
advisory. PLAN-011 fixed only the self-contradicting seam it created and
classified the rest as mechanical drift — see RFCT-089/090 and this campaign's
records.
