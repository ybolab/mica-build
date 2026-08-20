#!/usr/bin/env bash
# Live-bus tests for the SHIPPED mosd D-Bus policy, mosd/dist/com.mos.mosd.conf.
#
#   bash mosd/hack/dbus-policy-test.sh
#
# The policy claims com.mos.mosd is reachable only by root. Reading the XML back
# and asserting it says so proves nothing about what dbus-daemon does with it,
# so this harness stands up a REAL dbus-daemon whose configuration <include>s
# the shipped file verbatim, owns the name from a root connection, and then
# drives root and non-root clients at it.
#
# Every guard is exercised in BOTH directions. A refusal-only suite would pass
# just as well against a policy that denied everything, including root, which is
# the one failure a "non-root is refused" test cannot see.
#
# Needs root (to drop to uid 65534 with setpriv) plus dbus-daemon and python3.
# It fails loudly when it cannot run rather than skipping: a skipped case that
# prints nothing reads exactly like a passing one.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${HERE}/../.." && pwd)
POLICY="${REPO_ROOT}/mosd/dist/com.mos.mosd.conf"
NAME=com.mos.mosd

[ -f "${POLICY}" ] || { echo "no ${POLICY} to test" >&2; exit 1; }
for tool in dbus-daemon setpriv python3; do
    command -v "${tool}" >/dev/null 2>&1 || {
        echo "required tool not available: ${tool}" >&2
        exit 1
    }
done
[ "$(id -u)" -eq 0 ] || {
    echo "must run as root: the whole point is dropping to an unprivileged uid" >&2
    exit 1
}

WORK=$(mktemp -d)
BUS_PID=""
SERVER_PIDS=()
cleanup() {
    for pid in ${SERVER_PIDS[@]+"${SERVER_PIDS[@]}"}; do
        kill "${pid}" 2>/dev/null || true
    done
    [ -n "${BUS_PID}" ] && kill "${BUS_PID}" 2>/dev/null || true
    rm -rf "${WORK}"
}
trap cleanup EXIT
chmod 0755 "${WORK}"

PASS=0
FAIL=0
check() {
    local name=$1 want=$2 got=$3
    if [ "$want" = "$got" ]; then
        PASS=$((PASS + 1))
        echo "PASS $name"
    else
        FAIL=$((FAIL + 1))
        echo "FAIL $name: expected [$want], got [$got]"
    fi
}

# --- the minimal D-Bus client ------------------------------------------------
# python3 stdlib only: there are no D-Bus bindings on this host and adding a
# dependency is out of scope. It speaks just enough of the wire protocol to own
# a name, make a method call, emit a signal and subscribe to one -- which is
# exactly the set of operations the policy governs.
#
# dbus-send cannot stand in for it: it makes method calls only, so it can test
# neither own= nor receive_sender=. dbus-monitor cannot either, because
# monitoring goes through BecomeMonitor/eavesdrop, a different policy path from
# the ordinary signal delivery the SettingsChanged broadcast actually uses.
CLIENT="${WORK}/dbusclient.py"
cat >"${CLIENT}" <<'PY'
"""Minimal D-Bus client, stdlib only. Modes: serve | call | own | recv."""
import binascii
import os
import select
import socket
import struct
import sys
import time

LITTLE = ord('l')
METHOD_CALL, METHOD_RETURN, ERROR, SIGNAL = 1, 2, 3, 4
# Header field code -> its variant type. Only the codes this client uses.
FIELD_TYPE = {1: 'o', 2: 's', 3: 's', 4: 's', 5: 'u', 6: 's', 7: 's', 8: 'g'}
PATH = '/com/mos/mosd'
IFACE = 'com.mos.mosd1'


def pad(buf, n):
    while len(buf) % n:
        buf.append(0)


def put_u32(buf, v):
    pad(buf, 4)
    buf.extend(struct.pack('<I', v))


def put_str(buf, v):
    b = v.encode()
    pad(buf, 4)
    buf.extend(struct.pack('<I', len(b)))
    buf.extend(b)
    buf.append(0)


def put_sig(buf, v):
    b = v.encode()
    buf.append(len(b))
    buf.extend(b)
    buf.append(0)


def put_val(buf, code, v):
    if code in 'so':
        put_str(buf, v)
    elif code == 'u':
        put_u32(buf, v)
    elif code == 'g':
        put_sig(buf, v)
    else:
        raise ValueError('unhandled type ' + code)


def get_u32(buf, off):
    off = (off + 3) & ~3
    return struct.unpack_from('<I', buf, off)[0], off + 4


def get_str(buf, off):
    n, off = get_u32(buf, off)
    return buf[off:off + n].decode('utf-8', 'replace'), off + n + 1


def get_sig(buf, off):
    n = buf[off]
    off += 1
    return buf[off:off + n].decode(), off + n + 1


def get_val(buf, off, code):
    if code in 'so':
        return get_str(buf, off)
    if code == 'u':
        return get_u32(buf, off)
    if code == 'g':
        return get_sig(buf, off)
    raise ValueError('unhandled type ' + code)


def parse(raw):
    _, mtype, _, _, body_len, serial = struct.unpack_from('<BBBBII', raw, 0)
    fields_len = struct.unpack_from('<I', raw, 12)[0]
    fields, off, end = {}, 16, 16 + fields_len
    while off < end:
        off = (off + 7) & ~7
        code = raw[off]
        off += 1
        sig, off = get_sig(raw, off)
        val, off = get_val(raw, off, sig)
        fields[code] = val
    body_off = (end + 7) & ~7
    return {
        'type': mtype,
        'serial': serial,
        'fields': fields,
        'body': raw[body_off:body_off + body_len],
        'sig': fields.get(8, ''),
    }


def body_args(sig, body):
    out, off = [], 0
    for code in sig:
        val, off = get_val(body, off, code)
        out.append(val)
    return out


class Conn:
    def __init__(self, path):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(path)
        self.serial = 0
        self.buf = bytearray()
        self.sock.sendall(b'\0')
        uid = binascii.hexlify(str(os.getuid()).encode())
        self.sock.sendall(b'AUTH EXTERNAL ' + uid + b'\r\n')
        line = self._readline()
        if not line.startswith(b'OK'):
            raise RuntimeError('EXTERNAL auth refused: %r' % line)
        self.sock.sendall(b'BEGIN\r\n')
        reply = self.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
                          'org.freedesktop.DBus', 'Hello', '', [])
        if reply is None or reply['type'] == ERROR:
            raise RuntimeError('Hello refused')
        self.unique = body_args('s', reply['body'])[0]

    def _readline(self):
        out = bytearray()
        while not out.endswith(b'\r\n'):
            b = self.sock.recv(1)
            if not b:
                raise RuntimeError('connection closed during auth')
            out.extend(b)
        return bytes(out)

    def send(self, mtype, fields, sig='', args=(), flags=0):
        self.serial += 1
        body = bytearray()
        for code, arg in zip(sig, args):
            put_val(body, code, arg)
        items = list(fields.items())
        if sig:
            items.append((8, sig))
        packed = bytearray()
        for code, val in items:
            pad(packed, 8)
            packed.append(code)
            put_sig(packed, FIELD_TYPE[code])
            put_val(packed, FIELD_TYPE[code], val)
        msg = bytearray(struct.pack('<BBBBII', LITTLE, mtype, flags, 1,
                                    len(body), self.serial))
        msg.extend(struct.pack('<I', len(packed)))
        msg.extend(packed)
        pad(msg, 8)
        msg.extend(body)
        self.sock.sendall(bytes(msg))
        return self.serial

    def _fill(self, want, deadline):
        while len(self.buf) < want:
            left = deadline - time.monotonic()
            if left <= 0:
                return False
            if not select.select([self.sock], [], [], left)[0]:
                continue
            chunk = self.sock.recv(65536)
            if not chunk:
                return False
            self.buf.extend(chunk)
        return True

    def recv(self, timeout):
        deadline = time.monotonic() + timeout
        if not self._fill(16, deadline):
            return None
        body_len = struct.unpack_from('<I', self.buf, 4)[0]
        fields_len = struct.unpack_from('<I', self.buf, 12)[0]
        total = ((16 + fields_len + 7) & ~7) + body_len
        if not self._fill(total, deadline):
            return None
        raw = bytes(self.buf[:total])
        del self.buf[:total]
        return parse(raw)

    def call(self, dest, path, iface, member, sig, args, timeout=5.0):
        serial = self.send(METHOD_CALL,
                           {1: path, 2: iface, 3: member, 6: dest}, sig, args)
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                return None
            msg = self.recv(left)
            if msg is None:
                return None
            if msg['fields'].get(5) == serial:
                return msg

    def request_name(self, name):
        return self.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
                         'org.freedesktop.DBus', 'RequestName', 'su', [name, 0])


def outcome(reply, ok_text):
    if reply is None:
        return 'TIMEOUT'
    if reply['type'] == ERROR:
        return 'ERROR %s' % reply['fields'].get(4, '?')
    return ok_text


def mode_own(sock, name):
    reply = Conn(sock).request_name(name)
    print(outcome(reply, 'OWNED'))


def mode_call(sock, dest):
    conn = Conn(sock)
    reply = conn.call(dest, PATH, IFACE, 'GetSettings', 's', [''])
    print(outcome(reply, 'OK'))


def mode_recv(sock, sender, member, seconds):
    conn = Conn(sock)
    rule = "type='signal',sender='%s',member='%s'" % (sender, member)
    reply = conn.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
                      'org.freedesktop.DBus', 'AddMatch', 's', [rule])
    if reply is None or reply['type'] == ERROR:
        print(outcome(reply, 'MATCHED'))
        return
    deadline = time.monotonic() + float(seconds)
    while True:
        left = deadline - time.monotonic()
        if left <= 0:
            break
        msg = conn.recv(left)
        if msg and msg['type'] == SIGNAL and msg['fields'].get(3) == member:
            print('GOT')
            return
    print('NONE')


def mode_serve(sock, name, member):
    conn = Conn(sock)
    reply = conn.request_name(name)
    if reply is None or reply['type'] == ERROR:
        print(outcome(reply, 'OWNED'), flush=True)
        sys.exit(1)
    print('OWNED', flush=True)
    last = 0.0
    while True:
        msg = conn.recv(0.05)
        if msg and msg['type'] == METHOD_CALL:
            conn.send(METHOD_RETURN,
                      {5: msg['serial'], 6: msg['fields'][7]}, 's', ['{}'])
        now = time.monotonic()
        if now - last >= 0.2:
            last = now
            # Same shape as the real SettingsChanged(path, value_json).
            conn.send(SIGNAL, {1: PATH, 2: IFACE, 3: member}, 'ss',
                      ['access.webAdmin.password_hash', '"$2b$12$secret"'])


MODES = {'own': mode_own, 'call': mode_call, 'recv': mode_recv,
         'serve': mode_serve}
MODES[sys.argv[1]](*sys.argv[2:])
PY
chmod 0755 "${CLIENT}"

# --- the bus configuration ---------------------------------------------------
# The <policy context="default"> stanza below is a verbatim copy of the one in
# the standard dbus system.conf, so the ONLY thing separating this bus from a
# stock system bus is the shipped file it <include>s. Two of those base rules
# matter here: `deny send_type="method_call"` (which is why dropping an allow is
# enough on the send side) and `allow receive_type="signal"` (which is why it is
# NOT enough on the receive side, and the shipped file carries an explicit deny).
SOCK="${WORK}/bus.sock"
BUS_CONF="${WORK}/bus.conf"
cat >"${BUS_CONF}" <<XML
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>system</type>
  <listen>unix:path=${SOCK}</listen>
  <auth>EXTERNAL</auth>

  <policy context="default">
    <allow user="*"/>
    <deny own="*"/>
    <deny send_type="method_call"/>
    <allow send_type="signal"/>
    <allow send_requested_reply="true" send_type="method_return"/>
    <allow send_requested_reply="true" send_type="error"/>
    <allow receive_type="method_call"/>
    <allow receive_type="method_return"/>
    <allow receive_type="error"/>
    <allow receive_type="signal"/>
    <allow send_destination="org.freedesktop.DBus"
           send_interface="org.freedesktop.DBus"/>
  </policy>

  <!-- TEST SCAFFOLDING, not part of anything shipped. com.mos.control is a
       deliberately OPEN name and com.mos.unprivileged is a deliberately ownable
       one. They are the controls: without them "nobody was refused" cannot be
       told apart from "the unprivileged connection never worked", and every
       refusal below would be indistinguishable from a broken harness. -->
  <policy user="root">
    <allow own="com.mos.control"/>
  </policy>
  <policy context="default">
    <allow own="com.mos.unprivileged"/>
    <allow send_destination="com.mos.control"/>
    <allow receive_sender="com.mos.control"/>
  </policy>

  <include>${POLICY}</include>
</busconfig>
XML

dbus-daemon --config-file="${BUS_CONF}" --nofork &
BUS_PID=$!
for _ in $(seq 1 50); do
    [ -S "${SOCK}" ] && break
    sleep 0.1
done
[ -S "${SOCK}" ] || { echo "dbus-daemon did not create ${SOCK}" >&2; exit 1; }
chmod 0777 "${SOCK}"

# Own com.mos.mosd (the name under test) and com.mos.control (the open control)
# from two SEPARATE root connections. One connection owning both would defeat
# the control outright: receive_sender= matches on the sending CONNECTION's
# names, so a deny on com.mos.mosd would suppress the control name's signals too.
start_server() {
    local name=$1 log=$2
    setsid python3 "${CLIENT}" serve "${SOCK}" "${name}" SettingsChanged >"${log}" 2>&1 &
    SERVER_PIDS+=($!)
    for _ in $(seq 1 50); do
        [ -s "${log}" ] && break
        sleep 0.1
    done
    head -n1 "${log}"
}

owned_mosd=$(start_server "${NAME}" "${WORK}/server-mosd.log")
owned_ctl=$(start_server com.mos.control "${WORK}/server-ctl.log")

as_root() { python3 "${CLIENT}" "$@" 2>&1 | tail -n1; }
as_nobody() {
    setpriv --reuid=65534 --regid=65534 --clear-groups \
        python3 "${CLIENT}" "$@" 2>&1 | tail -n1
}

# `awk 'NR == 1'`, not `| head -n1`: head closes the pipe after its line,
# dbus-daemon takes SIGPIPE, and the `set -euo pipefail` at :19 turns that 141
# into a failed run of the whole suite at its very first banner line. awk reads
# to EOF, so there is no early exit for dbus-daemon to be signalled by.
echo "bus: ${SOCK} (dbus-daemon $(dbus-daemon --version | awk 'NR == 1 {print $NF}'))"
echo "policy under test: ${POLICY}"
echo

# --- 0. the harness itself works ---------------------------------------------
# Without these the whole suite could be measuring a bus nobody can reach.
check "root owns ${NAME} (the daemon's own identity)" "OWNED" "${owned_mosd}"
check "root owns the control name" "OWNED" "${owned_ctl}"
check "nobody can connect and own an unrestricted name" "OWNED" \
    "$(as_nobody own "${SOCK}" com.mos.unprivileged)"
check "nobody can call an unrestricted name" "OK" \
    "$(as_nobody call "${SOCK}" com.mos.control)"
check "nobody can receive a signal from an unrestricted name" "GOT" \
    "$(as_nobody recv "${SOCK}" com.mos.control SettingsChanged 3)"
echo

# --- 1. send: non-root refused, root permitted -------------------------------
check "non-root SEND to ${NAME} is refused" \
    "ERROR org.freedesktop.DBus.Error.AccessDenied" \
    "$(as_nobody call "${SOCK}" "${NAME}")"
check "root SEND to ${NAME} is permitted" "OK" "$(as_root call "${SOCK}" "${NAME}")"
echo

# --- 2. receive: non-root refused, root permitted ----------------------------
# SettingsChanged carries the settings VALUE, so a uid that can subscribe reads
# every change as it happens whether or not it may call anything.
check "non-root RECEIVE of SettingsChanged from ${NAME} is refused" "NONE" \
    "$(as_nobody recv "${SOCK}" "${NAME}" SettingsChanged 3)"
check "root RECEIVE of SettingsChanged from ${NAME} is permitted" "GOT" \
    "$(as_root recv "${SOCK}" "${NAME}" SettingsChanged 3)"
echo

# --- 3. own: non-root refused ------------------------------------------------
# The permitted direction is check 0's "root owns com.mos.mosd": the name is
# owned by a root connection for the entire run, which is the only reason any
# of the send and receive cases above have anything to talk to.
check "non-root OWN of ${NAME} is refused" \
    "ERROR org.freedesktop.DBus.Error.AccessDenied" \
    "$(as_nobody own "${SOCK}" "${NAME}")"

echo
echo "$PASS passed, $FAIL failed"
echo "RESULT: $([ "$FAIL" -eq 0 ] && echo PASS || echo FAIL) ($PASS/$((PASS + FAIL)) checks)"
[ "$FAIL" -eq 0 ]
