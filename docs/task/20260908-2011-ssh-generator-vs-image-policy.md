# 20260908-2011-ssh-generator-vs-image-policy systemd-ssh-generator overrides the image's SSH policy and port

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-09-08 20:11

## Description

Two interactions between the shipped `systemd-ssh-generator` and the image's own
SSH policy, both measured: (1) `ssh.service` fails `exit-code` when the
generator's `sshd-extra.socket` already listens on port 22 (reached when
`systemd.ssh_listen=` is set on the kernel command line); (2) the generated
`sshd@.service` starts sshd with `-o "AuthorizedKeysFile <credential>
.ssh/authorized_keys"`, and OpenSSH keeps the first value, so the image's
`sshd_config.d/05-mos-authorized-keys.conf` (`/etc/ssh/authorized_keys.d/%u`)
does not apply under the generator. mosd's reconciler renders that file from
`settings.access.ssh.keys` and is the intended source of truth.

Acceptance: decide whether the generator's listen path is masked or the image's
authorized-keys policy is made to hold under it; a negative test for each
interaction (port conflict; a key placed only where the image's policy names it
must, or must not, authenticate — whichever the decision says); `docs/design/access.md`
states the result.

## ActiveForm

Not started.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Surfaced by the P1-B writable-path audit (`docs/task/20260908-1712-p1-writable-path-audit.md` §11), measured on x64 under QEMU; recorded there, not repaired there.
