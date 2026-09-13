# pkgs — source this repository compiles into a shipped artefact

The organising rule, and the whole of it: a child of `pkgs/` holds source
this repository compiles into a shipped artefact. Something the build merely
*uses* — a pinned builder image, a board definition, a test harness — belongs
elsewhere in the repository.

One member is left after the split of `20260911-2006-split-package-repositories`
(in `ybolab/mica`): `mica-boot/`, the UKI/FIT and initramfs tooling and the
development signing inputs. The packages that used to be built here --
the container engine, the deployment tools, the management daemon -- are
their own repositories (`ybolab/mica-podman`, `ybolab/mica-deploy`,
`ybolab/micad`) and arrive as pinned archives through `deps/packages/`;
`tools/*-pool.sh` reads out of those archives what the assembly still needs
beyond installing them.
