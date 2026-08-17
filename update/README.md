# update

Server-side update tooling (PLAN-006 Part L). Planned:

- `sign/` — release signing pipeline: TUF metadata generation
  (root/targets/snapshot/timestamp), RAUC bundle CMS signing. Root keys are
  offline; only automation for the online roles lives here.
- `lockbox/` — offline update bundle builder (USB/SD "lockbox" with full
  Uptane metadata).
- delta needs no tooling: RAUC adaptive updates work against the plain bundle
  over HTTP range requests.

Phase 1 server side is static content only — the output of these tools is a
directory servable by any HTTP server or object store.
