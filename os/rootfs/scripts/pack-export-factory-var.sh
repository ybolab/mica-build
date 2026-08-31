#!/bin/sh
# Export the factory /var so the assembler can seed EPHEMERAL at assembly.
#
# Called from os/rootfs/compose/90-pack.Dockerfile (pack stage), where the reasoning lives.

set -eu
[ -d /rootfs/usr/share/factory/var ] || { echo "error: /usr/share/factory/var is not in the packed root; the EPHEMERAL filesystem would be assembled empty and /var would have no dpkg database, no spool and no mosd state directory" >&2; exit 1; }
mkdir -p /out/factory-var
cp -a /rootfs/usr/share/factory/var/. /out/factory-var/
n="$(find /out/factory-var | wc -l)"
[ "${n}" -gt 10 ] || { echo "error: the exported factory /var has only ${n} entries; an almost-empty tree here would seed an almost-empty /var and every check downstream would pass" >&2; exit 1; }
echo "factory var: ${n} entries, $(du -sk /out/factory-var | cut -f1) KB"
