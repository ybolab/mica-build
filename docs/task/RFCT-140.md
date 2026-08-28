# RFCT-140 One outage is reported two ways: the API answers 503 and the HTML pages answer 502

- **status**: completed
- **priority**: P2
- **owner**: bkd/xexc9k2h
- **createdAt**: 2026-08-26

When mosd cannot be reached, apid answers with two different statuses
depending on which surface the request landed on.

The API path returns `503 Service Unavailable` with the code `mosd_unreachable`
and a `Retry-After` header (`mosd/apid/src/routes.rs:573-578`, header at
`:562-567`). The HTML path returns `502 Bad Gateway` with the page *"The
management daemon is unavailable."* (`mosd/apid/src/routes.rs:650-657`).

Both describe the same condition — apid is up, mosd is not answering — and
`503` is the correct one: the failure is this server declining to serve, not a
malformed answer from an upstream, and only `503` carries `Retry-After`
meaningfully. The API answers it and the HTML pages do not, because changing
them is a user-visible change to a shipped page and to whatever an operator's
monitoring already matches on.

The cost is that an appliance under one fault emits two status codes, and
anything watching from outside has to learn both. Closing it is the built-in
UI's half of a change the API has already made.

## Resolution

`bus_error` — the one page every HTML form handler renders for a failed
mosd call — now answers **503 Service Unavailable with `Retry-After: 5`**:
the *"503 page for failed mosd calls, with `Retry-After`"*
(`os/pkgs/mosd/apid/src/routes.rs:3173-3188`), the same status and the same
header the API path answers for the same condition
(`mosd_unreachable`, `:642`, header at `:648-652`). One outage now
reports one way on both surfaces. The page body is unchanged.

Tests (commit `054bceb`): the one assertion of the old 502 control
(`api_versions_answers_when_the_settings_call_fails`) moved to 503, and a
new test pins 503 + `Retry-After` on the HTML surface
(`an_unreachable_mosd_is_503_with_retry_after_on_the_html_panes_too`).
`test/apid-api` needed no change: no phase asserts the old 502 — the two
"502" hits in `05-mutate.ts` are comments describing a 2026-08-24 run,
not assertions. api.md §2.4's passage that recorded the divergence as an
open cost now records it closed.
