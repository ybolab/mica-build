# Containers on mos

**mos does not orchestrate containers.** It ships a container engine, turns
`.container` files into systemd units, and gives you one switch to turn the
whole capability off. What runs, in what order, how containers reach each
other and what survives an update are yours to describe — in systemd's terms,
not in a mos-specific format.

This document is the integrator's guide to doing that. Every example below is
extracted by `tests/quadlet-doc-test.sh` and fed to the Quadlet generator this
image actually ships, so an example that stopped working fails the test suite
rather than sitting here looking correct.

---

## 1. What is on the device

| Binary | Path | What it is |
|---|---|---|
| `podman` | `/usr/bin/podman` | the engine. Daemonless — `podman run` forks `conmon`, which execs `crun` |
| `crun` | `/usr/bin/crun` | the OCI runtime |
| `conmon` | `/usr/libexec/podman/conmon` | per-container monitor |
| `quadlet` | `/usr/libexec/podman/quadlet` | the systemd generator |
| `netavark` | `/usr/libexec/podman/netavark` | networking |
| `aardvark-dns` | `/usr/libexec/podman/aardvark-dns` | container-to-container name resolution |
| `catatonit` | `/usr/libexec/podman/catatonit` | container init, for `--init` |
| `docker` | `/usr/bin/docker` | a symlink to `podman`, so the docker command line works |

Versions are pinned in `pkgs/podman/versions.env` and built from upstream source,
not taken from Debian. `podman --version` on the device is the authority.

The `docker` name is a symlink and nothing else. `docker run ...` is
`podman run ...` with the same flags, the same output and the same behaviour;
podman reads `argv[0]` only to name itself, so `docker --version` answers
`docker version 5.8.6` and the usage text says `docker`, and no mode is selected
by the name.

What the name does **not** bring is anything Docker keeps behind its socket:
there is no daemon, no `/run/docker.sock` and no REST API here, so a client that
dials the socket rather than running the binary is no better off. `docker
compose` fails the way `podman compose` does — `Error: looking up compose
provider failed`, because podman shells out to a compose provider and neither
`docker-compose` nor `podman-compose` is on the device. Compose files are not
this image's way of describing a set of containers; section 3 is.

There is **no `podman.socket` and no `podman.service`**. The REST API is not
built into this image, so there is no engine socket to secure — and nothing to
connect to if you were expecting one.

## 2. The switch

`container.enabled` in the management settings tree, `false` by default. It is
read and written through APID, which calls mosd's validated `GetSettings` and
`SetSettings` methods. mosd exports no system Item1 projection, and
`mos-mqttd` admits only application packages enrolled by exact direct
`com.mos.<class>[.<suffix>]` name, with `com.mos.mosd` structurally forbidden,
so container enablement has no MQTT read or write path. `mqtt.enabled` is kept
on the same management side for the same reason: a system lifecycle switch is
not application data.

Turn it on from the Services page in the built-in SPA at `/_ui/`, or through the
same API route. Automation uses a bearer token; a signed-in browser session is
also accepted and its mutations carry the session's CSRF header:

```
curl -X PUT -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  --data 'true' https://<device>/api/v1/settings/container.enabled
```

False means **nothing runs**: `/etc/containers/systemd` is not mounted, so it
is the empty directory inside the read-only root, the generator finds no files,
and no container unit exists.

> **Containers on this device run as root.** Rootless mode is not built, so a
> container is not confined to an unprivileged user. Anything that can write a
> `.container` file into the Quadlet directory can run code with root's
> capabilities on this appliance. That is what the switch gates, and why it is
> off by default.

## 3. Where files go

`/etc/containers/systemd` — a bind of `/mnt/state/quadlet`, on the STATE
partition, so what you put there survives a reboot **and an A/B update**.

That path is not a choice; it is where Quadlet looks. Its search list, printed
by `quadlet --dryrun` itself:

```
/run/containers/systemd  /etc/containers/systemd  /usr/share/containers/systemd
```

After adding or changing a file:

```
systemctl daemon-reload      # re-runs the generator
systemctl start web.service  # or reboot
```

Generators run at boot and at every `daemon-reload`, and **only then**. A file
copied into place changes nothing until one of those happens — the file is
there, the unit does not exist, and nothing reports a problem.

## 4. One container

<!-- quadlet: web.container -->
```ini
[Unit]
Description=Web frontend

[Container]
Image=docker.io/library/nginx:1.27
PublishPort=8080:80

[Service]
Restart=always

[Install]
WantedBy=multi-user.target
```

`web.container` becomes `web.service`. The `[Install]` section is what makes it
start at boot; without it the unit is generated and simply never runs.

**Use a tag, or better a digest.** `nginx` alone resolves through
`unqualified-search-registries` in `/etc/containers/registries.conf` and
`nginx:latest` means a different image next month. On a device that boots
unattended, a fully-qualified reference with a digest is the only form that
means the same thing at every boot:

```
Image=docker.io/library/nginx@sha256:...
```

## 5. Two containers that talk to each other

Put them on a network. Quadlet turns a `.network` file into a unit the same way.

<!-- quadlet: app.network -->
```ini
[Network]
NetworkName=app
Subnet=10.89.0.0/24
```

<!-- quadlet: db.container -->
```ini
[Unit]
Description=Database

[Container]
Image=docker.io/library/postgres:17
Network=app.network
NetworkAlias=db
Environment=POSTGRES_PASSWORD_FILE=/run/secrets/pg
Volume=pgdata.volume:/var/lib/postgresql/data

[Install]
WantedBy=multi-user.target
```

<!-- quadlet: api.container -->
```ini
[Unit]
Description=API
Requires=db.service
After=db.service

[Container]
Image=docker.io/library/alpine:3.21
Network=app.network
Exec=sh -c "until nc -z db 5432; do sleep 1; done; exec /app/server"

[Install]
WantedBy=multi-user.target
```

**`api` reaches `db` by the name `db`.** That is `aardvark-dns`, which serves
names only to containers on the same network — a container on the default
network cannot resolve `db`, and neither can the host.

### `After=` is not "wait until it is ready"

`Requires=db.service` and `After=db.service` order the *units*: systemd starts
`db.service`, waits for it to report started, and then starts `api.service`.
For a container, "started" means the container process was created. Postgres
inside it has not finished initialising.

This is the single most common way a two-container setup fails, and it fails
intermittently — fast enough on a warm boot, too slow after a power cut. The
`until nc -z` loop above is in the example for that reason: **the readiness
check belongs to the client**, because only the client knows what ready means.
`Notify=healthy` plus a `HealthCmd` is the other way, and it moves the same
knowledge into the server's unit rather than removing the need for it.

## 6. Persistence

<!-- quadlet: pgdata.volume -->
```ini
[Volume]
VolumeName=pgdata
```

A named volume lives under the graph root, which on this device is
`/mos/containers/storage` — the MOS-owned namespace on the DATA partition.

Two consequences worth stating plainly:

- **DATA is shared.** Customer UI bundles and application data live on the same
  partition. A container that logs without rotation fills the partition the
  device's own UI is served from.
- **`/var` is not an option.** It is the EPHEMERAL partition: 512 MiB, and
  wiped by design. Bind-mounting a container's data there gives you storage
  that works for months and then is gone with no error anywhere.

For a bind mount of a host path, use one under `/srv`:

<!-- quadlet: logger.container -->
```ini
[Unit]
Description=Log collector

[Container]
Image=docker.io/library/busybox:1.37
Volume=/srv/appdata/logs:/logs:Z
Exec=tail -F /logs/app.log

[Install]
WantedBy=multi-user.target
```

## 7. Logs

`log_driver = "journald"` is set in `/etc/containers/containers.conf`, so
container output goes to the journal:

```
journalctl -u web.service -f
```

The journal is on `/var` — EPHEMERAL. Logs do not survive a wipe, and that is
deliberate: a device that keeps every container's stdout forever fills the
partition its own updates need.

## 8. Images

**mos does not update your containers.** There is no `podman-auto-update.timer`
in this image; that unit is not built. Pulling a new image, restarting the unit,
and deciding when that is safe are the integrator's, and the reason is the same
one that makes mos's own updates A/B and signed: an update that can happen
without a decision is an update that can happen at the wrong moment.

`/etc/containers/policy.json` ships as:

```json
{ "default": [{ "type": "insecureAcceptAnything" }] }
```

**Read that literally: image signatures are not verified.** What protects a
pull is TLS to the registry and, if you use one, a digest reference. This is
upstream's default and Debian's, and mos keeps it because mos has no way to
distribute your signing keys — but it is a decision, not an oversight. If your
deployment can carry a key, replace the file: `containers-policy.json(5)`
describes the `signedBy` form.

## 9. What to check when something does not start

| Symptom | Where to look |
|---|---|
| the unit does not exist | `systemctl daemon-reload`; then `/usr/libexec/podman/quadlet --dryrun` prints parse errors |
| unit exists, never started | no `[Install]` section, so nothing wants it |
| `unable to execute nft` | should not happen — `nftables` is in the image; report it |
| container starts, then exits 0 | the `Exec=` finished. A container is not a service because it is in a unit |
| name does not resolve | the two containers are not on the same `.network` |
| storage full | `podman system df`; check `/srv` against the UI bundles sharing it |

## 10. What mos will not do for you

Restated because it is the whole shape of this document: no compose file, no
dependency resolution beyond systemd's, no health-based restart orchestration,
no image update policy, no secret store. If you need those, they are ordinary
systemd and podman features and this document has shown where each attaches.

The reason is not minimalism. An orchestrator is a second thing that decides
when your application runs, and mos already has one — systemd — that the rest
of the device is built on. Two would have to agree.
