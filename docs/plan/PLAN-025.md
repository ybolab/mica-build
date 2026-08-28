# PLAN-025 Engineering debts: the qemu-run port, the cx3576 build enablement, and the small semantic fixes

- **status**: approved
- **createdAt**: 2026-08-28 07:30
- **approvedAt**: 2026-08-28 07:30
- **relatedTask**: RFCT-230..239 reserved
- **milestones**: M1 qemu-run.sh ported to TS; M2 cx3576 image build enabled on this host; M3 the small fixes; M4 harness facts documented

## Context

- os/tools/qemu-run.sh is now the two-boot e2e's boot engine (invoked at
  test/apid-api/run.sh:411 and :525) and harboured four defects found only by
  execution (RFCT-206 section 5.2-5.4). The rewrite condition stated when
  os/tools was last assessed — "when it grows logic or a gate depends on
  it" — has fired on both clauses.
- The cx3576 IMAGE build cannot run here: os/pkgs/rauc/build.sh pins
  --builder default while arm64 needs the mos-arm64 buildx builder, whose
  docker-container driver cannot resolve localhost/mos-build-* base images
  (RFCT-206 section 7; binfmt install does not stick on this host). Both
  halves need fixing: builder selection and base-image reachability
  (push the family into the builder's store or a local registry).
- Small semantics: GET /api/v1/state missing path answers 422 where 404 is
  arguable (state is read-only; RFCT-183's residual); mosd.md section 5.3
  "returns five" (now seven) and section 5.4's schema sentence, both
  self-dated records needing dated notes only.
- Harness facts live only in task files and session memory: host bun cannot
  parse the committed lockfile, the pinned image lacks nextest/dbus-daemon
  (nextest now provisioned at /srv/mos-rust-tools/bin), the full container
  PATH must be spelled out, runtime/ is the scratch root. They belong in a
  committed HARNESS or docs page so the next tool pays nothing.

## Proposal

- **M1 (RFCT-230)** qemu-run.sh ported into test/apid-api's TS harness (its
  only consumer), RFCT-206's four defects as negative fixtures, the shell
  removed, run.sh invoking the port; two-boot e2e green is the gate.
- **M2 (RFCT-231)** cx3576 image build on this host: unpin the builder
  choice, make the mos-build-* family reachable from mos-arm64 (load into
  the builder or a localhost registry, measured not assumed), then run the
  deferred RFCT-206 section 7 pass: build the cx3576 image and run the
  board-independent guest smoke. If a wall is genuinely capability (no
  hardware), record precisely per the control-pair precedent.
- **M3 (RFCT-232)** /state 404 decision implemented if additive-clean and the
  two mosd.md dated notes. *(Corrected at bootstrap, 2026-08-28: the plan's
  original third item — "the api.md section 2.3 note PLAN-021 left" — was
  already satisfied when written: PLAN-021's a4c092f landed the parked-token
  note at api.md:1468-1470. The one genuinely open 2.3 item, ssh_key_remove
  422 -> 404, is a write-surface behaviour change and is routed to PLAN-023
  M1's inventory.)*
- **M4 (RFCT-233)** the harness facts page (docs/ or test/apid-api/HARNESS
  extension), citation-gated.

## Scope

- **In**: os/tools, test/apid-api, os/pkgs/rauc/build.sh + build-env
  interaction, os/pkgs/mosd/apid (M3 only), the named docs.
- **Out**: .zh.md (parked), api.md sections 4-9, anything PLAN-023/024 owns.
