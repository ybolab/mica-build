# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# The ca-trust producer: the `mica-ca-trust` package.
#
#   bash build-env/deb/build.sh --producer ca-trust --arch all
#
# Two stages, because the payload is GENERATED and the packer cannot generate
# it: `generate` installs ca-certificates into the pinned Debian base and lets
# its postinst build the store; `pack` copies the result out and turns it into
# an archive. That split is the same one rootfs/stages/10-base.Dockerfile
# makes between its `certs` and `rootfs` stages, and it exists for the same
# reason -- the trust store is wanted, the package that builds it is not.
#
# No default for either base, for the reason build-env/deb/Dockerfile gives:
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

# WHAT THIS STAGE'S OUTPUT IS A FUNCTION OF -- PLAN-036 open decision (h),
# recorded here and NOT taken here. ${MOS_IMAGE_DEBIAN_TRIXIE} is a digest, so
# the base filesystem is bytes. The `apt-get install` the script below runs is
# not: it resolves against live deb.debian.org, which carries one version per
# package in a suite and re-points it on every point release. So this payload --
# the bundle, the 150 anchors, the hash farm -- is a function of WHEN it was
# built as well as of this tree. openssl, which ca-certificates depends on, was
# seen moving inside this campaign.
#
# THAT IS THE SHAPE OF EVERY APT INSTALL IN THIS REPOSITORY and not a quirk of
# this producer. build-env/images.env says the same thing about the builder
# images at its own head -- "a digest pin covers the base image's filesystem,
# NOT the apt archive the build installs from on top of it" -- and
# stages/10-base and stages/20-install install from that same live archive. A
# cold rebuild of any of them can legitimately resolve different versions and
# produce files that differ for that reason alone.
#
# WHAT MAKES IT SHARPER HERE is what the payload IS: the set of certificate
# authorities every device will believe. Nothing in this tree would catch a
# change to WHICH anchors arrived. The assertions in the pack stage below count
# certificates and refuse a truncated or dereferenced bundle; verify's
# ca-bundle-generated check says so in its own words, "a count, not a pinned
# set". Neither sees a substitution. Nor does the package gate: its two builds
# are minutes apart and read one mirror state. And the version this package
# carries comes from build-env/deb/version.sh, which is a function of the
# commit -- so a moved mirror ships DIFFERENT BYTES UNDER THE SAME VERSION,
# which is the least detectable form this can take.
#
# WHY IT IS NOT PINNED HERE, costed against this tree rather than in principle:
#   - It cannot be done in this file alone. This stage RUNs the shared
#     rootfs/scripts/ca-certificates-generate.sh, which stages/10-base's
#     certs stage also runs. A pin written only here makes the package's store
#     diverge from the chain's, and that is precisely the difference PLAN-036
#     section 6's compare-roots gate reads: on the first point release past the
#     pin it surfaces as ~150 unsanctioned content differences, in the gate
#     built to judge the composition rather than the mirror.
#   - A hard `ca-certificates=<version>` against deb.debian.org BREAKS the build
#     the moment trixie supersedes that version, because the archive keeps only
#     the current one. A durable pin means pointing apt at snapshot.debian.org,
#     which is a change to how every stage in this repository fetches.
#   - For a trust store the pin also trades one silent failure for another: a
#     ca-certificates update is HOW a distrusted authority leaves the store, so
#     a pin holds the fleet on a set until somebody remembers to bump it.
#
# THE RECOMMENDATION, escalated rather than taken: record the resolved
# ca-certificates version and a digest over the sorted anchor set, and fail the
# build when either moves. apt stays current -- a distrusted CA still leaves --
# while the change becomes loud and deliberate instead of absorbed, and it is
# the instrument every apt-installing stage here would want rather than one
# bolted onto this producer. It belongs beside the shared script, which is
# outside this directory.

# The repository's own script, RUN rather than restated. rootfs/scripts is a
# read-only source of truth and it arrives as the `scripts` build context
# producer.env names; a copy of its body in this file would be a second
# definition of "what is generated today", and the two would come apart at the
# first edit to either. That is not a style preference here -- stages/10-base's
# certs stage runs the same file, so the guard above lives in ONE place and both
# stores are judged by it. The script leaves /etc/ssl/certs/.mos-cert-count
# behind, which the pack stage below reads and does not ship.
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
# packaging CONTRACT, shared by every producer, and build-env/deb/README.md
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
# Provenance, written into the control file by pack.sh; see build-env/deb/README.md.
ARG MOS_DEB_SOURCE_REPO
ARG MOS_DEB_SOURCE_COMMIT

# What the staged tree must be before it is worth packing. Every assertion here
# is one rootfs/scripts/ca-certificates-verify.sh makes today about the tree
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
# in the same breath -- it has never been in a shipped root, and verify's
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

# The copyright, composed rather than copied. rootfs/packages-src/copyright
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
    install -d -m 0755 /stage/usr/share/doc/mica-ca-trust; \
    { \
        echo 'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/'; \
        echo 'Upstream-Name: mica-ca-trust'; \
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
        echo 'Files: usr/share/doc/mica-ca-trust/*'; \
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
    } >/stage/usr/share/doc/mica-ca-trust/copyright; \
    chmod 0644 /stage/usr/share/doc/mica-ca-trust/copyright; \
    grep -c 'Apache License' /stage/usr/share/doc/mica-ca-trust/copyright >/dev/null || \
        { echo "error: the composed copyright lost the Apache-2.0 text" >&2; exit 1; }; \
    grep -c 'Mozilla Public License' /stage/usr/share/doc/mica-ca-trust/copyright >/dev/null || \
        { echo "error: the composed copyright lost the harvested ca-certificates text" >&2; exit 1; }; \
    echo "ca-trust: copyright composed, $(wc -l </stage/usr/share/doc/mica-ca-trust/copyright) lines"

# NO MTIME NORMALISATION HERE, and this is where a reader of this producer comes
# looking for it. build-env/deb/pack.sh SETS every path in the packed tree to
# SOURCE_DATE_EPOCH -- unconditionally, over the whole tree, as its written
# ruling at that site records.
#
# THIS ABSENCE DEPENDS ON PLAN-036 DECISION (e), which is what made pack.sh SET
# rather than clamp. A reader who reverts (e) has to put a normalising step back
# here, and the code should be what tells them so.
#
# Under a CLAMP the discriminating case is not two cold builds -- those agree
# either way. It is a WARM generate layer whose wall clock is OLDER than the
# commit's SOURCE_DATE_EPOCH, against a cold one: a clamp leaves an older mtime
# alone, so the warm side keeps the moment its layer was first built while the
# cold side carries the epoch, and the two archives diverge. That is the defect
# this producer was carrying, and the pair a two-empty-cache-builder proof
# cannot see. Under SET the stale mtime is overwritten and the pair converges.
#
# MEASURED, and the pair was built to straddle the epoch rather than to be
# convenient. The warm builder's cached generation layer wrote its bundle at
# 11:24:49; a commit was then made, putting SOURCE_DATE_EPOCH at 11:25:20, 31
# seconds LATER; the cold builder generated afresh after that, newer than the
# epoch on the other side. So a clamp had to leave the warm side at 11:24:49
# while pulling the cold side back to 11:25:20. The two archives came out
# byte-identical, and every payload entry in both carries 11:25:20.
#
# The fingerprint of SET being in force at all, from the same producer: all 463
# payload entries carry the epoch and NONE carries ca-certificates' own
# 2025-04-19 date -- under a clamp those anchors, being older than the epoch,
# would have kept it.
#
# So a producer normalising its own stage is not belt-and-braces against (e)
# being reverted. It is a second copy of a rule, and the copy that mattered
# would be whichever ran last.
#
# WHY THAT RULING IS WHAT MAKES THIS PRODUCER REPRODUCIBLE. Almost nothing here
# arrives with a date of its own: the bundle, /etc/ca-certificates.conf and all
# 300 hash links are WRITTEN by update-ca-certificates in the generation stage,
# so their mtime is that stage's wall clock -- and BuildKit caches the stage, so
# it is the wall clock of whenever that layer was FIRST built, days ago on a
# developer's builder and seconds ago on an empty-cache one. That was the whole
# of PLAN-036's mica-ca-trust irreproducibility, and it was measured: two builds
# at one SOURCE_DATE_EPOCH differing only in whether the generation layer was
# replayed produced data.tar.xz of 143976 and 144004 bytes over uncompressed
# tars that were byte-equal in every entry, mode, owner and content. 28 bytes of
# xz, and nothing a path-set or content assertion can see. Setting closes it
# without this file carrying a rule about it.
#
# THE 150 ANCHORS ARE SET TOO, and that is not an oversight to correct here.
# They are the one part of this payload that does come out of ca-certificates'
# own archive with a date worth something, and an exemption for them used to
# stand at this point in the file. Under a set rather than a clamp an exemption
# is unreachable: pack.sh stamps them last, after anything written here. The
# archive is the evidence -- all 463 payload entries carry SOURCE_DATE_EPOCH,
# the mozilla/*.crt anchors among them. Re-adding the exemption would put a rule
# in this file that the packer overwrites a moment later, which reads as policy
# and is a no-op.

# No maintainer scripts and no enablement links: this package owns no unit and
# nothing has to run after it is unpacked -- update-ca-certificates already ran,
# in the generation stage, which is the whole reason its tooling is not here.
# The control archive therefore holds `control` and `md5sums` and nothing else.
#
# NO LOCALE IS SET FOR THE PACK, and this producer is the reason that is worth
# a sentence. One Mozilla anchor is named
# `NetLock_Arany_=Class_Gold=_Fotanusitvany` with four accented letters, and
# pack.sh's final assertion -- that the packed path set equals the staged one --
# reads the two sides with different tools: `find -printf '%P'`, which writes
# raw bytes, against `tar -tf`. GNU tar C-escapes any byte `iswprint` calls
# unprintable in the current locale, and the packing image installs no locale at
# all, so under C that one path came back as
# `F\305\221tan\303\272s\303\255tv\303\241ny`: a one-line diff refusing a
# byte-correct archive, and this producer was the first payload with a non-ASCII
# filename to meet it. An LC_ALL=C.UTF-8 in front of the pack stood here while
# that was true.
#
# pack.sh now passes `tar --quoting-style=literal`, which emits raw bytes and
# depends on no installed locale, so the workaround is REMOVED rather than left
# as a second answer to a question the packer already answers -- one that would
# also hide the regression if that flag were ever dropped. This build is what
# exercises it: no other producer ships a path outside ASCII.
RUN set -eu; \
    pack.sh --root /stage --control /in/control/mica-ca-trust.control \
        --version "${MOS_DEB_VERSION}" --arch "${MOS_DEB_ARCH}" --out /out

# The export stage, the shape pkgs/micad/deb/micad/Dockerfile ends in:
# `-o type=local` writes this stage's filesystem into _out/debs/<arch>/pool/
# and nothing here installs into a root.
FROM scratch AS out
COPY --from=pack /out/ /
