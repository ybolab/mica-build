# RFCT-293 Ship the `docker` command name as a podman symlink

- **status**: completed
- **priority**: P2
- **owner**: podman-docker/session-20260902
- **createdAt**: 2026-09-02 20:10

## Description

The engine on the device answers to `podman` only. Operators and scripts that
type `docker` get "command not found", even though podman's CLI accepts the
same verbs. Give `mos-podman` a `/usr/bin/docker` symlink to `podman` so the
docker command line works on the device, and say in the package and the
integrator's guide what that name does and does not bring with it: there is no
Docker daemon, no `/run/docker.sock` and no REST API behind it.

## ActiveForm

Shipping the `docker` command name as a podman symlink.

## Acceptance

- `mos-podman` stages `/usr/bin/docker` as a relative symlink to `podman` and
  declares it in `payload.manifest`, so the producer's payload assertion covers
  it in both directions.
- The package description states what the name is and what it is not.
- `docs/design/containers.md` and its Chinese translation list the name and its
  limits.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Plan

- (none — standard tier)

## Notes

The user approved the standard-tier proposal and asked whether `docker compose`
works. It does not, and the answer was measured rather than assumed: podman
shells out to a compose provider, and `docker compose version` against this
archive fails with "Error: looking up compose provider failed" over seven
candidate paths, none of them payload.

One claim written during implementation was WRONG and was corrected from the
build's own output: podman DOES read argv[0]. It uses the invoked basename to
name itself, so `docker --version` answers "docker version 5.8.6" and the usage
text says docker; no behaviour is selected by the name. The package description
and both containers.md documents state the corrected form.

- complete: `/usr/bin/docker -> podman` staged and declared (the producer's
  payload assertion went from 29 to 30 paths), package description and the
  English and Chinese container guides updated. Verified by packing mos-podman
  for amd64, reading the symlink back out with `dpkg-deb -c`, and running
  `docker --version` and `docker run --help` from the extracted archive in a
  trixie container. `make docs-verify` and `tests/quadlet-doc-test.sh` pass.
