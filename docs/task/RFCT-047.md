# RFCT-047 sshd reconciler: reload on config change, not restart

- **status**: completed — implementation complete, `bash mosd/hack/check.sh` green at 280
  tests; no on-device sshd behaviour is claimed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 09:39
- **claimedAt**: 2026-08-19 09:39
- **completedAt**: 2026-08-19 09:39

Campaign `l1-o7ee8v0o-20260819093920-sshweb`. Branch `bkd/63b9ych6`, merged by
L2 into `bkd/hiu25adw`.

## Description

`SshdReconciler::apply_unit` restarted `ssh.service` whenever the rendered
drop-in changed. That is M5 behaviour which this campaign did not introduce —
but RFCT-034 made it load-bearing: `PasswordAuthentication` is now gated on
whether a transient root password is active, so `SetTransientRootPassword`
rewrites the drop-in and therefore restarts sshd. The operator setting that
password is, by construction, the operator trying to get access — very often
over an SSH session that a restart could drop at exactly that moment.

This task changes a configuration-only change from a restart to a reload.

### An L1-authorised widening, not scope creep

The campaign's original brief did not include changing how the unit is driven.
L1 ruled explicitly that it should, and the reason is ownership rather than
opportunity: the campaign is what made this path load-bearing, so the campaign
owns making it correct. Recorded here as an authorised widening with that
reason, so a later reader does not mistake it for an unbriefed change.

## Design

### Reload, and why `KillMode` is not the fix

Debian's `openssh-server` ships `KillMode=process` on `ssh.service`. Under that
value a restart spares already-established sessions, so on today's image the
restart probably never disconnected anyone.

That is not a property this repo chose. Nothing in the image sets it, nothing
asserted it before this task, and a future package revision could change it with
no signal on our side — at which point the failure lands precisely on the
operator who was setting a password to regain access. Pinning or asserting
`KillMode` would only convert an inherited property into a watched one; it would
still be a property we do not own.

sshd re-reads its configuration on `SIGHUP` and `ssh.service` carries
`ExecReload` for exactly that. A reload applies the new configuration while every
established session keeps running — by construction, not by grace. That is why a
restart here is not equally fine, and the `apply_unit` doc comment says so in
those terms rather than merely describing what the code does.

### What is a configuration change and what is not

| transition | call | why |
| --- | --- | --- |
| running, drop-in bytes changed | `reload` | configuration change; sessions must survive |
| not running, should be | `start` | reloading a stopped daemon applies configuration to nothing |
| disabled → enabled | `enable` + `start` | unit **state** change, not configuration |
| enabled → disabled | `stop` + `disable` | unit **state** change; sessions are meant to end |
| nothing changed | none | the reconciler reads before it writes |

`restart` is untouched. `UnitControl::restart` keeps its signature and its
behaviour, and the WiFi client and AP reconcilers keep calling it. Migrating them
would be a different judgement about a different daemon — hostapd and
`wpa_supplicant` have no session an operator is sitting in — and is out of scope.

The "did the rendered bytes change" comparison in `apply_drop_in` is exactly as
RFCT-034 left it. Only what is done with the answer changed.

### `UnitControl::reload`

Added to the trait beside `restart`, implemented for `Systemd` as the
`ReloadUnit` manager call with the existing `replace` job mode — the D-Bus call
that `systemctl reload` makes. The whole trait is D-Bus rather than shelling out
to `systemctl`, and this method follows that; the semantics are `systemctl
reload <unit>`.

`ReloadUnit` fails rather than falling back when the unit file carries no
`ExecReload`. That refusal is the signal this design wants, so it is propagated
rather than smoothed over.

### The `ExecReload` dependency

Correctness now depends on `ssh.service` carrying `ExecReload`. That unit file
comes from the Debian `openssh-server` package — the overlay ships no
`ssh.service` — so this is the same inherited-property problem as `KillMode`, in
a new place. It is therefore made explicit rather than left implicit:

- Stated in the `apply_unit` doc comment, alongside why there is no fallback.
- A failing reload is wrapped with context naming `ExecReload` and saying the
  configuration change **has not been applied**. A bare "systemctl reload failed"
  would send the next person hunting in sshd or in the settings tree rather than
  at the unit file.
- **No fallback to `restart` on a failed reload.** A silent fallback would
  reintroduce the exact disconnect this task exists to prevent, and would hide
  the missing `ExecReload` behind an apply that appeared to succeed. The reload
  is attempted once; if it fails, the apply fails.

### Test mock

`MockUnitControl` records `reload <unit>`, matching the existing `restart
<unit>` convention, and models the reload as leaving `ActiveState` exactly as it
was — which is the property that makes reload the right verb. A second
constructor, `with_failing_reload`, models a unit file without `ExecReload`: it
records the attempt and then fails, so a test can assert both that the reload
was tried and that nothing followed it.

## Testing

- **The central guard, both directions**: a configuration-only change on a
  running unit produces `reload ssh.service` and is asserted **not** to produce
  `restart ssh.service`.
- **Unit state changes are still state changes**: enable-when-stopped still
  produces `enable` + `start`, disable-when-running still produces `stop` +
  `disable`, and each now also asserts that no reload was issued.
- **A configuration change on a stopped unit** produces `start` and no reload —
  the drop-in is read on the way up, so the change is applied without one. New
  test; it asserts what the code does, and what the code does is the sensible
  one.
- **A failing reload**, both halves: the error names `ExecReload` and says the
  change has not been applied, and the recorded calls are exactly one reload
  attempt with no `restart` after it.
- **The marker-flip path**, renamed from
  `…_turns_passwords_on_and_restarts_sshd` to `…_and_reloads_sshd` and asserting
  reload present, restart absent. Kept rather than deleted: it covers the
  transient-password path that is the whole reason this task exists.
- **No unnecessary action**: `already_running_and_enabled_needs_no_calls` and
  `already_stopped_and_disabled_needs_no_calls` assert an empty call list, which
  excludes reload as well as restart and start. Unchanged and still green.
- **The mock itself**: a reload is recorded and leaves `ActiveState` at
  `active`; the failing-reload mock errors and still records the attempt.

**The central guard was mutation-tested rather than assumed.** Changing
`self.control.reload(SSH_UNIT)` back to `self.control.restart(SSH_UNIT)` fails
three tests:

- `changing_the_config_of_a_running_sshd_reloads_it_and_never_restarts_it`
- `a_marker_appearing_between_two_applies_turns_passwords_on_and_reloads_sshd`
- `a_unit_without_exec_reload_fails_loudly_and_is_never_restarted_instead`

No existing test was weakened or deleted. Three tests gained assertions; two were
renamed to match the behaviour they now describe.

### Check results

| check | before | after |
| --- | --- | --- |
| `bash mosd/hack/check.sh` | ALL CHECKS PASSED, 276 tests | ALL CHECKS PASSED, 280 tests |

## What is NOT proven

- **No hardware claim.** Nothing here runs sshd. No test proves that an
  established SSH session survives a reload, that sshd re-reads
  `sshd_config.d` on `SIGHUP`, or that the reloaded daemon serves the new port.
  What is proven is which verb the reconciler issues and which it refuses to
  issue.
- **`ExecReload`'s presence in the packed image is not asserted here.** No test
  or verifier in this task inspects the shipped `ssh.service`. If a future
  `openssh-server` dropped `ExecReload`, nothing would fail until a reload was
  actually attempted on a device — and then it would fail loudly rather than
  silently, which is the point of having no fallback. **Recommended follow-up:**
  an image verifier that asserts the packed `ssh.service` carries `ExecReload`,
  in the same place a sibling task asserts the overlay's drop-in files. It
  belongs to the verifier task, not here.
- **`KillMode=process` is not asserted either**, deliberately. This design stops
  depending on it, so pinning it would be asserting something no longer relied
  on. It is recorded above as the reason a restart *appeared* safe, not as a
  property under test.
- **The reload path is exercised only through the mock.** `Systemd::reload`
  itself — the `ReloadUnit` bus call — is not covered by any test, exactly as
  `start`, `stop` and `restart` are not: reaching it needs a system bus.
- **`ReloadUnit`'s refusal on a missing `ExecReload` is read from systemd's
  documented behaviour, not observed.** The mock models the refusal; no test
  makes systemd produce one.

## ActiveForm

Making a configuration-only sshd change reload rather than restart.

## Dependencies

- **blocked by**: RFCT-034 (made the drop-in re-render on a transient password,
  which is what made the restart load-bearing)
- **blocks**: nothing; the recommended `ExecReload` image verifier is a
  follow-up, not a blocker
