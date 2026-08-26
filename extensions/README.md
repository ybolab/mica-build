# extensions

The slot for optional image layers. It is empty: the v2 image is a single
squashfs root, and nothing in the build reads this directory.

For something to live here it has to be a systemd sysext image — a layer the
read-only root can carry without being rebuilt — and `os/rootfs` has to gain a
stage that assembles it and a way for the image to declare which layers it
takes. Neither exists.

Optional capabilities today are feature stages in the rootfs chain, declined
with `--without NAME`; see `os/rootfs/stages/README.md`.
