#!/usr/bin/env bash
# Live-bus tests for the SHIPPED D-Bus policies: mosd/dist/com.mos.mosd.conf
# (sections 0-3) and mosd/dist/com.mos.ext.conf (section 5).
#
#   bash mosd/hack/dbus-policy-test.sh
#
# The policies claim com.mos.mosd is reachable only by root and that extensions
# may own com.mos.ext.* and nothing else. Reading the XML back and asserting it
# says so proves nothing about what dbus-daemon does with it, so this harness
# stands up REAL dbus-daemons whose configurations <include> the shipped files
# verbatim, owns the name from a root connection, and then drives root and
# non-root clients at them. Each shipped file gets its OWN bus, so a refusal is
# always attributable to the one file under test rather than to the pair.
#
# Every guard is exercised in BOTH directions. A refusal-only suite would pass
# just as well against a policy that denied everything, including root, which is
# the one failure a "non-root is refused" test cannot see.
#
# Section 4 is not about the shipped file at all. It MEASURES what dbus-daemon
# means by own_prefix=, on a bus of its own, because PLAN-011 D5 bets the whole
# com.mos.ext namespace on semantics it recorded as unverified. Sections 4 and 5
# are not redundant: section 4 establishes what own_prefix means independent of
# anything mos ships, section 5 establishes that the file mos actually installs
# behaves that way.
#
# THREE buses per run, one per group -- sections 0-3, section 4, section 5 -- so
# that nothing in one group can explain a result in another. Their only shared
# base is a verbatim copy of the stock system.conf default stanza.
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
MEASURE_BUS_PID=""
EXT_BUS_PID=""
SERVER_PIDS=()
cleanup() {
    for pid in ${SERVER_PIDS[@]+"${SERVER_PIDS[@]}"}; do
        kill "${pid}" 2>/dev/null || true
    done
    [ -n "${BUS_PID}" ] && kill "${BUS_PID}" 2>/dev/null || true
    [ -n "${MEASURE_BUS_PID}" ] && kill "${MEASURE_BUS_PID}" 2>/dev/null || true
    [ -n "${EXT_BUS_PID}" ] && kill "${EXT_BUS_PID}" 2>/dev/null || true
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


def mode_call(sock, dest, iface=IFACE, member='GetSettings', path=PATH):
    # iface/member/path are parameters because send_interface= and
    # send_member= policy rules discriminate on them: a suite that could only
    # ever call one member cannot tell a per-member grant from a blanket one.
    conn = Conn(sock)
    reply = conn.call(dest, path, iface, member, 's', [''])
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


def mode_serve(sock, name, member, iface=IFACE, path=PATH, also=''):
    # `also` is a comma-separated list of extra "iface/member" signals to emit
    # in the same loop. One owner per bus name means a receive_member= grant
    # and its negative control cannot be driven by two servers, so one server
    # broadcasts both.
    extra = [spec.split('/', 1) for spec in also.split(',') if spec]
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
            conn.send(SIGNAL, {1: path, 2: iface, 3: member}, 'ss',
                      ['access.webAdmin.password_hash', '"$2b$12$secret"'])
            for extra_iface, extra_member in extra:
                conn.send(SIGNAL, {1: path, 2: extra_iface, 3: extra_member},
                          'ss', ['access.webAdmin.password_hash',
                                 '"$2b$12$secret"'])


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


# --- 4. own_prefix semantics, MEASURED rather than assumed --------------------
# PLAN-011 D5 hands third-party extensions the com.mos.ext.* namespace and grants
# the whole of it with one rule, <allow own_prefix="com.mos.ext"/>. No deny list
# accompanies it, because system names such as com.mos.mosd are believed to fall
# outside the prefix and so to stay closed under the stock <deny own="*"/>. The
# plan records that belief as NOT verified -- no dbus man page was available on
# the authoring host -- and it is the load-bearing one: if the prefix reached
# com.mos.mosd, a unit with DefaultDependencies=no could claim the daemon's own
# name before mosd does and apid would be talking to an impostor.
#
# This section settles it against a real dbus-daemon, and it deliberately runs
# BEFORE any such policy file exists. The grant under test is a scaffolding
# fragment written into ${WORK}; mosd/dist/com.mos.ext.conf is NOT read here and
# is not created by this measurement. Measuring first and writing the policy
# against the measurement is the point.
#
# It gets its OWN dbus-daemon rather than a second <include> on the bus above,
# for two reasons that both bear on whether the result means anything. On that
# bus com.mos.mosd is already owned by a root connection and the shipped policy
# carries com.mos.mosd rules of its own, so a refusal there could be the shipped
# policy talking rather than own_prefix -- and the mutation that proves this
# section can fail (widening the prefix to com.mos) would then be measuring the
# wrong file. Here the base configuration is the same stock default stanza,
# <deny own="*"/> included, and the scaffolding fragment is the only other rule
# in play, so the own_prefix grant is the only thing on the bus that can hand out
# any name at all.
MEASURE_SOCK="${WORK}/measure.sock"
MEASURE_CONF="${WORK}/measure-bus.conf"
EXT_FRAGMENT="${WORK}/own-prefix-scaffold.conf"

# The single stanza under test. Scaffolding, written into ${WORK}: nothing under
# mosd/dist/ is involved and none is created.
cat >"${EXT_FRAGMENT}" <<XML
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <policy context="default">
    <allow own_prefix="com.mos.ext"/>
  </policy>
</busconfig>
XML

cat >"${MEASURE_CONF}" <<XML
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>system</type>
  <listen>unix:path=${MEASURE_SOCK}</listen>
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

  <include>${EXT_FRAGMENT}</include>
</busconfig>
XML

dbus-daemon --config-file="${MEASURE_CONF}" --nofork &
MEASURE_BUS_PID=$!
for _ in $(seq 1 50); do
    [ -S "${MEASURE_SOCK}" ] && break
    sleep 0.1
done
# Fail loudly. A measurement bus that never came up would otherwise refuse every
# name and read as six tidy AccessDenied results.
[ -S "${MEASURE_SOCK}" ] || {
    echo "measurement dbus-daemon did not create ${MEASURE_SOCK}" >&2
    exit 1
}
chmod 0777 "${MEASURE_SOCK}"

# Unprivileged only. uid 65534 is the identity a third-party extension would run
# as if it were not root, and it is the only identity the single default-context
# grant is supposed to serve; root would be indistinguishable from it here.
measure_own() { as_nobody own "${MEASURE_SOCK}" "$1"; }

DENIED="ERROR org.freedesktop.DBus.Error.AccessDenied"
DBUS_VERSION=$(dbus-daemon --version | awk 'NR == 1 {print $NF}')

echo
echo "measurement bus: ${MEASURE_SOCK} (dbus-daemon ${DBUS_VERSION})"
echo "grant under test: <allow own_prefix=\"com.mos.ext\"/> (scaffolding, ${EXT_FRAGMENT})"
echo

# The positive control. It is what tells "the prefix refused everything else"
# apart from "the unprivileged connection never reached this bus", the same
# reasoning section 0 states for the controls on the shipped-policy bus.
check "own_prefix grants com.mos.ext.foo to an unprivileged uid" "OWNED" \
    "$(measure_own com.mos.ext.foo)"
check "own_prefix grants a deeper suffix, com.mos.ext.sensor.abc123" "OWNED" \
    "$(measure_own com.mos.ext.sensor.abc123)"

# THE load-bearing case. If this is ever OWNED, PLAN-011 D5's namespace decision
# does not hold and the com.mos.ext grant needs an explicit deny list after all.
check "own_prefix does NOT reach the system name com.mos.mosd" "${DENIED}" \
    "$(measure_own com.mos.mosd)"
check "own_prefix does NOT reach a second system-shaped name, com.mos.other" \
    "${DENIED}" "$(measure_own com.mos.other)"

# MEASURED on dbus-daemon 1.12.20, not inferred: own_prefix requires the very
# next character after the prefix to be '.', so com.mos.extra is refused despite
# being a literal string-prefix match. This is the mechanism the com.mos.mosd
# case above rests on -- string-prefix matching would have granted com.mos.mosd
# too -- which is why it is asserted separately rather than assumed.
check "own_prefix requires a '.' separator: com.mos.extra is refused" \
    "${DENIED}" "$(measure_own com.mos.extra)"

# MEASURED on dbus-daemon 1.12.20, not inferred. PLAN-011 states no expectation
# for the bare prefix, and the answer is not the conservative one: own_prefix
# matches the prefix ITSELF, so an unprivileged uid may own com.mos.ext with no
# suffix at all. It is inside the namespace extensions were given, so it grants
# nothing the decision did not intend to give away, but it is a name the D5
# grammar com.mos.ext.<class>[.<suffix>] never contemplated -- anything that
# derives a class from the fourth dotted component has no fourth component here.
check "own_prefix matches the bare prefix itself: com.mos.ext is OWNED" "OWNED" \
    "$(measure_own com.mos.ext)"

# The negative control: a name the grant plainly cannot reach and that the base
# configuration does not open either. Without it, a bus that had somehow lost its
# <deny own="*"/> would still let every refusal case above look like a refusal
# case -- there would be nothing left asserting the default is closed.
check "a name outside the prefix is still refused (org.example.thing)" \
    "${DENIED}" "$(measure_own org.example.thing)"
# --- 5. the SHIPPED extension policy, mosd/dist/com.mos.ext.conf -------------
# Sections 0-3 test com.mos.mosd.conf. This section tests the OTHER shipped
# policy file, on its own dbus-daemon.
#
# Numbered 5, not 4: RFCT-093's own_prefix MEASUREMENT owns section 4. That
# section establishes what dbus-daemon means by own_prefix independent of
# anything mos ships, and this one establishes that the file mos actually
# installs behaves that way. They are not redundant and neither subsumes the
# other -- if the shipped file were deleted tomorrow the measurement would still
# be true, and it would still be irrelevant to the device.
#
# A SEPARATE BUS, and the reason is attribution. This bus <include>s
# com.mos.ext.conf and NOTHING else of ours, so when the unprivileged uid is
# refused com.mos.mosd here, the refusal has exactly one available explanation:
# the extension policy did not grant it and the stock <deny own="*"/> stood.
# Had the bus also included com.mos.mosd.conf the result would have been
# over-determined -- and misleadingly so, because com.mos.mosd.conf does not
# deny own= in the default context at all (it grants own= to root and leans on
# the same stock deny), so a reader would credit the refusal to a rule that is
# not there. Keeping the files apart is what makes this section evidence about
# com.mos.ext.conf rather than about the pair.
#
# BOTH DIRECTIONS are asserted. A suite that only showed system names being
# refused would pass unchanged against a policy file that granted nothing at
# all, which is the single most likely way this file breaks: a typo in the
# prefix costs every extension its bus name and denies nothing that was not
# already denied.
EXT_POLICY="${REPO_ROOT}/mosd/dist/com.mos.ext.conf"
[ -f "${EXT_POLICY}" ] || { echo "no ${EXT_POLICY} to test" >&2; exit 1; }

EXT_SOCK="${WORK}/ext-bus.sock"
EXT_CONF="${WORK}/ext-bus.conf"
cat >"${EXT_CONF}" <<XML
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>system</type>
  <listen>unix:path=${EXT_SOCK}</listen>
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

  <!-- TEST SCAFFOLDING, not part of anything shipped. org.example.harness is
       deliberately ownable and sits OUTSIDE com.mos entirely, so it stays a
       valid control no matter what the shipped file below grants or how it is
       mutated. Without it, "the unprivileged uid was refused com.mos.mosd" and
       "the unprivileged uid could not reach this bus at all" are the same
       observation. -->
  <policy context="default">
    <allow own="org.example.harness"/>
  </policy>

  <include>${EXT_POLICY}</include>
</busconfig>
XML

dbus-daemon --config-file="${EXT_CONF}" --nofork &
EXT_BUS_PID=$!
for _ in $(seq 1 50); do
    [ -S "${EXT_SOCK}" ] && break
    sleep 0.1
done
[ -S "${EXT_SOCK}" ] || { echo "dbus-daemon did not create ${EXT_SOCK}" >&2; exit 1; }
chmod 0777 "${EXT_SOCK}"

echo
echo "extension bus: ${EXT_SOCK}"
echo "policy under test: ${EXT_POLICY}"
echo

# The harness first: everything below is a claim about an unprivileged uid, and
# all of it is worthless if that uid cannot own anything here.
check "ext: nobody can own a scaffolding name outside the namespace" "OWNED" \
    "$(as_nobody own "${EXT_SOCK}" org.example.harness)"
check "ext: nobody is refused an ungranted name outside the namespace" \
    "ERROR org.freedesktop.DBus.Error.AccessDenied" \
    "$(as_nobody own "${EXT_SOCK}" org.example.thing)"
echo

# CAN own extension names. This is the half the whole feature depends on.
check "ext: nobody CAN own com.mos.ext.foo" "OWNED" \
    "$(as_nobody own "${EXT_SOCK}" com.mos.ext.foo)"
check "ext: nobody CAN own com.mos.ext.sensor.abc123 (multi-component suffix)" \
    "OWNED" "$(as_nobody own "${EXT_SOCK}" com.mos.ext.sensor.abc123)"
# own_prefix matches the bare prefix itself. Accepted, and asserted so that it
# stays a decision rather than a surprise: see com.mos.ext.conf's comment.
check "ext: nobody CAN own the bare prefix com.mos.ext" "OWNED" \
    "$(as_nobody own "${EXT_SOCK}" com.mos.ext)"
echo

# CANNOT own system names. com.mos.extra is the load-bearing one: it shares the
# characters "com.mos.ext" and is refused anyway, which is the demonstration
# that own_prefix is not a string-prefix match -- and therefore the reason
# com.mos.mosd is closed without a deny list naming it.
check "ext: nobody CANNOT own com.mos.mosd (the name this must never grant)" \
    "ERROR org.freedesktop.DBus.Error.AccessDenied" \
    "$(as_nobody own "${EXT_SOCK}" com.mos.mosd)"
check "ext: nobody CANNOT own com.mos.other (a future system name, unenumerated)" \
    "ERROR org.freedesktop.DBus.Error.AccessDenied" \
    "$(as_nobody own "${EXT_SOCK}" com.mos.other)"
check "ext: nobody CANNOT own com.mos.extra (own_prefix needs a '.' separator)" \
    "ERROR org.freedesktop.DBus.Error.AccessDenied" \
    "$(as_nobody own "${EXT_SOCK}" com.mos.extra)"


# --- 6. the MQTT bridge's grant, mosd/dist/mos-mqttd.conf --------------------
# The bridge is a NON-ROOT client of a ROOT-ONLY name. Sections 1-2 established
# that com.mos.mosd.conf refuses every non-root uid outright; this section is
# about the file that punches three members through that refusal and must punch
# through nothing else.
#
# BOTH FILES ON ONE BUS, unlike section 5. Section 5 kept the files apart
# because its question was "what does com.mos.ext.conf grant on its own". The
# question here is the opposite: does the grant survive the deny it is layered
# over, in the combination the device actually loads. Split across two buses,
# the interesting result -- an allow overriding a deny in the same context --
# could not occur at all.
#
# THE USERNAME IS SUBSTITUTED, AND THAT LIMIT IS EXPLICIT. <policy user="X">
# resolves X when dbus-daemon starts. mos-mqttd is created by the image, not by
# this host, so a verbatim copy of the shipped file would load a rule that
# matches no uid -- and a rule that matches nothing PASSES a refusal suite for
# the wrong reason, which is the whole failure mode this file exists to avoid.
# So the copy under test substitutes exactly one token, the substitution is
# asserted to have changed exactly one line, and the shipped file's own
# username is asserted separately. That the IMAGE creates mos-mqttd, and that
# the unit runs as it, is os/verify-image-v2.sh's half of the pair -- neither
# half is a claim about the other.
MQTTD_POLICY="${REPO_ROOT}/mosd/dist/mos-mqttd.conf"
[ -f "${MQTTD_POLICY}" ] || { echo "no ${MQTTD_POLICY} to test" >&2; exit 1; }

MQTTD_USER=mos-mqttd
MQTTD_UID=65534
# The ungranted control uid. Distinct from MQTTD_UID because "an unprivileged
# uid is refused" and "the granted uid is allowed" have to be two different
# uids or one of them is unobservable.
#
# It must be a uid that EXISTS. 65533 was the obvious pick and was wrong:
# dbus-daemon answers EXTERNAL auth from an unresolvable uid with
# "REJECTED EXTERNAL", so the client never reaches the policy at all — and the
# case still "failed to call GetItems", which is indistinguishable from a
# policy refusal in every way except the error string. The connectivity check
# below is what keeps that confusion from recurring silently.
OTHER_UID=33

MQTTD_SOCK="${WORK}/mqttd-bus.sock"
MQTTD_CONF="${WORK}/mqttd-bus.conf"
MQTTD_POLICY_COPY="${WORK}/mos-mqttd.subst.conf"
sed "s/user=\"${MQTTD_USER}\"/user=\"${MQTTD_UID}\"/" \
    "${MQTTD_POLICY}" >"${MQTTD_POLICY_COPY}"

echo
echo "mqttd bus: ${MQTTD_SOCK}"
echo "policies under test: ${POLICY} + ${MQTTD_POLICY}"
echo

# The substitution itself, before anything leans on it.
check "mqttd: the shipped policy names exactly one user, and it is ${MQTTD_USER}" \
    "1 ${MQTTD_USER}" \
    "$(grep -Eo '<policy user="[^"]*"' "${MQTTD_POLICY}" |
        sed 's/.*user="\(.*\)"/\1/' | sort -u |
        awk '{u=$0; n++} END {print n" "u}')"
check "mqttd: substituting the username changed exactly one line" "1" \
    "$(diff "${MQTTD_POLICY}" "${MQTTD_POLICY_COPY}" | grep -c '^> ' || true)"

cat >"${MQTTD_CONF}" <<XML
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>system</type>
  <listen>unix:path=${MQTTD_SOCK}</listen>
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

  <include>${POLICY}</include>
  <include>${MQTTD_POLICY_COPY}</include>
</busconfig>
XML

dbus-daemon --config-file="${MQTTD_CONF}" --nofork --print-address \
    >"${WORK}/mqttd-bus.addr" 2>"${WORK}/mqttd-bus.err" &
MQTTD_BUS_PID=$!
SERVER_PIDS+=("${MQTTD_BUS_PID}")
for _ in $(seq 1 50); do
    [ -S "${MQTTD_SOCK}" ] && break
    sleep 0.1
done
[ -S "${MQTTD_SOCK}" ] || {
    echo "mqttd bus did not start: $(cat "${WORK}/mqttd-bus.err")" >&2
    exit 1
}
chmod 0777 "${MQTTD_SOCK}"

# One root server owns com.mos.mosd and broadcasts BOTH signals: ItemsChanged
# on com.mos.Item1 (granted) and SettingsChanged on com.mos.mosd1 (not).
setsid python3 "${CLIENT}" serve "${MQTTD_SOCK}" "${NAME}" ItemsChanged \
    com.mos.Item1 /com/mos/mosd com.mos.mosd1/SettingsChanged \
    >"${WORK}/mqttd-server.log" 2>&1 &
SERVER_PIDS+=($!)
for _ in $(seq 1 50); do
    [ -s "${WORK}/mqttd-server.log" ] && break
    sleep 0.1
done

as_mqttd() {
    setpriv --reuid="${MQTTD_UID}" --regid="${MQTTD_UID}" --clear-groups \
        python3 "${CLIENT}" "$@" 2>&1 | tail -n1
}
as_other() {
    setpriv --reuid="${OTHER_UID}" --regid="${OTHER_UID}" --clear-groups \
        python3 "${CLIENT}" "$@" 2>&1 | tail -n1
}

# The harness first. Every claim below is about a bus with a live owner on it.
check "mqttd: root owns ${NAME} on the combined bus" "OWNED" \
    "$(head -n1 "${WORK}/mqttd-server.log")"
check "mqttd: root can still reach ${NAME} (the grant did not break root)" "OK" \
    "$(as_root call "${MQTTD_SOCK}" "${NAME}")"

echo
# GRANTED. This is the half the feature depends on: without it the bridge
# publishes nothing, silently, and the unit still reports active.
check "mqttd: the bridge's uid CAN call com.mos.Item1.GetItems" "OK" \
    "$(as_mqttd call "${MQTTD_SOCK}" "${NAME}" com.mos.Item1 GetItems /)"
check "mqttd: the bridge's uid CAN call com.mos.Item1.SetValue" "OK" \
    "$(as_mqttd call "${MQTTD_SOCK}" "${NAME}" com.mos.Item1 SetValue /hostname)"
check "mqttd: the bridge's uid CAN receive com.mos.Item1.ItemsChanged" "GOT" \
    "$(as_mqttd recv "${MQTTD_SOCK}" "${NAME}" ItemsChanged 3)"

echo
# REFUSED. The reason the grant is per-member: mos-mqttd is the only daemon in
# the image holding a network socket, and these are the members that would turn
# a bridge compromise into device control.
check "mqttd: the bridge's uid CANNOT call com.mos.mosd1.Reboot" \
    "ERROR org.freedesktop.DBus.Error.AccessDenied" \
    "$(as_mqttd call "${MQTTD_SOCK}" "${NAME}" com.mos.mosd1 Reboot)"
check "mqttd: the bridge's uid CANNOT call com.mos.mosd1.PowerOff" \
    "ERROR org.freedesktop.DBus.Error.AccessDenied" \
    "$(as_mqttd call "${MQTTD_SOCK}" "${NAME}" com.mos.mosd1 PowerOff)"
check "mqttd: the bridge's uid CANNOT call SetTransientRootPassword" \
    "ERROR org.freedesktop.DBus.Error.AccessDenied" \
    "$(as_mqttd call "${MQTTD_SOCK}" "${NAME}" com.mos.mosd1 SetTransientRootPassword)"
check "mqttd: the bridge's uid CANNOT call com.mos.mosd1.SetSettings" \
    "ERROR org.freedesktop.DBus.Error.AccessDenied" \
    "$(as_mqttd call "${MQTTD_SOCK}" "${NAME}" com.mos.mosd1 SetSettings)"
# The same interface the grant names, a member it does not: proves the rule
# discriminates on send_member= and not merely on send_interface=.
check "mqttd: the bridge's uid CANNOT call com.mos.Item1.GetValue (ungranted member)" \
    "ERROR org.freedesktop.DBus.Error.AccessDenied" \
    "$(as_mqttd call "${MQTTD_SOCK}" "${NAME}" com.mos.Item1 GetValue /hostname)"
# SettingsChanged carries the settings VALUE, including the web admin password
# hash. The bridge is granted ItemsChanged and must not inherit this one.
check "mqttd: the bridge's uid CANNOT receive com.mos.mosd1.SettingsChanged" "NONE" \
    "$(as_mqttd recv "${MQTTD_SOCK}" "${NAME}" SettingsChanged 3)"

echo
# USER-SCOPED. Without this, every check above is equally consistent with the
# grant having reopened the name to all local uids.
#
# CONNECTIVITY FIRST, for both uids. A client that cannot authenticate fails
# every call below, and fails them in a way that reads as a policy refusal
# unless something checks — which is not hypothetical: the control uid was
# 65533 until this suite reported it "refused" for having no passwd entry.
#
# The three outcomes are distinguishable, so the check classifies rather than
# matching one string. Calling GetId on the bus daemon with a body it does not
# take answers InvalidArgs, and an InvalidArgs is a STRONGER connectivity
# proof than a success would be: the daemon accepted the connection, accepted
# the message, and parsed its body far enough to object to it.
connectivity() {
    case "$1" in
    RuntimeError*) echo "AUTH-REFUSED" ;;
    "ERROR org.freedesktop.DBus.Error.AccessDenied") echo "POLICY-REFUSED" ;;
    TIMEOUT) echo "NO-ANSWER" ;;
    *) echo "CONNECTED" ;;
    esac
}
check "mqttd: the bridge's uid is connected (so its refusals are policy, not auth)" \
    "CONNECTED" \
    "$(connectivity "$(as_mqttd call "${MQTTD_SOCK}" org.freedesktop.DBus org.freedesktop.DBus GetId /org/freedesktop/DBus)")"
check "mqttd: the control uid is connected (so its refusals are policy, not auth)" \
    "CONNECTED" \
    "$(connectivity "$(as_other call "${MQTTD_SOCK}" org.freedesktop.DBus org.freedesktop.DBus GetId /org/freedesktop/DBus)")"
check "mqttd: another unprivileged uid CANNOT call GetItems (the grant is user-scoped)" \
    "ERROR org.freedesktop.DBus.Error.AccessDenied" \
    "$(as_other call "${MQTTD_SOCK}" "${NAME}" com.mos.Item1 GetItems /)"
check "mqttd: another unprivileged uid CANNOT receive ItemsChanged" "NONE" \
    "$(as_other recv "${MQTTD_SOCK}" "${NAME}" ItemsChanged 3)"

echo
echo "$PASS passed, $FAIL failed"
echo "RESULT: $([ "$FAIL" -eq 0 ] && echo PASS || echo FAIL) ($PASS/$((PASS + FAIL)) checks)"
[ "$FAIL" -eq 0 ]
