// Filled in by the poweroff-phase subtask; this file is that subtask's only edit.
//
// Until then it is RED on purpose. An unimplemented phase that is absent, or
// that reports nothing, is indistinguishable from a phase that passed.

import type { Phase } from "../runner.ts";

const phase: Phase = {
  id: "08-poweroff",
  title: "poweroff: POST-only, the confirm token is required, and the guest goes down",
  assumes: "TODO: phase 07 left the device rebooted and reachable again, with a session re-established after the reboot; this phase is destructive and must run last.",
  async run(ctx) {
    ctx.report.fail("08-poweroff is not implemented");
  },
};

export default phase;
