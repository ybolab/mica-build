# RFCT-091 PLAN-011 M3: mos-mqttd, the MQTT data-publishing bridge

- **status**: in progress
- **priority**: P1
- **owner**: ai-agent (BKD campaign, dispatched by L1 0yncfnol)
- **createdAt**: 2026-08-21 14:58
- **claimedAt**: 2026-08-21 14:58

PLAN-011 milestone M3, depends on M1+M2 (RFCT-089/090). Deliverable: the
`mos-mqttd` crate — topic grammar `N|R|W/<deviceId>/<class>/<instance>/<path>`
with `{"value": ...}` payloads, 60 s keepalive triggering a rate-limited
full republish, 3 s heartbeat, secret masking at publish, read-only vs full
mode. Protocol choice per the M1-recorded Sparkplug B evaluation. Verify:
protocol tests against a local broker (N/R/W, keepalive republish, masking,
read-only mode); workspace checks green.

## Outcome

Filled in at completion.
