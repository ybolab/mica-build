# RFCT-140 One outage is reported two ways: the API answers 503 and the HTML pages answer 502

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
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
