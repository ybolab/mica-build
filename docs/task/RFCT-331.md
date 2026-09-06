# RFCT-331 Cache the Debian runtime base and install it with dpkg

- **status**: completed
- **priority**: P1
- **owner**: maintainer/deb-base-20260906
- **createdAt**: 2026-09-06 00:06

## Description

Provide a fixed-snapshot Debian runtime package cache and an offline dpkg installation entry point. Do not invoke APT, change OCI image assembly, or change component compilation. Track the implementation in [PLAN-082](../plan/PLAN-082.md).

## ActiveForm

Completed the offline Debian runtime cache and dpkg installation boundary.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- The user selected dpkg installation and a reusable cache, explicitly excluding OCI and compilation work. This authorizes the narrowed implementation.
- Existing update-related working-tree changes are outside this task and remain untouched.

## Acceptance

- A fixed snapshot supplies the selected runtime packages and their dependency closure for amd64 and arm64.
- Cache population validates upstream metadata and package content; a complete cache is reusable without network access.
- Installation uses the cached package set and dpkg, including maintainer scripts and configuration, with no APT invocation.
- Missing or corrupt cache entries fail before installation; installation cannot target the host root or overwrite an existing populated root.
- Regression tests and a real isolated native installation verify the delivered boundary.

- complete: Passed 26 regression checks, verified 174 packages for each architecture, and completed native and disconnected amd64 installations with exact dpkg inventory matching.
