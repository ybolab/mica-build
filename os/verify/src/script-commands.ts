// The command names a shell script invokes at COMMAND POSITION, and whether
// each resolves inside the packed root.
//
// A transcription of `mos_script_commands` and `sq_resolves_cmd`, in their own
// module because they are a
// nine-stage text pipeline and putting them beside the check that uses them
// would bury it.
//
// WHY A PIPELINE AND NOT A SHELL PARSER.
//
// Because that is what the oracle is, and the port has to agree with the oracle
// -- including where the oracle is wrong. A real parser would find commands this
// misses and miss commands this finds, and every one of those differences would
// be a divergence attributable to the port rather than to the image.
//
// The extractor is DELIBERATELY CONSERVATIVE and the oracle says so: commands
// the scripts invoke through their own `run`/`have` wrappers -- busctl, rauc,
// systemctl, curl, wget -- are NOT in this set and must not be. `mos-health`
// uses `have X ||` precisely to mark curl and wget optional, and asserting those
// exist would be asserting the wrong thing.
//
// THE ONE PLACE `sq_resolves_cmd` DIFFERS FROM EVERY OTHER PATH TEST HERE.
//
// It chases symlinks WITHIN THE IMAGE: an absolute link target resolves against
// ROOT and not against the host's `/`. Everywhere else in this harness `[ -f ]`
// and `stat` follow a link the way the shell does, which for an absolute target
// inside a container means the container's root. Here the oracle re-roots it by
// hand, so a dangling /etc/alternatives entry FAILS rather than accidentally
// resolving to a host binary. That difference is the whole reason this function
// is transcribed rather than replaced by `regularFileFollowingLinks`.

import { lstatSync, readlinkSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

// The oracle's own two lists, space-padded exactly as it pads them.
const SH_BUILTINS = ' : . [ alias bg break cd continue echo eval exec exit export false fg getopts '
  + 'hash jobs local printf pwd read readonly return set shift test times trap true type ulimit '
  + 'umask unalias unset wait command source '
const SH_KEYWORDS = ' if then else elif fi for while until do done case esac in function ! '

/**
 * The function names the script defines, which are not external commands.
 *
 * The oracle's `sed -n` for a `name() {` at the start of a line: the `{` must
 * be on the SAME line. A function
 * opened on the next line is missed, by the oracle and therefore by this.
 */
function definedFunctions(script: string): string[] {
  const found: string[] = []
  for (const line of script.split('\n')) {
    const m = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*\([ \t]*\)[ \t]*\{/.exec(line)
    if (m?.[1] !== undefined) found.push(m[1])
  }
  return found
}

/** `sed -e :a -e '/\\$/N; s/\\\n/ /; ta'` -- join continuation lines with a SPACE. */
function joinContinuations(script: string): string[] {
  const out: string[] = []
  let pending: string | undefined
  for (const line of script.split('\n')) {
    const current = pending === undefined ? line : `${pending} ${line}`
    if (current.endsWith('\\')) {
      pending = current.slice(0, -1)
      continue
    }
    pending = undefined
    out.push(current)
  }
  if (pending !== undefined) out.push(pending)
  return out
}

/**
 * Every command name at command position in one shell script, in the oracle's
 * own nine stages and its own order.
 *
 * Stage order is load-bearing. Backslash escapes are dropped BEFORE comments are
 * stripped, so an escaped `\#` inside a message is not mistaken for a comment
 * opener; command substitution is split BEFORE quoted spans are removed, so a
 * `$(cmd)` inside a double-quoted string still yields `cmd`.
 */
export function extractCommands(script: string): string[] {
  const funcs = ` ${definedFunctions(script).join(' ')} `
  const out: string[] = []
  let caseDepth = 0

  for (const joined of joinContinuations(script)) {
    // `sed -e 's/\\.//g'` -- a backslash and whatever follows it, so an escaped
    // backtick in a message is not mistaken for a command substitution.
    let line = joined.replace(/\\[\s\S]/g, '')
    // `sed -E 's/(^|[[:space:]])#.*$/\1/'` -- the FIRST comment opener only, and
    // the whitespace that introduced it is kept.
    line = line.replace(/(^|[ \t])#.*$/, '$1')

    // The awk: `case ... in` opens a region whose PATTERNS are not commands.
    if (/(^|[ \t])case[ \t].*[ \t]in[ \t]*$/.test(line)) {
      caseDepth += 1
    }
    else if (/(^|[ \t])esac([ \t]|$)/.test(line)) {
      if (caseDepth > 0) caseDepth -= 1
    }
    else if (caseDepth > 0) {
      // `sub(/^[[:space:]]*[^()]*\)/, "")` -- drop the pattern up to its `)`.
      line = line.replace(/^[ \t]*[^()]*\)/, '')
    }

    // `sed -e 's/\$(/\n/g' -e 's/`/\n/g'` then the quote strip, then the split
    // on `;|&`, then the leading-keyword strip, then `awk '{print $1}'`.
    for (const piece of line.split(/\$\(|`/)) {
      const unquoted = piece.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '')
      for (const segment of unquoted.split(/[;|&]/)) {
        let word = segment.replace(/^[ \t]*/, '')
        // `:a; s/^(if|then|else|elif|do|while|until|!|\{)[[:space:]]+//; ta`
        for (;;) {
          const stripped = word.replace(/^(if|then|else|elif|do|while|until|!|\{)[ \t]+/, '')
          if (stripped === word) break
          word = stripped
        }
        const first = word.split(/[ \t]+/)[0] ?? ''
        if (first === '') continue
        if (`${SH_BUILTINS}${SH_KEYWORDS}${funcs}`.includes(` ${first} `)) continue
        // `*=* | \$* | -* | [0-9]* | \** | \[*` -- an assignment, an expansion,
        // an option, a number, a glob, a test.
        if (first.includes('=')) continue
        if (/^[$\-*[]/.test(first) || /^[0-9]/.test(first)) continue
        // `*[!A-Za-z0-9_./+-]*` -- anything outside the command-name alphabet.
        if (/[^A-Za-z0-9_./+-]/.test(first)) continue
        // `/* | [A-Za-z_]*` -- an absolute path or a plain name.
        if (!/^[/A-Za-z_]/.test(first)) continue
        out.push(first)
      }
    }
  }
  return out
}

const COMMAND_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'] as const

/**
 * `sq_resolves_cmd`: does this command name reach a regular file INSIDE the root?
 *
 * Symlinks are chased by hand, up to eight hops, with an absolute target
 * re-rooted at `root` -- which is what makes a dangling /etc/alternatives entry
 * fail rather than silently resolving against the host. Eight is the oracle's
 * own bound and it is what stops a symlink loop; the ninth hop is not followed
 * and the result is judged where the chase stopped.
 */
export function resolvesInRoot(root: string, command: string): boolean {
  let path = ''
  if (command.startsWith('/')) {
    path = join(root, command)
  }
  else {
    for (const dir of COMMAND_DIRS) {
      const candidate = join(root, dir, command)
      // `[ -e ] || [ -L ]`: a DANGLING link is still a candidate, and chasing it
      // is what turns it into a failure rather than a miss.
      if (exists(candidate) || isLink(candidate)) {
        path = candidate
        break
      }
    }
  }
  if (path === '') return false
  for (let hops = 0; isLink(path) && hops < 8; hops += 1) {
    const target = readlinkSync(path)
    path = target.startsWith('/') ? join(root, target) : join(dirname(path), target)
  }
  try {
    return statSync(path).isFile()
  }
  catch {
    return false
  }
}

function exists(path: string): boolean {
  try {
    statSync(path)
    return true
  }
  catch {
    return false
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  }
  catch {
    return false
  }
}
