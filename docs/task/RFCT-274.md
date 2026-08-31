# RFCT-274 Bound, scope and queue the settings-write path so the UI stops hanging

- **status**: in_progress
- **priority**: P1
- **owner**: claude/apid-apply-queue-20260831
- **createdAt**: 2026-08-31 12:27

## Description

A settings write from the web UI can leave the browser on a blank page with no
bound on the wait. The `/ssh` pane is the sharpest case: setting a transient
root password re-applies every reconciler, which reaches a full systemd
`daemon-reload` and a networkd reload, and the request that asked for it is
still open the whole time. Nothing on the path — apid's router, apid's zbus
client, mosd's reconciler calls into systemd — carries a timeout, so a stall
anywhere is unbounded, and mosd's single mutex is held across the reconcile,
so every other pane blocks with it.

Turn the write path into a bounded, scoped, queued operation with an execution
record: bound every cross-process call, re-apply only the subtree that the
change can affect, stop settings reads from queuing behind reconcile execution,
and make repeated clicks coalesce into one job whose start, finish and outcome
are recorded.

## Acceptance

- No request served by apid can wait on mosd without a bound; an elapsed bound
  answers a status that states the write may still be applying rather than
  claiming it failed.
- `SetTransientRootPassword` re-applies the `access.ssh` subtree only. A test
  asserts no other reconciler is invoked.
- A settings read (`GetSettings` / `GetState`) answers while a reconcile is
  executing. A test holds a reconcile open and asserts the read returns.
- The serialization the shadow-file and WireGuard-key writes depend on is
  preserved by an explicit apply lock, not by the data lock they currently
  share. A test asserts two concurrent transient-password writes do not
  interleave.
- Two rapid identical submissions of the same pane produce one reconcile, and
  the record states that a second request was folded into it.
- A task record carries id, operation, dot-path, source, enqueued/started/
  finished timestamps and outcome, and is readable over the API.
- apid answers task status from a registry fed by a mosd `TaskChanged` signal,
  not by polling mosd. The registry serves from memory only while the
  subscription is provably live and falls back to a direct read otherwise; a
  test drops the subscription mid-task and asserts no stale state is served.
- Every task reaches a terminal outcome, including after a mosd restart, so a
  polling pane cannot refresh forever.
- No plaintext password enters the queue. A test asserts the queue entry for a
  transient-password operation contains no password material.
- `openapi.json`, the e2e spec pins and the affected phase files agree with the
  shipped status codes.

## ActiveForm

Bounding, scoping and queueing the settings-write path.

## Dependencies

- **blocked by**: (none)
- **blocks**: any UI work that assumes a settings write returns promptly

## Notes

- Investigation recorded in `docs/plan/PLAN-038.md`.
- Raised from a user report that the SSH pane freezes the page, followed by a
  user proposal to process switch and password operations through a queue.
- User annotation at 2026-08-31 12:40 UTC: take the newest design and do not
  consider compatibility; deliver all four stages; apid may hold a queue that
  waits for a notification. PLAN-038 closed every compatibility-preserving
  alternative, made `SetSettings` return a task id outright, and replaced the
  open timeout question with a `TaskChanged` signal plus an apid-side registry
  modelled on the existing `watch_settings_changed` pump.
- Implementation deferred by the user in the same message; the plan stays
  `draft` until `proceed`.
- A conflict survey was run at `9acd48f`: no off-main commit touches any file
  in scope, `SetSettings` has exactly one caller outside mosd (apid), and the
  coordination commitments toward PLAN-036 and PLAN-037 are recorded in
  PLAN-038 *Conflicts and coordination*.
