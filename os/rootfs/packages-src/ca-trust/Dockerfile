# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# The ca-trust producer: the `mos-ca-trust` package.
#
#   bash os/rootfs/packages-src/build-deb.sh \
#       --producer-dir os/rootfs/packages-src/ca-trust --arch all
#
# Two stages, because the payload is GENERATED and the packer cannot generate
# it: `generate` installs ca-certificates into the pinned Debian base and lets
# its postinst build the store; `pack` copies the result out and turns it into
# an archive. That split is the same one os/rootfs/stages/10-base.Dockerfile
# makes between its `certs` and `rootfs` stages, and it exists for the same
# reason -- the trust store is wanted, the package that builds it is not.
#
# No default for either base, for the reason os/build-env/deb/Dockerfile gives:
# a driver that failed to pass the argument would otherwise build from a
# floating tag, and here that tag would decide which certificate authorities
# the fleet believes.
ARG MOS_BUILD_DEB
ARG MOS_IMAGE_DEBIAN_TRIXIE


# The generation stage. Not `--platform=$BUILDPLATFORM` as the certs stage in
# stages/10-base is, because there is no second stage here at a different
# platform to contrast with: producer.env declares ARCHES="all", so the driver
# already runs this whole build once, natively, at the host's architecture.
FROM ${MOS_IMAGE_DEBIAN_TRIXIE} AS generate

# The repository's own script, RUN rather than restated. os/rootfs/scripts is a
# read-only source of truth and it arrives as the `scripts` build context
# producer.env names; a copy of these five lines in this file would be a second
# definition of "what is generated today", and the two would come apart at the
# first edit to either. The script leaves /etc/ssl/certs/.mos-cert-count behind,
# which the pack stage below reads and does not ship.
RUN --mount=type=bind,from=scripts,target=/mos-scripts \
    sh /mos-scripts/ca-certificates-generate.sh

# The anchors' own licence, harvested from the package that shipped them rather
# than written out here. ~150 certificates under GPL-2+ and MPL-2.0 are not
# something this repository can restate correctly, and a hand-written summary
# of them would be wrong in a way nobody would notice until it mattered.
RUN install -D -m 0644 /usr/share/doc/ca-certificates/copyright \
    /harvest/ca-certificates.copyright


FROM ${MOS_BUILD_DEB} AS pack

# pack.sh comes over as a named context rather than out of the image. It is the
# packaging CONTRACT, shared by every producer, and os/build-env/deb/README.md
# requires this shape: an edit to the packer then takes effect without
# rebuilding the whole builder family.
COPY --from=packer pack.sh /usr/local/bin/pack.sh

COPY --from=family copyright /in/copyright
COPY control/ /in/control/
COPY --from=generate /harvest/ca-certificates.copyright /in/ca-certificates.copyright

# The three paths stages/10-base copies out of its certs stage, and no others.
# All three are needed and none of them is redundant: ca-certificates.crt is the
# concatenated bundle every TLS library reads by default,
# /usr/share/ca-certificates holds the individual anchors that the hash symlinks
# under /etc/ssl/certs point at -- take the links without the anchors and the
# farm dangles -- and ca-certificates.conf is the list that says which of the
# anchors are enabled.
#
# COPY does not dereference: the 300 symlinks under /etc/ssl/certs arrive AS
# symlinks. That is the point of using it rather than a tar of a resolved tree.
# The hashed names are the lookup mechanism, so a dereferenced copy would both
# double the payload and make `dpkg-deb --contents` describe something other
# than what is installed.
COPY --from=generate /usr/share/ca-certificates /stage/usr/share/ca-certificates
COPY --from=generate /etc/ssl/certs /stage/etc/ssl/certs
COPY --from=generate /etc/ca-certificates.conf /stage/etc/ca-certificates.conf

ARG MOS_DEB_VERSION
ARG MOS_DEB_ARCH
ARG SOURCE_DATE_EPOCH

# What the staged tree must be before it is worth packing. Every assertion here
# is one os/rootfs/scripts/ca-certificates-verify.sh makes today about the tree
# the certs stage handed over, asked of the payload instead -- the package IS
# that handover once the composer switches, and an assertion that moved with it
# is one that keeps being made.
#
# The dangling-link test resolves each target against the PAYLOAD root: an
# absolute target names /usr/share/ca-certificates, which inside this packing
# container is the packer's own store rather than the anchors being staged.
# `-L` is half of the test because the farm is two deep -- `<hash>.0` is a
# relative link to a `<Name>.pem` that is itself an absolute link -- so `-e`
# alone follows the whole chain out of /stage and would call all 150 hashes
# dangling. Every link is checked, so the chain is still covered link by link.
#
# .mos-cert-count is read and DROPPED. It is a build-time token, written by
# ca-certificates-generate.sh so that the receiving stage can detect a COPY that
# truncated the bundle, and ca-certificates-verify.sh reads it and `rm -f`s it
# in the same breath -- it has never been in a shipped root, and os/verify's
# ca-bundle-generated check counts BEGIN CERTIFICATE lines directly rather than
# reading it. Shipping it would add a file to the image that today's image
# deliberately does not have, and there is nothing left for it to guard: a .deb
# carries DEBIAN/md5sums over every payload file, which is a stronger statement
# about arrival than a count. So the token is spent HERE, on the one COPY it can
# still speak about, and then deleted.
RUN set -eu; \
    want="$(cat /stage/etc/ssl/certs/.mos-cert-count)"; \
    rm -f /stage/etc/ssl/certs/.mos-cert-count; \
    test -s /stage/etc/ssl/certs/ca-certificates.crt || \
        { echo "error: the generation stage produced no bundle at /etc/ssl/certs/ca-certificates.crt" >&2; exit 1; }; \
    certs="$(grep -c 'BEGIN CERTIFICATE' /stage/etc/ssl/certs/ca-certificates.crt)"; \
    [ "${certs}" = "${want}" ] || \
        { echo "error: ca-certificates-generate.sh recorded ${want} certificates and ${certs} arrived in the staged payload. A COPY that drops or truncates the bundle leaves TLS working for whatever happens to still verify, which is the hardest version of this failure to notice" >&2; exit 1; }; \
    [ "${certs}" -ge 100 ] || \
        { echo "error: the staged CA bundle holds only ${certs} certificates" >&2; exit 1; }; \
    files="$(find /stage -type f | wc -l)"; \
    links="$(find /stage -type l | wc -l)"; \
    echo "ca-trust: staged ${certs} certificates, ${files} regular files, ${links} symlinks"; \
    [ "${links}" -ge 100 ] || \
        { echo "error: /etc/ssl/certs staged ${links} symlinks. The hash farm is ~300 links over ${certs} anchors; this few means they were dereferenced into copies, and the assertions below would then be searching a tree that cannot fail them" >&2; exit 1; }; \
    find /stage -type l -printf '%p\t%l\n' >/tmp/links; \
    : >/tmp/dangling; \
    while IFS="$(printf '\t')" read -r link target; do \
        case "${target}" in \
        /*) resolved="/stage${target}" ;; \
        *) resolved="$(dirname "${link}")/${target}" ;; \
        esac; \
        { [ -e "${resolved}" ] || [ -L "${resolved}" ]; } || echo "${link} -> ${target}" >>/tmp/dangling; \
    done </tmp/links; \
    [ ! -s /tmp/dangling ] || \
        { echo "error: the staged /etc/ssl/certs has dangling symlinks, resolved against the payload root:" >&2; head -n3 /tmp/dangling >&2; echo "the hash farm points at /usr/share/ca-certificates and that copy did not arrive" >&2; exit 1; }; \
    tooling="$(find /stage \( -name openssl -o -name c_rehash -o -name 'update-ca-certificates*' -o -path '/stage/etc/ca-certificates/*' \) -print | tr '\n' ' ')"; \
    [ -z "${tooling}" ] || \
        { echo "error: the staged payload carries ca-certificates' maintainer tooling: ${tooling}. The certificates are staged as data precisely so that none of it comes with them -- openssl is 2.5 MB of CLI nothing on the device uses (apid's TLS is rustls/rcgen/ring) and c_rehash is Perl, which the package-manager purge's dangling-interpreter check rejects" >&2; exit 1; }; \
    echo "ca-trust: no openssl, no c_rehash, no update-ca-certificates in ${files} files and ${links} links"

# The copyright, composed rather than copied. os/rootfs/packages-src/copyright
# is the shared file for producers whose payload this repository WROTE, and it
# says so itself: a producer packaging Debian-sourced content records that
# content's own licence honestly instead. Here both halves are true at once --
# the anchors are Debian's, this doc directory is mos's -- so the Apache-2.0
# stanza is lifted out of the shared file, scoped to the only path it actually
# covers, and Debian's own copyright is appended verbatim beneath it.
#
# The stanza is extracted from the LAST `License: Apache-2.0` line in the shared
# file, which is the standalone one: the earlier occurrence is the bodiless
# reference inside its `Files: *` paragraph. Extracting rather than retyping
# keeps the licence text in one place in the tree; the extraction fails by name
# if that line ever stops being there, because a copyright silently assembled
# without its licence is the failure this whole file exists to avoid.
RUN set -eu; \
    awk '/^License: Apache-2\.0$/ { last = NR } { l[NR] = $0 } \
        END { \
            if (!last) { print "error: /in/copyright carries no standalone \"License: Apache-2.0\" stanza to lift" >"/dev/stderr"; exit 1 } \
            for (i = last; i <= NR; i++) print l[i] \
        }' /in/copyright >/tmp/apache-2.0; \
    grep -c 'Apache License' /tmp/apache-2.0 >/dev/null || \
        { echo "error: the stanza lifted from /in/copyright carries no Apache licence text" >&2; exit 1; }; \
    install -d -m 0755 /stage/usr/share/doc/mos-ca-trust; \
    { \
        echo 'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/'; \
        echo 'Upstream-Name: mos-ca-trust'; \
        echo 'Comment: The payload of this package is not mos-authored. It is the output of'; \
        echo ' Debian'"'"'s ca-certificates package -- the trust anchors, the hash farm that'; \
        echo ' indexes them and the configuration listing them -- generated from the pinned'; \
        echo ' Debian trixie base at package build time. The mos-authored part is the'; \
        echo ' packaging and this file, so the Apache-2.0 paragraph below is scoped to this'; \
        echo ' doc directory rather than written over the certificates.'; \
        echo ' .'; \
        echo ' Debian'"'"'s own /usr/share/doc/ca-certificates/copyright is reproduced below,'; \
        echo ' verbatim and unedited, harvested during the build. This file is therefore a'; \
        echo ' concatenation and carries a second Format: header: the reproduction is a whole'; \
        echo ' machine-readable file, and truncating it into stanzas of this one would be'; \
        echo ' editing a licence record to make a format check pass. Its Files: paths are'; \
        echo ' ca-certificates'"'"' own SOURCE paths, exactly as Debian wrote them; they do not'; \
        echo ' describe the layout installed here.'; \
        echo ' .'; \
        echo ' One reference in it dangles on the device: its GPL-2+ paragraph points at'; \
        echo ' /usr/share/common-licenses/GPL-2, and the mos image does not ship that'; \
        echo ' directory. It is left as Debian wrote it. Rewriting the text of a licence so'; \
        echo ' that a pointer resolves is the one edit that must not be made quietly, and the'; \
        echo ' full MPL-2.0 and GPL-2+ terms are carried below in any case.'; \
        echo ''; \
        echo 'Files: usr/share/doc/mos-ca-trust/*'; \
        echo 'Copyright: The mos project'; \
        echo 'License: Apache-2.0'; \
        echo ''; \
        cat /tmp/apache-2.0; \
        echo ''; \
        echo '# --------------------------------------------------------------------------'; \
        echo '# Below: /usr/share/doc/ca-certificates/copyright, as shipped by the'; \
        echo '# ca-certificates package of the pinned Debian trixie base these anchors were'; \
        echo '# generated from. Reproduced verbatim.'; \
        echo '# --------------------------------------------------------------------------'; \
        echo ''; \
        cat /in/ca-certificates.copyright; \
    } >/stage/usr/share/doc/mos-ca-trust/copyright; \
    chmod 0644 /stage/usr/share/doc/mos-ca-trust/copyright; \
    grep -c 'Apache License' /stage/usr/share/doc/mos-ca-trust/copyright >/dev/null || \
        { echo "error: the composed copyright lost the Apache-2.0 text" >&2; exit 1; }; \
    grep -c 'Mozilla Public License' /stage/usr/share/doc/mos-ca-trust/copyright >/dev/null || \
        { echo "error: the composed copyright lost the harvested ca-certificates text" >&2; exit 1; }; \
    echo "ca-trust: copyright composed, $(wc -l </stage/usr/share/doc/mos-ca-trust/copyright) lines"

# No maintainer scripts and no enablement links: this package owns no unit and
# nothing has to run after it is unpacked -- update-ca-certificates already ran,
# in the generation stage, which is the whole reason its tooling is not here.
# The control archive therefore holds `control` and `md5sums` and nothing else.
#
# LC_ALL=C.UTF-8, and it is not decoration. One Mozilla anchor is named
# `NetLock_Arany_=Class_Gold=_Fotanusitvany` with four accented letters, and
# pack.sh's final assertion -- that the packed path set equals the staged one --
# reads the two sides with different tools: `find -printf '%P'`, which writes
# raw bytes, against `tar -tf`, which quotes anything `iswprint` calls
# unprintable in the current locale. Unset, the locale is C, every byte above
# 0x7f is unprintable, and that one path comes back as
# `F\305\221tan\303\272s\303\255tv\303\241ny` -- a diff of one line, on a
# payload that is byte-for-byte correct. This producer is the first with a
# non-ASCII filename, so it is the first to meet it.
#
# Set HERE rather than fixed in the packer because os/build-env/ is read-only to
# this workstream. The durable fix is `tar --quoting-style=literal` in pack.sh,
# which does not depend on a locale being installed at all; C.utf8 is in the
# mos-build-deb image, and if it ever stops being there glibc falls back to C
# and this build fails on that same diff rather than quietly shipping something
# else.
RUN set -eu; \
    LC_ALL=C.UTF-8 pack.sh --root /stage --control /in/control/mos-ca-trust.control \
        --version "${MOS_DEB_VERSION}" --arch "${MOS_DEB_ARCH}" --out /out

# The export stage, the shape os/pkgs/mosd/deb/mosd/Dockerfile ends in:
# `-o type=local` writes this stage's filesystem into _out/debs/<arch>/pool/
# and nothing here installs into a root.
FROM scratch AS out
COPY --from=pack /out/ /
