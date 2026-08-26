#!/bin/sh
# Validate the image profile and write /usr/lib/mos/profile.conf.
#
# Called from os/rootfs/stages/10-base.Dockerfile (rootfs stage), where the reasoning lives.
# Build arguments read from the environment: MOS_PROFILE.

set -eu
case "${MOS_PROFILE}" in
dev | prod) ;;
*) echo "error: MOS_PROFILE is '${MOS_PROFILE}'; it must be exactly 'dev' or 'prod' in lowercase. mosd's comparison is case-sensitive and every other value resolves to prod, which silently disables SSH" >&2; exit 1 ;;
esac
mkdir -p /usr/lib/mos
printf 'MOS_PROFILE=%s\n' "${MOS_PROFILE}" > /usr/lib/mos/profile.conf
chmod 0444 /usr/lib/mos/profile.conf
echo "profile: MOS_PROFILE=${MOS_PROFILE}"
