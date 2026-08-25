#!/bin/sh
# Create the pinned mos operator account (uid/gid 1000) and assert its grant.
#
# Called from os/rootfs/Dockerfile.v2 (rootfs stage), where the reasoning lives.

set -eu
test -x /bin/bash ||
    { echo "error: /bin/bash is not in the image, so it cannot be the mos login shell" >&2; exit 1; }
groupadd --gid 1000 mos
useradd --uid 1000 --gid 1000 --no-create-home --home-dir /home/mos \
        --shell /bin/bash --comment "mos operator" mos
chage -d 2020-01-01 mos
ent="$(awk -F: '$1 == "mos"' /etc/passwd)"
[ "$(echo "${ent}" | cut -d: -f3,4,6,7)" = "1000:1000:/home/mos:/bin/bash" ] ||
    { echo "error: the mos entry in /etc/passwd is '${ent}', expected uid 1000, gid 1000, home /home/mos, shell /bin/bash" >&2; exit 1; }
[ "$(awk -F: '$1 == "mos" { print $3; exit }' /etc/group)" = "1000" ] ||
    { echo "error: the mos group is not gid 1000" >&2; exit 1; }
extra="$(awk -F: '$1 != "mos" && $4 ~ /(^|,)mos(,|$)/ { print $1 }' /etc/group | tr '\n' ' ')"
[ -z "${extra}" ] ||
    { echo "error: mos is a member of supplementary group(s): ${extra}; phase 1 grants none, and no sudo" >&2; exit 1; }
mh="$(awk -F: '$1 == "mos" { print $2; exit }' /etc/shadow)"
case "${mh}" in
    "") echo "error: the mos entry in /etc/shadow has an EMPTY password field, which means PASSWORDLESS login: pam_unix accepts any password, including none. Empty is not a locked marker" >&2; exit 1 ;;
    '!'* | '*'*) ;;
    *) echo "error: the mos entry in /etc/shadow carries a usable password hash. A signed rootfs is byte-identical on every device, so any hash inside one is a fleet-wide shared secret" >&2; exit 1 ;;
esac
[ "$(awk -F: '$1 == "mos" { print $3; exit }' /etc/shadow)" = "18262" ] ||
    { echo "error: the mos shadow last-change field is not the pinned day 18262 (2020-01-01)" >&2; exit 1; }
echo "account: mos uid=1000 gid=1000 shell=/bin/bash home=/home/mos, no supplementary groups, shadow field '${mh}'"
