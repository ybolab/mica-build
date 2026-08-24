// Filled in by the backoff-phase subtask; this file is that subtask's only edit.
//
// Until then it is RED on purpose. An unimplemented phase that is absent, or
// that reports nothing, is indistinguishable from a phase that passed.

import type { Phase } from "../runner.ts";

const phase: Phase = {
  id: "06-backoff",
  title: "login backoff: the guard is global, its window doubles, and it survives a restart",
  assumes: "TODO: phase 05 left the session valid and the admin password unchanged, and left the login guard UNARMED -- no failed login has been attempted yet in this run.",
  async run(ctx) {
    ctx.report.fail("06-backoff is not implemented");
  },
};

export default phase;
