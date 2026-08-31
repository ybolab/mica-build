#!/bin/sh
# Remove any sshd host key the assembly generated, and prove none survived.
#
# Called from os/rootfs/stages/90-pack.Dockerfile (pack stage), where the reasoning lives.

set -eu
before="$(find /rootfs/etc/ssh -maxdepth 1 -name 'ssh_host_*' 2>/dev/null | wc -l)"
rm -f /rootfs/etc/ssh/ssh_host_*
after="$(find /rootfs/etc/ssh -maxdepth 1 -name 'ssh_host_*' 2>/dev/null | wc -l)"
[ "${after}" -eq 0 ] ||
    { echo "error: ${after} sshd host key file(s) are still in /etc/ssh after the removal. A signed rootfs is byte-identical on every device, so a host key baked into one is a private key the whole fleet shares -- and it is also what would make the verity root hash differ on every cold build, because keygen is random" >&2; exit 1; }
# The count is printed rather than assumed to be zero, and it differs between
# the two paths on purpose. The stage chain removes the set in stages/10-base,
# immediately after openssh-server's postinst generates it, so this reports 0
# and is a tripwire. The composer has no such step -- openssh-server arrives
# through mos-system's Depends and its postinst runs inside the one apt
# transaction -- so this reports the real set and is the removal itself.
echo "ssh: ${before} host key file(s) removed from the packed root (mos-seed-state generates a per-device set into STATE)"
