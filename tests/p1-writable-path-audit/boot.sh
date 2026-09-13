#!/usr/bin/env bash
# One x64 QEMU boot with a way in, and the P1-B probe run over it.
#
#   bash qemu-boot.sh <label> <mode>
#
# THE WAY IN IS THE SHIPPED systemd-ssh-generator, not a seeded unit. A unit
# dropped into /mnt/state/systemd-units never runs: systemd enumerates
# multi-user.target.wants when it builds the initial transaction, which is
# before usr-local-lib-systemd-system.mount has bound STATE over
# /usr/local/lib/systemd/system, so the entry does not exist yet and nothing
# reloads afterwards. Measured on the first boot of this audit -- the mount
# succeeds and the unit is still never loaded.
#
# The generator is already active in the image (the console reports
# "Listening on sshd-unix-local.socket ... (systemd-ssh-generator, AF_UNIX
# Local)"). It honours systemd.ssh_listen= on the kernel command line and the
# credential ssh.ephemeral-authorized_keys-all, which the generated
# sshd@.service passes as `-o AuthorizedKeysFile ...` and which therefore
# overrides the image's own AuthorizedKeysFile. Both are set here from the
# command line, so the image is untouched.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
S="${P1_WORK:-$REPO/.tmp/p1-writable-path-audit}"
mkdir -p "$S"
H="$REPO/tests/p1-writable-path-audit"
MICA_PRODUCT="${MICA_PRODUCT:?product name required (make products lists them)}"
eval "$(bash "$REPO/tools/product.sh" "$MICA_PRODUCT")"
export MICA_PRODUCT MICA_BOARD="$BOARD"
LABEL="${1:?label}"
MODE="${2:?mode}"
SSH_PORT="${SSH_PORT:-18022}"
RUN_SECONDS="${RUN_SECONDS:-600}"
QEMU_TIMEOUT="${QEMU_TIMEOUT:-1200}"
NET="${NET:-traefik}"

BUN_IMAGE="$(bash "$REPO/build-env/from.sh" --ref IMAGE_MICA_BUILD_BASE)"
CLI_IMAGE="$(bash "$REPO/build-env/from.sh" --ref IMAGE_DOCKER_CLI_28)"
PORT_IMAGE="localhost/mos-verify-bun:$(printf '%s\n%s\n' "$BUN_IMAGE" "$CLI_IMAGE" | sha256sum | cut -c1-16)"

KEY="$S/p1-ssh-key"
if [ ! -f "$KEY" ]; then
    ssh-keygen -q -t ed25519 -f "$KEY" -N '' -C p1-audit </dev/null
    echo "generated $KEY"
fi
PUBKEY=$(cat "$KEY.pub")
PUBB64=$(base64 -w0 <"$KEY.pub")

# THE KEY GOES IN THROUGH systemd-tmpfiles, not through a seeded partition.
#
# Measured, in this order, all rejected with "Permission denied (publickey)":
#   1. systemd.set_credential_binary=ssh.ephemeral-authorized_keys-all -- PID1
#      reports "Acquired 1 regular credentials" and the listener comes up as
#      sshd-extra.socket, but that socket's service does not carry the
#      ImportCredential= line the unix-local/vsock variants have;
#   2. /etc/ssh/authorized_keys.d/root seeded into STATE, which is what the
#      image's own sshd_config.d/05-mos-authorized-keys.conf names;
#   3. /mos/root/.ssh/authorized_keys seeded into DATA, which is what /root
#      resolves to through root.mount.
#
# systemd-tmpfiles honours the system credential `tmpfiles.extra` (a tmpfiles.d
# snippet), and systemd-tmpfiles-setup.service runs at sysinit.target -- after
# local-fs.target, so /etc/ssh and /root are both bound by then. Writing the
# file from inside the running system sidesteps every question about what
# debugfs left on the partition and what ownership the bind then shows.
TMPFILES_EXTRA=$(printf '%s\n' \
    "d /root/.ssh 0700 root root -" \
    "f+ /root/.ssh/authorized_keys 0600 root root - ${PUBKEY}" \
    "d /etc/ssh/authorized_keys.d 0755 root root -" \
    "f+ /etc/ssh/authorized_keys.d/root 0644 root root - ${PUBKEY}")
TMPB64=$(printf '%s\n' "$TMPFILES_EXTRA" | base64 -w0)

APPEND="systemd.ssh_listen=${SSH_PORT_GUEST:-22}"
APPEND="$APPEND systemd.set_credential_binary=ssh.ephemeral-authorized_keys-all:${PUBB64}"
APPEND="$APPEND systemd.set_credential_binary=tmpfiles.extra:${TMPB64}"

RUN_DIR_REAL="$(readlink -f "$REPO/_out/products/$MICA_PRODUCT/qemu")"

# THE KEY GOES SOMEWHERE micad DOES NOT MANAGE.
#
# The serving sshd reads /etc/ssh/authorized_keys.d/%u -- that is what the
# image's own sshd_config.d/05-mos-authorized-keys.conf sets -- and
# micad:micad/src/reconciler/sshd.rs RENDERS that file from
# settings.access.ssh.keys on every reconcile. With the factory default of no
# keys it renders an empty file, so a key written there by tmpfiles at
# sysinit.target authenticates only until micad starts at multi-user.target.
# Measured three times: boot 1 got in inside that window, boots 2 and 3 answered
# the readiness probe and were then refused seconds later.
#
# /etc/ssh is STATE-backed, and sshd_config's `Include
# /etc/ssh/sshd_config.d/*.conf` is line 12 and globs in sorted order, so a
# `01-` drop-in is read before mos's `05-` one. OpenSSH keeps the FIRST value
# obtained for a keyword, so this wins, and it points at a file micad's
# reconciler does not know about.
if [ "${SEED_KEY:-1}" = "1" ]; then
    conf="$S/01-p1-audit.conf"
    printf 'AuthorizedKeysFile /etc/ssh/p1_authorized_keys\n' >"$conf"
    bash "$REPO/tools/qemu-seed-state.sh" \
        "$conf"     /ssh/sshd_config.d/01-p1-audit.conf \
        "$KEY.pub"  /ssh/p1_authorized_keys
fi

# --- launch the boot in the background -------------------------------------
docker run --rm --label ai-agent=true \
    -v "$REPO:$REPO" -v /var/run/docker.sock:/var/run/docker.sock \
    -w "$REPO/tests/apid-api" \
    -e "MICA_BOARD=$MICA_BOARD" -e "MICA_PRODUCT=$MICA_PRODUCT" \
    -e MICA_QEMU_REUSE_DISK=1 \
    -e "MICA_QEMU_RUN_SECONDS=$RUN_SECONDS" \
    -e "MICA_QEMU_TIMEOUT=$QEMU_TIMEOUT" \
    -e "MICA_QEMU_APPEND=$APPEND" \
    -e MICA_QEMU_FORWARD=1 \
    -e "MICA_QEMU_NETWORK=$NET" \
    -e "MICA_QEMU_SSH_PORT=$SSH_PORT" \
    "$PORT_IMAGE" bun run src/qemu.ts --capture "$S/console-$LABEL.txt" \
    >"$S/qemu-$LABEL.log" 2>&1 &
QEMU_PID=$!
echo "qemu.ts pid $QEMU_PID, console -> $S/console-$LABEL.txt"

cleanup() { kill "$QEMU_PID" 2>/dev/null || true; }
trap cleanup EXIT

# --- find the QEMU container and its address -------------------------------
guest_ip() {
    local id src resolved
    for id in $(docker ps -q 2>/dev/null); do
        for src in $(docker inspect "$id" --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' 2>/dev/null); do
            resolved="$(readlink -f "$src" 2>/dev/null)" || continue
            [ "$resolved" = "$RUN_DIR_REAL" ] || continue
            docker inspect "$id" --format "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" 2>/dev/null
            return 0
        done
    done
    return 1
}

IP=""
for _ in $(seq 1 60); do
    IP="$(guest_ip || true)"
    [ -n "$IP" ] && break
    sleep 2
done
[ -n "$IP" ] || { echo "error: no QEMU container on $NET holding $RUN_DIR_REAL" >&2; wait "$QEMU_PID"; exit 1; }
echo "guest container at $IP:$SSH_PORT"

# --- wait for sshd, then run the probe -------------------------------------
ssh_try() {
    timeout 90 ssh -i "$KEY" -p "$SSH_PORT" \
        -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -o BatchMode=yes -o ConnectTimeout=20 -o LogLevel=ERROR \
        "root@$IP" "$@"
}

# QEMU's hostfwd listener is open before the guest is, so `nc -z` succeeding
# proves nothing. Retry a real SSH command until it answers.
ready=0
for i in $(seq 1 60); do
    if out=$(ssh_try 'echo P1-SSH-READY' 2>&1); then
        case "$out" in *P1-SSH-READY*) echo "sshd answered on attempt $i"; ready=1; break ;; esac
    fi
    last="$out"
    sleep 10
done
if [ "$ready" != 1 ]; then
    echo "error: sshd never accepted a session; last: ${last:-<none>}" >&2
    echo "error: sshd never accepted a session; last: ${last:-<none>}" >"$S/probe-$LABEL.txt"
    wait "$QEMU_PID" || true
    exit 1
fi

set +e
timeout 900 ssh -i "$KEY" -p "$SSH_PORT" \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o BatchMode=yes -o ConnectTimeout=20 -o LogLevel=ERROR \
    "root@$IP" "sh -s $MODE '$PUBKEY'" <"$H/probe.sh" >"$S/probe-$LABEL.txt" 2>&1
rc=$?
set -e
echo "probe exit $rc, $(grep -c 'P1AUDIT|' "$S/probe-$LABEL.txt" 2>/dev/null || echo 0) lines -> $S/probe-$LABEL.txt"

trap - EXIT
echo "waiting for the guest to be powered down by the harness..."
wait "$QEMU_PID" || echo "qemu.ts exit $?"
echo "BOOT-$LABEL-DONE"
