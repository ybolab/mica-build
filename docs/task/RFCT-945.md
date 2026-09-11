# RFCT-945 Verify managed Wi-Fi connectivity on the S905X5M SD system

- **status**: closed
- **priority**: P1
- **owner**: miehq
- **createdAt**: 2026-09-08 09:30 UTC

## Reconciliation

Closed as superseded by current S905X5M signed-file integration. The successful
historical DNS/HTTPS results and failed gateway ICMP probe remain evidence for
that old image only. Current physical Wi-Fi qualification remains explicitly
open and unassigned in the campaign record.

## Scope and authorization

The user supplied a controlled wireless network and explicitly requested an
actual connectivity test, then instructed continuation after host recovery.
The previous inspection established scanning only. This task extends that
qualification through MOS network enrollment and the managed supplicant.
Credentials are private test inputs and must not enter repository records.

## Investigation and execution plan

The device is still mos-490fab24 at the Ethernet address 192.168.27.72.
Wi-Fi is disabled, wlan0 is down with no addresses, the saved-network list
is empty, and access-point mode is off. The Wi-Fi reconciler owns the
supplicant configuration and DHCP networkd unit. The API provides an
asynchronous settings task whose successful outcome must be checked.

Apply the supplied network and enable the client, preserving Ethernet.
A temporary networkd drop-in gives Wi-Fi a higher route metric during the
test. Verify association, DHCP, gateway reachability, link-specific DNS and
HTTPS explicitly bound to wlan0. Restore the original client settings and
remove the temporary route policy and private credential file afterward.
No reboot, OTA, eMMC write or persistent network enrollment is requested.

## Acceptance

- Record association security, radio signal/band and acquired addressing.
- Attribute DNS and outbound traffic to wlan0 rather than the Ethernet path.
- Verify normal API task completion and managed service operation.
- Restore the original settings and confirm Ethernet remains reachable.

## Evidence

Two controlled connection runs completed on 2026-09-08 at 09:34 and 09:36 UTC.
The resource API enrolled the test network, but the browser's scalar enable
endpoint returned 409 `settings_read_only`. The test therefore used the
existing native `SetSettings` method to toggle the client and checked its
task outcome. Both native enable and disable tasks succeeded. This proves
the managed connection path, not a successful browser switch; RFCT-946 owns
that separate API defect.

| Probe | Result | Evidence |
| --- | --- | --- |
| Association | pass | WPA2-PSK/CCMP, 5240 MHz (5 GHz), signal -31 dBm; reported link rate 143 Mbps, not a throughput measurement |
| DHCP | pass | wlan0 acquired 192.168.27.73/24 in about four seconds; gateway and DNS 192.168.27.1 |
| Link-specific DNS | pass | resolvectl query selected wlan0 with its cache disabled and reported a network answer |
| Link-bound HTTPS | pass | curl explicitly bound to wlan0 returned 200 for example.com with local address 192.168.27.73; wlan0 counters increased |
| Direct-address HTTPS | pass | curl bound to wlan0 returned 200 from 1.1.1.1 with local address 192.168.27.73 |
| Gateway ICMP | fail | busybox ping bound to wlan0 sent four packets and received none; the eth0 control received all three replies |
| Ethernet management | pass | the API remained reachable at 192.168.27.72 |
| Restoration | pass | client disabled, saved networks empty, supplicant inactive, wlan0 down with no addresses; temporary route policy and private test credential file removed |

The first ping probe could not execute because the standalone ping program
was absent; the second used BusyBox and produced the actual packet-loss
result. The complete second test exited 1 because ICMP failed. Reverse-path
filtering was zero for all/default/eth0/wlan0, so strict rp_filter does not
explain that observation. The gateway-ping cause remains unresolved and
this task remains open; successful DNS and HTTPS do not waive it or RFCT-944's
other runtime blockers.

Local evidence: `tmp/sd-wifi-connectivity.log`,
`tmp/sd-wifi-connectivity.json`, `tmp/sd-wired-icmp-baseline.log`.

- close: Historical Wi-Fi evidence is retained; current-image physical Wi-Fi acceptance remains unassigned in the campaign record.
