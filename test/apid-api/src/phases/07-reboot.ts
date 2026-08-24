// Filled in by the reboot-phase subtask; this file is that subtask's only edit.
//
// Until then it is RED on purpose. An unimplemented phase that is absent, or
// that reports nothing, is indistinguishable from a phase that passed.

import type { Phase } from "../runner.ts";

const phase: Phase = {
  id: "07-reboot",
  title: "reboot: POST-only, the confirm token is required, and the device comes back",
  assumes: "TODO: phase 06 left the login guard disarmed again (its window elapsed) and a valid session in the jar, and left every non-destructive assertion already made.",
  async run(ctx) {
    ctx.report.fail("07-reboot is not implemented");
  },
};

export default phase;
