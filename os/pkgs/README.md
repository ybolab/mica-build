# os/pkgs — source this repository compiles into a shipped artefact

The organising rule, and the whole of it: a child of `os/pkgs/` holds source
this repository compiles into a shipped artefact. Something the build merely
*uses* — a pinned builder image, a board definition, a test harness — belongs
elsewhere under `os/`.

The container ones, `podman/` and `rauc/`, share one shape. A `Dockerfile`
whose last stage is `FROM scratch`, exported with `-o` into a gitignored
`out-<arch>/`, so nothing writes into a rootfs; upstream is pinned in
`versions.env`, with the reason for building rather than installing recorded
there. `rauc/build.sh` says it outright — "same driver shape as
os/pkgs/podman/build.sh, and for the same reason". The Rust ones are cargo
workspaces built in the pinned image from `os/build-env/`.

`rauc-sign/` is the member that stretches the rule. It is half build-host
tool, half shipped component: the release half "runs on a build host, never on
a device" (`rauc-sign/README.md:6-7`), while the device half verifies on the device
(`:9`). It lives here because it is source this repository compiles, and
because the alternative — splitting one crate across two trees over which
binary runs where — buys nothing.

`rauc-sign/` arrived here and `mosd/` at M4. Naming the second one
before it landed was correct: this file states the parent's rule, not its
current contents, and a rule written only after the fact is a description
rather than a constraint.
