// SSH collection for the booted-board runtime verifier.
//
// The board script is intentionally POSIX sh and read-only.  It returns a
// tab-separated `fact, exit-status, value` protocol rather than a shell
// transcript.  In particular, `emit` keeps a 127 result: the caller can never
// mistake a missing executable for an empty observation.

import { RUNTIME_FACTS, type RuntimeFact, type RuntimeFactName, type RuntimeSnapshot } from './runtime.ts'

const HOST = /^[A-Za-z0-9._:-]+$/

export interface SshOutcome {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

export interface SshRequest {
  readonly host: string
  readonly script: string
  readonly tty?: boolean
  /** Optional non-secret stdin for a static remote command. */
  readonly stdin?: Uint8Array
}

export function validateRuntimeHost(host: string): string {
  if (host === '' || host.startsWith('-') || !HOST.test(host)) {
    throw new Error(`runtime host ${JSON.stringify(host)} is not a bare hostname or address`)
  }
  return host
}

function safeOutput(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 800)
}

/**
 * Run an SSH command without changing the caller's key or host-key policy.
 * `root@HOST` is a transport endpoint only; runtime.ts proves the hostname and
 * STATE-backed identity after connection.
 */
export async function sshRun(request: SshRequest, sshBin: string = process.env['SSH_BIN'] ?? 'ssh'): Promise<SshOutcome> {
  const host = validateRuntimeHost(request.host)
  if (sshBin === '' || sshBin.includes('\0')) throw new Error('SSH_BIN is empty or contains NUL')
  const argv = [
    sshBin,
    request.tty === true ? '-tt' : '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    `root@${host}`,
    request.script,
  ]
  const proc = Bun.spawn(argv, {
    stdin: request.stdin ?? 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, status] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { status, stdout, stderr }
}

/** Parse the collector protocol and refuse malformed or duplicated facts. */
export function parseRuntimeSnapshot(text: string): RuntimeSnapshot {
  const known = new Set<string>(RUNTIME_FACTS)
  const facts: Partial<Record<RuntimeFactName, RuntimeFact>> = {}
  for (const raw of text.split('\n')) {
    if (raw === '') continue
    const first = raw.indexOf('\t')
    const second = first < 0 ? -1 : raw.indexOf('\t', first + 1)
    if (first <= 0 || second < 0) throw new Error(`runtime collector emitted malformed record ${JSON.stringify(raw.slice(0, 180))}`)
    const name = raw.slice(0, first)
    const statusText = raw.slice(first + 1, second)
    const value = raw.slice(second + 1).trim()
    if (!known.has(name)) throw new Error(`runtime collector emitted unknown fact ${JSON.stringify(name)}`)
    if (!/^-?[0-9]+$/.test(statusText)) throw new Error(`runtime collector emitted non-numeric status ${JSON.stringify(statusText)} for ${name}`)
    const status = Number(statusText)
    if (!Number.isSafeInteger(status)) throw new Error(`runtime collector emitted unsafe status ${JSON.stringify(statusText)} for ${name}`)
    const key = name as RuntimeFactName
    if (facts[key] !== undefined) throw new Error(`runtime collector emitted ${key} twice; duplicate facts cannot be silently chosen`)
    facts[key] = { status, value }
  }
  return facts
}

/** The fixed read-only probe sent with `ssh ... 'exec /bin/sh -s'`. */
export const SNAPSHOT_SCRIPT = String.raw`
# No set -e: every command must leave an individual fact and exit status.
# The outer SSH process is allowed to fail only for a transport/protocol fault.
emit() {
    key=$1
    shift
    out="$("$@" 2>&1)"
    code=$?
    # The protocol has one physical line per fact.  This sanitises only the
    # presentation separator; it deliberately preserves the command status.
    out="$(printf '%s' "$out" | tr '\n\r\t' ' ')"
    printf '%s\t%s\t%s\n' "$key" "$code" "$out"
}

mount_at() {
    path=$1
    out="$(findmnt -rn -o SOURCE,TARGET,FSTYPE,LABEL "$path")" || return $?
    set -- $out
    [ "$#" -ge 4 ] || return 1
    printf '%s|%s|%s|%s' "$1" "$2" "$3" "$4"
}

root_mount() {
    out="$(findmnt -rn -o SOURCE,FSTYPE /)" || return $?
    set -- $out
    [ "$#" -eq 2 ] || return 1
    printf '%s|%s' "$1" "$2"
}

root_slave() {
    for path in /sys/class/block/dm-0/slaves/*; do
        [ -e "$path" ] || continue
        printf '%s' "${'$'}{path##*/}"
        return 0
    done
    return 1
}

boot_image_hash() {
    digest="$(sha256sum /boot/Image)" || return $?
    set -- $digest
    [ "$#" -ge 1 ] || return 1
    printf '%s' "$1"
}

uenv_nonzero() {
    device=$1
    # p3/p4 are 64 KiB uenv partitions. sha256sum reads that partition only;
    # this never reaches an eMMC hardware boot area or bootloader partition.
    digest="$(sha256sum "$device")" || return $?
    digest=${'$'}{digest%% *}
    case "$digest" in
        de2f256064a0af797747c2b97505dc0b9f3df0de4f489eac731c23ae9ca9cc31) printf no ;;
        [0-9a-f][0-9a-f]*) printf yes ;;
        *) return 1 ;;
    esac
}

health() {
    result="$(systemctl show mos-health.service -p Result --value)" || return $?
    code="$(systemctl show mos-health.service -p ExecMainStatus --value)" || return $?
    active="$(systemctl show mos-health.service -p ActiveState --value)" || return $?
    printf '%s|%s|%s' "$result" "$code" "$active"
}

hdmi_state() {
    for connector in /sys/class/drm/*HDMI*/; do
        [ -f "${'$'}{connector}status" ] || continue
        state="$(cat "${'$'}{connector}status")" || return $?
        modes=''
        if [ -r "${'$'}{connector}modes" ]; then
            while IFS= read -r mode; do
                [ -n "$mode" ] || continue
                if [ -n "$modes" ]; then modes="${'$'}{modes},"; fi
                modes="${'$'}{modes}${'$'}{mode}"
            done < "${'$'}{connector}modes"
        fi
        printf '%s|%s' "$state" "$modes"
        return 0
    done
    return 1
}

session_count() {
    sessions="$(loginctl list-sessions --no-legend)" || return $?
    count=0
    while IFS= read -r line; do
        [ -n "$line" ] && count=$((count + 1))
    done <<EOF
$sessions
EOF
    printf '%s' "$count"
}

setting_flag() {
    value="$(busctl call com.mos.mosd /com/mos/mosd com.mos.mosd1 GetSettings s "$1")" || return $?
    case "$value" in
        's "true"') printf true ;;
        's "false"') printf false ;;
        *) printf malformed ;;
    esac
}

setting_string() {
    value="$(busctl call com.mos.mosd /com/mos/mosd com.mos.mosd1 GetSettings s "$1")" || return $?
    case "$value" in
        s\ \"\\\"*\\\"\")
            # GetSettings returns JSON inside busctl's quoted string.  The
            # interface name is the constrained shell-safe setting type.
            value=${'$'}{value#s \"\\\"}
            value=${'$'}{value%\\\"\"}
            printf '%s' "$value"
            ;;
        *) return 1 ;;
    esac
}

mqtt_device_id() {
    [ -r /run/mos/mqttd-device.env ] || return 1
    while IFS= read -r line; do
        case "$line" in
            MOS_MQTT_DEVICE_ID=*)
                value=${'$'}{line#MOS_MQTT_DEVICE_ID=}
                case "$value" in ''|*[!A-Za-z0-9._:-]*) return 1 ;; esac
                printf '%s' "$value"
                return 0
                ;;
        esac
    done < /run/mos/mqttd-device.env
    return 1
}

mqtt_mode() {
    # Read and reduce the unit environment locally.  Do not emit it: it may
    # contain broker configuration that this acceptance record does not need.
    value="$(systemctl show mos-mqttd.service -p Environment --value)" || return $?
    case "$value" in
        *'MOS_MQTT_MODE=read-only'*) printf read-only ;;
        *'MOS_MQTT_MODE='*) printf non-read-only ;;
        *) return 1 ;;
    esac
}

mqtt_subscription() {
    device="$(mqtt_device_id)" || return $?
    logs="$(journalctl -u mos-mqttd --no-pager -n 200)" || return $?
    matching=0
    foreign=0
    while IFS= read -r line; do
        case "$line" in
            *'subscribing filter="'*'"'*)
                filter=${'$'}{line#*subscribing filter=\"}
                filter=${'$'}{filter%%\"*}
                if [ "$filter" = "R/${'$'}{device}/#" ]; then
                    matching=$((matching + 1))
                else
                    foreign=1
                fi
                ;;
        esac
    done <<EOF
$logs
EOF
    [ "$matching" -gt 0 ] && [ "$foreign" -eq 0 ] && printf only-read-filter || printf unexpected-filter
}

component_unit_state() {
    package=$1
    unit=$2
    inventory=$3
    [ -r "$inventory" ] || return 1
    count="$(awk -F '\t' -v package="$package" '$1 == package { n++ } END { print n+0 }' "$inventory")" || return $?
    case "$count" in 0 | 1) ;; *) return 1 ;; esac
    load="$(systemctl show "$unit" -p LoadState --value)" || return $?
    if [ "$count" = 0 ]; then
        [ "$load" = not-found ] && printf absent || printf unexpected-installed
        return 0
    fi
    active="$(systemctl show "$unit" -p ActiveState --value)" || return $?
    if [ "$load" = loaded ] && [ "$active" = active ]; then printf selected-active
    else printf selected-inactive
    fi
}

mqtt_reference() {
    component_unit_state mos-mqtt-reference mos-mqtt-reference.service /usr/share/mos/manifest.tsv
}

panel_driver() {
    root=/sys/bus/platform/devices/skykirin_led
    [ -d "$root" ] || { printf no-device; return 0; }
    # A loaded module is not a driven panel: an unbound device still has its
    # sysfs directory but no driver symlink and none of the control files.
    if [ -e "$root/driver" ] && [ -e "$root/text" ] && [ -e "$root/enabled" ]; then
        printf bound
    else
        printf unbound
    fi
}

panel_service() {
    component_unit_state mos-bm201-front-panel bm201-front-panel.service /usr/share/mos/manifest.tsv
}

wpa_cli_path() {
    command -v wpa_cli || return 127
}

wpa_state() {
    enabled="$(setting_flag wifi.client.enabled)" || return $?
    [ "$enabled" = true ] || { printf disabled; return 0; }
    iface="$(setting_string wifi.client.interface)" || return $?
    output="$(wpa_cli -i "$iface" status 2>&1)"
    code=$?
    [ "$code" -eq 0 ] || return "$code"
    while IFS= read -r line; do
        case "$line" in
            wpa_state=*) printf '%s' "$line"; return 0 ;;
        esac
    done <<EOF
$output
EOF
    return 1
}

emit hostname hostname
emit hostname_mount mount_at /etc/hostname
emit root root_mount
emit root_slave root_slave
emit cmdline cat /proc/cmdline
emit kernel_release uname -r
emit boot_image_sha256 boot_image_hash
emit boot_id cat /proc/sys/kernel/random/boot_id
emit ntp_synchronized timedatectl show --property=NTPSynchronized --value
emit epoch date +%s
emit fw_printenv fw_printenv BOOT_ORDER BOOT_A_LEFT BOOT_B_LEFT
emit uenv_a uenv_nonzero /dev/mmcblk0p3
emit uenv_b uenv_nonzero /dev/mmcblk0p4
emit rauc_status rauc status --output-format=json
emit mos_health health
emit display_args cat /proc/cmdline
emit hdmi_state hdmi_state
emit login_sessions session_count
emit ssh_cgroup cat /proc/self/cgroup
emit container_enabled setting_flag container.enabled
emit quadlet_mount mount_at /etc/containers/systemd
emit mqtt_enabled setting_flag mqtt.enabled
emit mqtt_broker_active systemctl is-active mos-mqtt-broker.service
emit mqtt_bridge_active systemctl is-active mos-mqttd.service
emit mqtt_mode mqtt_mode
emit mqtt_subscription mqtt_subscription
emit mqtt_reference mqtt_reference
emit wifi_enabled setting_flag wifi.client.enabled
emit wifi_interface setting_string wifi.client.interface
emit wpa_cli wpa_cli_path
emit wpa_status wpa_state
emit panel_driver panel_driver
emit panel_service panel_service
`

export async function collectRuntimeSnapshot(host: string): Promise<RuntimeSnapshot> {
  const outcome = await sshRun({
    host,
    script: 'exec /bin/sh -s',
    stdin: new TextEncoder().encode(SNAPSHOT_SCRIPT),
  })
  if (outcome.status !== 0) {
    throw new Error(
      `SSH runtime collector to ${host} exited ${outcome.status}; stderr=${safeOutput(outcome.stderr) || '(empty)'} stdout=${safeOutput(outcome.stdout) || '(empty)'}`,
    )
  }
  return parseRuntimeSnapshot(outcome.stdout)
}

/** Run one static remote command and turn a transport failure into a named error. */
export async function requireSsh(request: SshRequest): Promise<SshOutcome> {
  const outcome = await sshRun(request)
  if (outcome.status !== 0) {
    throw new Error(`SSH command to ${request.host} exited ${outcome.status}; stderr=${safeOutput(outcome.stderr) || '(empty)'}`)
  }
  return outcome
}
