# 20260908-2011-ssh-generator-vs-image-policy systemd-ssh-generator overrides the image's SSH policy and port

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-09-08 20:11

## Description

`systemd-ssh-generator` could listen on port 22 beside `ssh.service` and start
sshd with an `AuthorizedKeysFile` that overrides the image policy
(`/etc/ssh/authorized_keys.d/%u`, rendered by mosd from
`settings.access.ssh.keys`).

Implemented: the generator is masked with `/dev/null` in
`rootfs/packages-src/system/Dockerfile`, and `rootfs/runtime/consumers.json`
declares that mask.

Acceptance outstanding: on a current x64 QEMU image, a negative test proves
that `systemd.ssh_listen=` on the kernel command line causes no listen
conflict, and that a key present only under the image policy path
authenticates. `docs/design/access.md` states the result.

## ActiveForm

Accepting the implemented fix on a current image.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- 2026-09-12: description rewritten against current source during the
  documentation restructure; the original QEMU measurement is in Git history.
