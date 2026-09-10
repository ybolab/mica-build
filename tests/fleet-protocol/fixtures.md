# Fleet protocol design evidence

Normative contract: [protocol plan](../../docs/plan/20260910-1910-fleet-device-plane-protocol.md).
This directory contains no device client, plane server or production module.

Run from repository root with the already pinned tool image; no installation:

```bash
source build-env/images.env
timeout 30s docker run --rm --pull=never --label ai-agent=true \
  --network none -v "$PWD:$PWD:ro" -w "$PWD" \
  "$IMAGE_BUN_1" bun tests/fleet-protocol/validate.mjs
```

The workspace here is under `/srv`, identical on host/container. Translate
`/work` or `/root` before using the command from another checkout.

`exchanges.json` provides eight separate successful HTTP exchanges, not a
single chronological session. Body bytes use the plan's compact sorted-key
encoding; header values and Content-Length are explicit. Signatures consisting
of zeroes are intentionally invalid shape placeholders. Stored raw header
fixtures use repository LF endings; their check covers duplicate/unknown header
names, not a production HTTP framing parser. Public keys are public
example bytes, never a registry entry or evidence of authorization. The example
origin is a placeholder and no HTTP connection is made. The in-memory Ed25519
controls generate fresh ephemeral keys, verify mutation refusal and write no
key material to disk.

`protocol.schema.json` defines the entire v1 wire shape. `register.json`,
`report.json` and `reports.json` retain benign rich/null examples. The evaluator
checks every schema keyword used here and refuses unsupported vocabulary;
u64 upper bounds, byte limits, order and cross-field rules are additional
semantic checks, not claims that JSON Schema proves authorization. Raw
`duplicate-*.json`, `duplicate-header.http` and `malformed.json` must be parsed
without overwriting duplicate members. `negative-cases.json` gives the
normative section and expected refusal for each data mutation. There are
positive controls for each endpoint, parsing, signature and state model.

`MODEL` results use symbolic verified principals and in-memory candidate
transactions. They illustrate expected authorization, ownership, key overlap,
queue pressure and counter behavior; they prove no runtime fsync, TLS, access
control deployment or integration with today's source. Date/retry checks use
fixed clocks and deterministic jitter inputs. The later runtime, interop,
restored-server and board acceptance matrix is in N9 of the plan.

The runner prints per-file SHA-256 identities after successful verification.
The task records actual command logs and source identity. Malformed fixtures
are intentional and are never sent to a live service.
