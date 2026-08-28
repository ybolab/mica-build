# RFCT-241 PLAN-023 M5: the SSH authorized-keys and WiFi-networks collections

- **status**: in progress
- **priority**: P1
- **owner**: bkd/jw8lxe0t
- **createdAt**: 2026-08-28
- **plan**: PLAN-023 (M5)

The two array collections that already exist in the settings tree, given API
routes: `GET`/`POST /api/v1/ssh/authorized-keys` with
`DELETE /api/v1/ssh/authorized-keys/{fingerprint}`, and
`GET`/`POST /api/v1/wifi/client/networks` with
`DELETE /api/v1/wifi/client/networks/{ssid}`.
