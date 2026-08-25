# Shared by the two disk assemblers, os/mkimage-v2.sh (cx3576) and
# os/mkimage-x64.sh (x64). Sourced, never executed: no shebang, no `set`, and
# no top-level statement -- see the shell-options note on pin_seeded_times.
#
# WHY THIS IS A FILE AND NOT A SECOND COPY. What lives here is not a utility,
# it is an ARGUMENT: which of an inode's four timestamps are the producer's
# data and which are the assembler's noise, why the inode set has to come from
# the bitmap rather than from a walk of the source tree, and why debugfs's
# stderr rather than its exit status is the failure signal. A copy of a
# function is kept in step by whoever remembers both call sites; a copy of an
# argument is not kept in step at all, because the second copy reads as
# self-evidently correct long after the reason for one of its lines has
# changed. The two assemblers already share their layout format and
# os/update/rauc/render-config.sh as files for the same reason, and PLAN-014
# removed the duplication that was not shared that way: os/health/'s
# byte-identical pair is gone (RFCT-111 collapsed it into the overlay copy the
# image actually ships). Adding a third instance of the same mistake while
# removing the first two is not a trade this campaign can make.
#
# WHERE IT LIVES, AND WHY HERE. Alongside its only two callers, under their
# name prefix: `ls os/` shows mkimage-common.sh, mkimage-v2.sh and
# mkimage-x64.sh together, and when M6c ports the assemblers to TS under
# os/build/ the three move as one unit by one rule. It is deliberately NOT in
# os/build/ -- PLAN-014 reserves that directory for the TS driver M6c creates,
# and seeding it with shell now would mean either pre-empting that name or
# undoing this. It is deliberately not a new os/lib/ either: one file does not
# justify a convention that would immediately need a policy about what else
# belongs in it.
#
# HOW EACH CALLER GETS IT.
#   cx3576  os/mkimage-v2.sh sources it by a path derived from its own
#           ${BASH_SOURCE[0]}. In --assemble mode that script re-executes
#           ITSELF inside the container with the whole repo bound (/work, and
#           /work read-only under the selftest), so the same path resolves on
#           both sides of the boundary and nothing has to be arranged.
#   x64     os/mkimage-x64.sh binds only its work directory (/w) and runs a
#           heredoc script inside it, so this file has to be carried across.
#           It is COPIED into the work directory next to the image inputs and
#           sourced as /w/mkimage-common.sh -- the same route board.env
#           already takes to become /w/layout.env. The alternative, splicing
#           the text into the heredoc, would require unquoting a <<'INNER'
#           that is single-quoted precisely so the host expands none of the
#           ${...} the container must expand against the sourced layout. A
#           literal `. /w/mkimage-common.sh` contains no `$` at all and is the
#           same bytes on both sides of that quote.

# Rewrites every in-use inode's atime and ctime to FILE_MTIME, in place, in the
# finished filesystem. Only a filesystem seeded with `mke2fs -d` needs this, and
# it is the difference between "EPHEMERAL is seeded" and "EPHEMERAL rebuilds
# byte-identically" -- before this the two differed in 106 bytes of the inode
# table, spanning every inode the seed created.
#
# mke2fs -d copies the SOURCE inode's atime, mtime and ctime into the image, and
# two of those three are the assembler's own noise rather than the exported tree's
# content:
#
#   ctime  Both assemblers copy the factory /var out of _out before seeding --
#          os/mkimage-v2.sh into a mktemp -d inside assemble(), os/mkimage-x64.sh
#          into its work directory on the host -- so that the stamp can be added
#          without writing into _out. The kernel stamps every copied inode's
#          ctime with the moment of that copy. NO syscall sets ctime -- not
#          touch, not utimensat -- so the only way to pin it is to write the
#          inode table, which is what this does.
#   atime  cp -a preserves the source's atime, and reading the source to make
#          the FIRST copy is itself what bumps it under relatime. So assembly 2
#          seeds EPHEMERAL with a timestamp assembly 1 created, and the two
#          images differ in a field neither build was asked about.
#
# mtime is deliberately left alone: it is the producer's data, carried in
# through cp -a, not something an assembler invents. crtime is mke2fs's own
# invention and E2FSPROGS_FAKE_TIME already pins it (that is all it can pin --
# it does not reach times copied in from a source tree).
#
# The inode set comes from the inode bitmap rather than from walking the source
# tree, so it cannot be desynchronised by a filename debugfs's parser would
# split, and it starts at the filesystem's first non-reserved inode so mke2fs's
# own reserved inodes are left exactly as mke2fs wrote them. The enumerated
# count is cross-checked against the superblock's free-inode total: if a future
# dumpe2fs changes how it prints ranges, this refuses the build instead of
# silently pinning nothing and handing the byte-identity check a fake pass.
#
# SHELL OPTIONS. This makes no assumption about the caller's. os/mkimage-v2.sh
# runs under `set -euo pipefail`; os/mkimage-x64.sh's inner assembly script
# runs under `set -eu` with no pipefail, and changing that would alter the
# error behaviour of an assembly this function is not part of. So neither
# guarantee below is delegated to pipefail: a dumpe2fs that dies mid-listing
# leaves inodes it never printed looking allocated, which makes `got` EXCEED
# `want` and trips the named refusal, and debugfs's stderr is read directly
# rather than inferred from a pipeline status.
pin_seeded_times() {
    local img="$1"
    local hdr first count free_total want got cmds n errs
    hdr="$(dumpe2fs -h "${img}" 2>/dev/null)"
    first="$(printf '%s\n' "${hdr}" | sed -n 's/^First inode: *//p')"
    count="$(printf '%s\n' "${hdr}" | sed -n 's/^Inode count: *//p')"
    free_total="$(printf '%s\n' "${hdr}" | sed -n 's/^Free inodes: *//p')"
    for n in "${first}" "${count}" "${free_total}"; do
        if ! [[ "${n}" =~ ^[0-9]+$ ]]; then
            echo "error: could not read the inode geometry of ${img} from dumpe2fs (first='${first}' count='${count}' free='${free_total}')" >&2
            exit 1
        fi
    done
    # Reserved inodes 1..first-1 are mke2fs's, and are not being rewritten.
    want=$(( count - free_total - (first - 1) ))

    cmds="${img}.times"
    dumpe2fs "${img}" 2>/dev/null | sed -n 's/^  Free inodes: *//p' | tr ',' '\n' |
        awk -v first="${first}" -v count="${count}" -v t="${FILE_MTIME}" '
            { gsub(/[ \t]/, ""); if ($0 == "") next
              n = split($0, r, /-+/); lo = r[1] + 0; hi = (n > 1 ? r[2] + 0 : lo)
              for (i = lo; i <= hi; i++) free[i] = 1 }
            END { for (i = first; i <= count; i++) if (!(i in free))
                      printf "sif <%d> atime %s\nsif <%d> ctime %s\n", i, t, i, t }
        ' > "${cmds}"
    got=$(( $(wc -l < "${cmds}") / 2 ))
    if [ "${got}" -ne "${want}" ]; then
        echo "error: the inode bitmap of ${img} says ${want} inodes are in use from ${first} up, but parsing dumpe2fs's free-inode ranges found ${got}; refusing to pin timestamps against a listing this script no longer understands" >&2
        exit 1
    fi
    # debugfs exits 0 even when an individual command fails, so its stderr is
    # the only failure signal there is; everything but its version banner is an
    # error. Silencing the stream instead would let a rename of `sif` turn this
    # into a no-op that still reports success.
    errs="$(debugfs -w -f "${cmds}" "${img}" 2>&1 >/dev/null | grep -v '^debugfs [0-9]' || true)"
    if [ -n "${errs}" ]; then
        echo "error: debugfs could not pin the seeded timestamps in ${img}: ${errs}" >&2
        exit 1
    fi
    rm -f "${cmds}"
}
