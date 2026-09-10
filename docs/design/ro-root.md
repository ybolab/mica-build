# Authenticated immutable root

The root filesystem is a SquashFS image followed by an explicitly described
no-superblock dm-verity tree. Root and support each have an independent root-hash
signature and complete geometry bound by the deployment envelope.

## Boot

UEFI authenticates a UKI through systemd-boot; cx3576 U-Boot authenticates a FIT.
The signed initramfs contains `mos-init` and fixed boot policy. It authenticates
the selected descriptor, locates the expected SYSTEM partition, opens file-backed
loop devices, creates signature-required verity mappings, mounts root/support
read-only and binds matching modules and firmware before systemd starts.

The kernel's built-in content anchors authenticate PKCS#7 root-hash signatures.
No unsigned retry, editable root geometry, alternate early-init or old-layout
reader is part of the normal boot path. Metadata keys also come from the signed
kernel policy. Full artifact hashes are checked during installation and offline
verification; normal boot does not scan all image bytes before mounting.

Modified content is rejected when its block is read. Boot confirmation requires
all health checks, but does not claim that every unused block has been read.
Failure of a shared SYSTEM or DATA filesystem requires explicit recovery; it is
not cured by cycling all deployment attempts.

## Root ownership

Root owns userspace. Kernel modules, DTBs, boot binaries and firmware are packaged
by independent producers. Root contains empty support mountpoints so the selected
support image can be bound before udev. An updated root does not implicitly
replace its kernel or loader, and an updated kernel reuses a compatible signed
root through a newly signed deployment association.

## Writable paths

See [storage](storage.md) for physical ownership, service binds, quotas and reset
semantics. DATA/var is bound over the whole `/var` tree and accepts new service
directories under a byte/inode project limit. `/var/tmp` shares that budget.
The remaining root stays on read-only SquashFS; `/run` and `/tmp` are volatile.

Machine identity is durably established under DATA/state before systemd and
bound read-only at `/etc/machine-id`; D-Bus resolves the same identity. Invalid
or symbolic identity files are refused rather than silently regenerated. The
random seed uses a fixed symlink to DATA/state/random-seed, outside the general
var quota. Seeding and unit dependencies ensure var and the protected target
exist before random-seed IO.

## Shutdown

Early boot preserves the pinned systemd shutdown executable and ELF closure in
a bounded exitramfs. systemd pivots there to stop userspace and release read-only
root/support mappings, loop devices and backing SYSTEM in dependency order.
Both UEFI architectures have full-runtime shutdown evidence. The gate rejects
incomplete loop/DM teardown rather than treating the final poweroff line alone
as success.
