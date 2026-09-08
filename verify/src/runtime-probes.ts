// Explicitly gated runtime probes.
//
// Nothing in this file runs until runtime-cli.ts has seen the corresponding
// opt-in flag.  The default snapshot is read-only.  These helpers never touch
// eMMC hardware boot areas or bootloader_a; the only persistent object they
// inspect is the owner-installed emmc-probe Quadlet volume.

import { readFileSync, statSync } from 'node:fs'
import { collectRuntimeSnapshot, sshRun } from './runtime-ssh.ts'
import type { RuntimeFact, RuntimeSnapshot } from './runtime.ts'

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 240)
}

function parseFact(text: string, expected: string): RuntimeFact {
  const lines = text.split('\n').filter(line => line !== '')
  if (lines.length !== 1) throw new Error(`active runtime probe emitted ${lines.length} protocol lines, expected one`)
  const line = lines[0] as string
  const first = line.indexOf('\t')
  const second = first < 0 ? -1 : line.indexOf('\t', first + 1)
  if (first < 1 || second < 0) throw new Error(`active runtime probe emitted malformed protocol ${JSON.stringify(line.slice(0, 180))}`)
  if (line.slice(0, first) !== expected) throw new Error(`active runtime probe emitted ${JSON.stringify(line.slice(0, first))}, expected ${expected}`)
  const status = Number(line.slice(first + 1, second))
  if (!Number.isSafeInteger(status)) throw new Error(`active runtime probe emitted a non-integer status for ${expected}`)
  return { status, value: line.slice(second + 1).trim() }
}

async function factScript(host: string, expected: string, script: string): Promise<RuntimeFact> {
  const outcome = await sshRun({
    host,
    script: 'exec /bin/sh -s',
    stdin: new TextEncoder().encode(script),
  })
  if (outcome.status !== 0) {
    throw new Error(`SSH active probe ${expected} to ${host} exited ${outcome.status}; ${clean(outcome.stderr) || '(no stderr)'}`)
  }
  return parseFact(outcome.stdout, expected)
}

/** Creates one transient default-network container and always removes it. */
const CONTAINER_NETWORK_SCRIPT = String.raw`
emit() {
    key=$1
    shift
    out="$("$@" 2>&1)"
    code=$?
    out="$(printf '%s' "$out" | tr '\n\r\t' ' ')"
    printf '%s\t%s\t%s\n' "$key" "$code" "$out"
}

container_network() {
    image=docker.io/library/alpine:3.22
    container=mos-runtime-network-$$
    created=0
    cleanup() {
        [ "$created" -eq 1 ] && podman rm --force "$container" >/dev/null 2>&1 || true
    }
    trap cleanup EXIT HUP INT TERM

    podman image exists "$image" || return $?
    podman inspect "$container" >/dev/null 2>&1 && return 1
    podman run --rm --detach --name "$container" "$image" /bin/sh -ec 'exec sleep 60' >/dev/null || return $?
    created=1
    mode="$(podman inspect --format '{{.HostConfig.NetworkMode}}' "$container")" || return $?
    [ "$mode" = bridge ] || return 1
    address="$(podman inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container")" || return $?
    case "$address" in ''|0.0.0.0) return 1 ;; esac
    route="$(podman exec "$container" /bin/sh -ec 'ip -4 route show default')" || return $?
    [ -n "$route" ] || return 1
    # TCP/HTTP avoids requiring NET_RAW, unlike ping.  No --network option is
    # supplied anywhere in this probe.
    podman exec "$container" /bin/sh -ec 'wget -q -T 10 -O /dev/null http://1.1.1.1/' >/dev/null 2>&1 || return $?
    printf ok
}

emit container_network container_network
`

export async function probeContainerNetwork(host: string): Promise<RuntimeFact> {
  return factScript(host, 'container_network', CONTAINER_NETWORK_SCRIPT)
}

/** The separate TTY path catches crun built without systemd support. */
const CONTAINER_INTERACTIVE_COMMAND = "exec podman run --rm --interactive --tty docker.io/library/alpine:3.22 /bin/sh -ec 'true'"

export async function probeContainerInteractive(host: string): Promise<RuntimeFact> {
  const outcome = await sshRun({
    host,
    tty: true,
    script: CONTAINER_INTERACTIVE_COMMAND,
  })
  return { status: outcome.status, value: outcome.status === 0 ? 'ok' : clean(outcome.stderr) }
}

export interface PersistenceBefore {
  readonly heartbeat: Uint8Array
}

async function probeRunning(host: string): Promise<void> {
  const check = await sshRun({
    host,
    script: "exec /bin/sh -ec 'test \"$(systemctl is-active emmc-probe.service)\" = active; test \"$(podman inspect --format \"{{range .Mounts}}{{if eq .Destination \\\"/data\\\"}}{{.Name}}{{end}}{{end}}\" systemd-emmc-probe)\" = emmc-probe'",
  })
  if (check.status !== 0) {
    throw new Error('emmc-probe is not the active named-volume Quadlet expected by --quadlet-persistence emmc-probe')
  }
}

async function heartbeat(host: string): Promise<Uint8Array> {
  const result = await sshRun({
    host,
    script: "exec podman exec systemd-emmc-probe /bin/sh -ec 'cat /data/heartbeat.log'",
  })
  if (result.status !== 0) throw new Error(`could not read emmc-probe volume heartbeat (exit ${result.status})`)
  return new TextEncoder().encode(result.stdout)
}

/** Capture the existing owner's probe before an explicitly requested reboot. */
export async function capturePersistenceBefore(host: string): Promise<PersistenceBefore> {
  await probeRunning(host)
  const before = await heartbeat(host)
  if (before.byteLength === 0) throw new Error('emmc-probe heartbeat.log is empty; cannot establish a pre-reboot persistence prefix')
  return { heartbeat: before }
}

/** Verify the same volume retained its prefix and the reused service resumed. */
export async function verifyPersistenceAfter(host: string, before: PersistenceBefore): Promise<RuntimeFact> {
  try {
    await probeRunning(host)
    const after = await heartbeat(host)
    if (after.byteLength <= before.heartbeat.byteLength) return { status: 1, value: 'heartbeat-did-not-advance' }
    for (let index = 0; index < before.heartbeat.byteLength; index += 1) {
      if (after[index] !== before.heartbeat[index]) return { status: 1, value: 'pre-reboot-prefix-lost' }
    }
    return { status: 0, value: 'prefix-preserved-and-heartbeat-advanced' }
  }
  catch (error) {
    return { status: 1, value: error instanceof Error ? clean(error.message) : 'persistence probe failed' }
  }
}

export interface WifiCredentials {
  readonly ssid: string
  readonly psk: string
}

function validateCredentials(credentials: WifiCredentials): WifiCredentials {
  const ssidBytes = new TextEncoder().encode(credentials.ssid).byteLength
  if (ssidBytes < 1 || ssidBytes > 32 || /[\r\n"\\]/.test(credentials.ssid)) {
    throw new Error('Wi-Fi SSID must be 1..32 bytes and cannot contain newline, quote, or backslash')
  }
  const pskValid = /^[\x20-\x7e]{8,63}$/.test(credentials.psk) || /^[a-fA-F0-9]{64}$/.test(credentials.psk)
  if (!pskValid || /["\\]/.test(credentials.psk)) {
    throw new Error('Wi-Fi PSK must be a WPA passphrase of 8..63 printable characters or 64 hexadecimal characters, without quote or backslash')
  }
  return credentials
}

/**
 * Read credentials from environment or a local mode-0600 file without ever
 * printing their values.  The file is parsed, never sourced.
 */
export function loadWifiCredentials(file: string | undefined): WifiCredentials {
  if (file === undefined) {
    const ssid = process.env['MOS_RUNTIME_WIFI_SSID']
    const psk = process.env['MOS_RUNTIME_WIFI_PSK']
    if (ssid === undefined || psk === undefined) {
      throw new Error('Wi-Fi association needs MOS_RUNTIME_WIFI_SSID and MOS_RUNTIME_WIFI_PSK, or --wifi-credentials-file')
    }
    return validateCredentials({ ssid, psk })
  }
  let content: string
  let mode: number
  try {
    mode = statSync(file).mode & 0o777
    content = readFileSync(file, 'utf8')
  }
  catch {
    throw new Error('Wi-Fi credential file could not be read')
  }
  if ((mode & 0o077) !== 0) throw new Error('Wi-Fi credential file must be mode 0600 or stricter')
  const fields = new Map<string, string>()
  for (const line of content.split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) throw new Error('Wi-Fi credential file has a malformed line; expected SSID=... or PSK=...')
    const key = line.slice(0, separator)
    if (key !== 'SSID' && key !== 'PSK') throw new Error('Wi-Fi credential file may contain only SSID and PSK keys')
    if (fields.has(key)) throw new Error(`Wi-Fi credential file declares ${key} more than once`)
    fields.set(key, line.slice(separator + 1))
  }
  const ssid = fields.get('SSID')
  const psk = fields.get('PSK')
  if (ssid === undefined || psk === undefined) throw new Error('Wi-Fi credential file must declare both SSID and PSK')
  return validateCredentials({ ssid, psk })
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

function safeInterface(value: string): string {
  if (!/^[A-Za-z0-9_.:-]{1,15}$/.test(value)) throw new Error('Wi-Fi interface is not a safe Linux interface name')
  return value
}

function associationScript(iface: string): string {
  // `iface` passed this validation and carries no credential. SSID/PSK travel
  // only on SSH stdin, are never included in the remote command argv, and all
  // wpa_cli output is suppressed before it can reach the acceptance record.
  return `
set -u
iface=${iface}
IFS= read -r ssid
IFS= read -r psk
command -v wpa_supplicant >/dev/null 2>&1 || exit 127
command -v wpa_cli >/dev/null 2>&1 || exit 127
base="/run/mos-runtime-wifi-$$"
conf="${'$'}{base}.conf"
control="${'$'}{base}.ctrl"
started=''
cleanup() {
    rc=0
    if [ -n "$started" ]; then
        case "$started" in
            ''|*[!0-9]*) rc=1 ;;
            *)
                if kill -0 "$started" 2>/dev/null; then
                    kill "$started" 2>/dev/null || rc=1
                    deadline=$(( $(date +%s) + 5 ))
                    while kill -0 "$started" 2>/dev/null && [ "$(date +%s)" -lt "$deadline" ]; do sleep 1; done
                    kill -0 "$started" 2>/dev/null && rc=1
                    wait "$started" 2>/dev/null || true
                fi
                ;;
        esac
    fi
    rm -f "$conf" || rc=1
    if [ -d "$control" ]; then rmdir "$control" 2>/dev/null || rc=1; fi
    return "$rc"
}
finish() {
    status=$1
    trap - EXIT HUP INT TERM
    cleanup || exit 1
    exit "$status"
}
trap 'finish 1' HUP INT TERM
trap 'finish $?' EXIT
umask 077
mkdir "$control" || finish 1
{
    printf 'update_config=0\\n'
    printf 'ctrl_interface=%s\\n' "$control"
    printf 'network={\\n'
    printf '    ssid="%s"\\n' "$ssid"
    printf '    psk="%s"\\n' "$psk"
    printf '}\\n'
} > "$conf" || finish 1
wpa_supplicant -Dnl80211 -i "$iface" -c "$conf" -C "$control" >/dev/null 2>&1 &
started=$!
case "$started" in ''|*[!0-9]*) finish 1 ;; esac
deadline=$(( $(date +%s) + 30 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
    if state="$(wpa_cli -p "$control" -i "$iface" status 2>/dev/null)"; then
        case "$state" in *'wpa_state=COMPLETED'*) finish 0 ;; esac
    else
        status=$?
        [ "$status" -eq 127 ] && finish 127
        kill -0 "$started" 2>/dev/null || finish "$status"
    fi
    sleep 1
done
finish 1
`
}

/**
 * A volatile private wpa_supplicant association. It intentionally does not
 * call save_config or mosd, so credentials never enter persistent STATE. It
 * may interrupt the selected radio briefly; runtime-cli announces that before
 * invoking it.
 */
export async function probeWifiAssociation(host: string, iface: string, credentials: WifiCredentials): Promise<RuntimeFact> {
  const script = associationScript(safeInterface(iface))
  const outcome = await sshRun({
    host,
    script: `exec /bin/sh -c ${shellQuote(script)}`,
    stdin: new TextEncoder().encode(`${credentials.ssid}\n${credentials.psk}\n`),
  })
  // Do not relay stderr: even a future wpa_cli diagnostic must never turn a
  // credential-bearing command into acceptance-record output.
  return { status: outcome.status, value: outcome.status === 0 ? 'ok' : 'association-command-failed' }
}

/** Request a normal system reboot. It changes neither RAUC slot nor bootloader. */
export async function requestReboot(host: string): Promise<void> {
  const outcome = await sshRun({ host, script: 'exec systemctl reboot' })
  // SSH often sees the expected shutdown as 255.  The following boot-ID wait,
  // not this transport code, proves that a new boot actually happened.
  if (outcome.status !== 0 && outcome.status !== 255) {
    throw new Error(`system reboot request exited ${outcome.status}`)
  }
}

export interface ReconnectResult {
  readonly host: string
  readonly snapshot: RuntimeSnapshot
}

/**
 * Reconnect by caller-supplied endpoint(s) and expected hostname, never by
 * treating the pre-reboot IP as board identity.  Identity is checked later by
 * the normal STATE-backed hostname check.
 */
export async function reconnectAfterReboot(
  hosts: readonly string[],
  beforeBootId: string,
  timeoutSeconds: number,
): Promise<ReconnectResult> {
  const unique = [...new Set(hosts.filter(host => host !== ''))]
  if (unique.length === 0) throw new Error('no reconnect endpoint was supplied')
  const until = Date.now() + timeoutSeconds * 1000
  let last = 'no connection attempt completed'
  while (Date.now() < until) {
    for (const host of unique) {
      try {
        const snapshot = await collectRuntimeSnapshot(host)
        const bootId = snapshot.boot_id
        if (bootId?.status !== 0 || bootId.value.trim() === '' || bootId.value.trim() === beforeBootId) {
          last = `connected through ${host}, but boot ID did not change`
          continue
        }
        return { host, snapshot }
      }
      catch (error) {
        last = error instanceof Error ? clean(error.message) : 'SSH reconnect failed'
      }
    }
    await Bun.sleep(2_000)
  }
  throw new Error(`did not reconnect to a new boot within ${timeoutSeconds}s (${last})`)
}

export const PROBE_SCRIPTS = {
  containerNetwork: CONTAINER_NETWORK_SCRIPT,
  wifiAssociation: associationScript('wlan0'),
} as const

export const PROBE_COMMANDS = {
  containerInteractive: CONTAINER_INTERACTIVE_COMMAND,
} as const
