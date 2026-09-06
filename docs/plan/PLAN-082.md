# PLAN-082 Cache the Debian runtime base and install it with dpkg

- **status**: completed
- **createdAt**: 2026-09-06 00:06
- **approvedAt**: 2026-09-06 00:06
- **completedAt**: 2026-09-06 00:27
- **relatedTask**: RFCT-331

## Context

The current rootfs composer installs locally built packages and their upstream runtime dependencies through APT. The user explicitly selected a dpkg-based offline cache as the next step and excluded OCI and compilation changes. The runtime package pool already declares the relevant upstream dependencies. An independent base preparation entry point can establish this boundary without changing the existing image pipeline.

Debian debootstrap provides package download caching, saved package tarballs, and a dpkg-based installation sequence. Its minbase variant normally selects APT; the new entry point must explicitly exclude it and verify its absence. Reusing the official bootstrap sequence avoids implementing a general package dependency solver and the Essential/Pre-Depends bootstrap order in this repository.

## Proposal

1. Pin a Debian trixie snapshot, the bootstrap helper and the Debian archive keyring. Extract helper packages into the project cache without installing them on the host.
2. Declare the runtime base package roots in a plain package manifest. Fetch and authenticate the complete package closure for each supported architecture, storing a reusable package cache and a completed bundle with package inventory and SHA256 checksums.
3. Provide cache, verify and install commands. A matching complete cache requires no downloads. Offline installation verifies all inputs before modifying an empty destination and uses debootstrap's dpkg stages with service startup disabled. No APT command is permitted.
4. Add top-level Make routing and focused regression tests, then verify a real cache and native installation in an isolated filesystem. Architecture-specific execution remains a property of the installation environment; cache population needs no target emulation.

## Risks

Snapshot availability and archive signatures must fail explicitly. A partially downloaded cache must not become a completed cache. Bootstrap scripts execute inside the target and need a native or emulated execution environment and usable device nodes. The upstream bootstrap helper has a limited resolver, so successful package download alone is insufficient acceptance: package configuration and the resulting installed versions must be checked. Changes to package selection or pins must invalidate the completed bundle while preserving reusable package downloads.

## Scope

New runtime-base tooling and package inputs under rootfs/, a focused shell test in the existing offline CI job, Make routing, and this PMA record. No existing OCI Dockerfile, compiler, custom component producer, running host package database, commit, or push is changed.

## Alternatives

APT as an offline installer was rejected by the user. Implementing a new Debian dependency solver is unnecessary for this runtime-base boundary. Unpacking deb archives without dpkg configuration would omit maintainer scripts and triggers.

## Annotations

- The user's latest instruction authorizes the dpkg/cache implementation within the stated scope; no compatibility adapter or APT fallback is planned.
- The default manifest covers the current mos runtime dependencies; the optional question about a smaller libc/OpenSSL-only scope received no answer before implementation proceeded with this stated assumption.

## Progress

- Implemented cache, verify and install entry points using pinned debootstrap 1.0.141 and Debian archive keyring 2025.1. No helper is installed into the host package database.
- The default manifest is the union of current mos runtime package families' upstream dependencies; OCI and component build integration remains outside scope.
- Regression tests first failed on the missing entry point and now pass 26 checks, including warm-cache reuse with network clients disabled, corrupt inputs, architecture mismatch and destination protection.
- The Debian trixie snapshot at 20260905T000000Z supplies 174 packages per architecture. Both amd64 and arm64 completed caches verify and reuse without downloads; the shared cache occupies approximately 236 MiB.

## Verification

- `make os-debian-test`: 26 checks passed. Shell syntax and `git diff --check` passed.
- Real cache population verified Debian archive signatures and package content for both architectures. Explicit verification and warm-cache reuse passed for each completed set.
- Native amd64 installation configured all 174 packages, matched every installed package/version/architecture to the cache inventory, reported no `dpkg --audit` findings, and installed no APT binaries.
- The final implementation also installed successfully in an isolated container with networking disabled, the cache mounted read-only, and APT, curl and wget commands replaced with refusals. OpenSSL and systemd executables ran successfully. The disposable container used an existing local image; no image or component build was performed.
- An initial offline installation exposed debootstrap's dependence on the saved mirror identity and its Architecture: all discovery flag. Retaining the original snapshot identity and supplying the flag fixed the failure; the subsequent disconnected installations passed.
- A read-only comparison against the current amd64 mos package pool found all 55 upstream dependency groups satisfied by the installed base, including version constraints and virtual providers.
- Self-review found no remaining actionable defect within this boundary. Logs remain under `_out/debian-base*.log`; the successful native root is `_out/debian-base-root-amd64`.

## Outcome

The independent runtime-base entry point now caches, verifies and installs a fixed Debian package set without invoking APT. Installation requires root, an empty destination and a native host matching the requested architecture. The arm64 cache is verified, but an arm64 installation was not executed. OCI assembly and component compilation remain outside this change. No commit or push was requested or performed.
