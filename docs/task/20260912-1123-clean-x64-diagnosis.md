# 20260912-1123-clean-x64-diagnosis Clean main x64 rebuild and diagnosis

- **status**: completed
- **priority**: P1
- **owner**: worker/x64-clean-20260912-1123
- **createdAt**: 2026-09-12 11:23

## Description

Clear previous MOS build and handoff state. Rebuild the complete current main
x64 system and diagnose actual startup. Preserve current source edits.

## ActiveForm

Clean x64 rebuild and QEMU diagnosis completed; recording measured evidence.

## Dependencies

- **blocked by**: none
- **blocks**: complete x64 runtime qualification

## Notes

Full tier. User explicitly authorized cleanup and full rebuild. No fixed
resource quotas, handoff reuse, parallel agents or new campaign. Local commits
are authorized; no push.
SYSTEM remains 1 GiB and current signing/auth/storage/watchdog contracts apply.

## Preparation result — 2026-09-12

The old MOS private daemon, cache volume and compiled images were removed.
Old filesystem outputs and the temporary worktree were moved to
`/srv/ybolab/mos-discarded-20260912-1123/` after automatic approval rejected
force deletion; they are not build inputs. The handoff file was removed from
the documentation entry points; B7 now carries only closure notices.

All seven amd64 builder images were rebuilt using current main, pinned inputs,
no cached build layers and no fixed resource quotas. Builder floor/version and
linking probes passed. Docker documentation checks, shell syntax and whitespace
checks passed; local review found no new high-confidence issue. Execution
evidence is in `_out/clean-x64/`. No product binaries or image have yet been
built in this clean run. The package runner is prepared but refuses a dirty
main. Local commit authorization and the new development signing identity
selection have been requested; no commit, key generation or push was performed.

## Approved key initialization addition — 2026-09-12 11:29 UTC

The user authorized new development keys in `meta/`, an idempotent one-command
initializer using the existing RSA boot/content and Ed25519 metadata generator,
and local commits. Add `os-keys-init`; validate existing material without
rotation and refuse partial, mismatched or symlinked inputs. Use the existing
public-only root configuration input separately. Exercise fresh/repeated and
refusal cases through Docker before generating the actual identity and committing.
This is part of the approved clean x64 build task; no new campaign is created.

## Key initialization verified — 2026-09-12 11:33 UTC

Added `make os-keys-init` using the existing development generator and pinned
OpenSSL container. Fresh and empty directories are initialized; existing
identities are validated read-only. Tests cover repeat stability, two concurrent
callers, missing certificate, mismatched certificate, symlink and private-file
permission refusals. Original RED (missing initializer, exit 127) and final
GREEN logs are retained in `_out/clean-x64/`. Documentation, shell syntax,
whitespace and host-toolchain policy checks passed. Local review found no
high-confidence issue. New development boot/content/metadata keys were created
and verified in ignored `meta/`; no private material is staged. The user
authorized local commits. Freeze the resulting clean main commit for production
and keep runtime progress in ignored evidence until the next source boundary.

## Clean x64 result — 2026-09-12

Production source: `a6b7b55c61834dd3200bbfbf7807b0e62d888806`, clean main.
All seven pinned Docker toolchains, packages, Linux 6.12.107, boot tools,
root/kernel-support signatures, firmware, two factory deployment records,
complete image and update archive were rebuilt. Successful inputs were reused
between composition and acceptance without recompiling them. SYSTEM is 1 GiB.

Image: `_out/clean-x64/factory/mos-x64-20260912-114332.img`.
SHA256: `ea5bec779a14c46abbeb664fe29fdcda16cf2faa25192d0e3ec2908612c7295e`.
Development signing inputs remain in ignored `meta/`. The following results
come from this run, not historical acceptance:

| Check | Result and evidence under `_out/clean-x64/` |
|---|---|
| Root runtime closure and executable smoke | PASS, 12/12; `rootfs.log` |
| Altered UKI, signed root hash and deployment metadata | Refused; `tamper*.log` |
| Enrolled Secure Boot and authenticated API | PASS, 151/151; `api-acceptance.log` |
| Native poweroff/reboot and QMP guest action | PASS; `actions-acceptance.log` |
| Same-VM reboot, changed boot ID, retained machine ID/data | PASS; `reboot-cycle.log` |
| DATA growth, mount isolation, quotas, persistent var/container paths, firmware readback | PASS on two boots; `runtime-acceptance.log` |
| Root-only, kernel-only, unhealthy deployment fallback, combined update | PASS; `updates-acceptance.log` |
| Configuration/application/full-factory interrupted reset and retry | PASS, three boots per tier; `reset-acceptance.log` |

API and action tests use the complete factory image with DATA test units.
Storage/update/reset fixtures use this complete root plus test probes and
isolated fixture keys; they do not replace the production identity. QMP proves
guest-requested reset/shutdown, with no watchdog event. Expected unhealthy
deployment failures and reset interruptions remain in their logs. A temporary
API runner initially selected a partition intermediate; it was stopped before
guest startup, corrected, and its original log/exit retained separately.
The initial tamper command found no OpenSSL CLI in boot tools after verifying
the UKI refusal; content verification then used the pinned OpenSSL image and
passed both valid-input and altered-input checks. Both logs are retained.

Measured bytes: initramfs 4,449,280 expanded / 1,094,176 compressed (75.41%
smaller), UKI 16,178,216, support 69,632, root 71,200,768. Observed update peak
usage: SYSTEM 143,929,344 and ESP 32,583,680 bytes, sampled every 100 ms;
this is guest filesystem usage, not physical write amplification.

Diagnostic follow-up: the no-radio x64 boot logs contain `wifiClient` failure
`create /etc/wpa_supplicant` and `wifiAp` D-Bus `FileNotFound`. The client still
renders configuration while disabled; radio reconciliation needs a separate
fix/acceptance decision. Wireless functionality is not qualified by these tests.
Physical hardware, ARM, online delivery and additional fault matrices were not
executed and are not marked passed. The dedicated build daemon and cache volume
were removed; successful artifacts and evidence are retained. No push occurred.

- complete: Fresh x64 build and requested QEMU diagnosis completed; limits and follow-up observations recorded.
