# PLAN-068 Complete the built-in console against the prototype information architecture

- **status**: draft
- **createdAt**: 2026-09-02 22:35
- **relatedTask**: [UI-013](../task/UI-013.md)

## Context

The approved prototype is `docs/zh/design/mos-ui/project/index.dc.html`. It can
be served and driven directly, which is how the gaps below were established
rather than inferred: a static server over the bundle plus the pinned
`mcr.microsoft.com/playwright` sibling produced one render per screen.

PLAN-064 rebuilt the console from the prototype in outline and PLAN-067 closed
the visual system. Neither touched content, so every surface still diverges in
what it shows and how it is reached.

Per surface, measured against the rendered prototype:

- **Shell.** Page headers carry a description the prototype does not have; the
  prototype puts a status tag and a freshness reading on the right instead. The
  footer reports API and settings-schema versions where the prototype reports
  release and active slot, both of which `GET /api/v1/system/info` and
  `GET /api/v1/update` already answer. There is no connection banner, the
  refresh control does not spin, and preferences are two selects rather than a
  searchable language picker and a segmented theme control.
- **Overview.** The attention count is a card header rather than a label above
  the card, rows have no leading tag and no trailing button, summary cards do
  not navigate and do not use monospace for identifiers, and the task table
  columns are change/source/status rather than action/target/phase/result/time.
- **Network.** Observed state lives in a fourth tab instead of the interface
  table's Observed and Last-observed columns. Editing opens a dialog; the
  prototype opens an interface detail route with overview, addressing and
  danger sections, a review dialog and a saved/applying/reconnecting/applied
  progress strip. Known Wi-Fi and WireGuard lack the prototype's table columns,
  summary cards, peer table and key-rotation panel.
- **Services.** Three cards with a footer button, no detail view and no
  per-service configuration. The prototype puts the switch in the card header,
  opens a detail route with configured/observed/endpoint cards and a
  configuration panel per service, and opens the terminal in a window with
  minimize, fullscreen, close and a minimized pill.
- **Applications.** No source or kind filter, no retained-data count, no
  Desired column, no banner when the container runtime is off, different
  catalog fields, and an install wizard whose steps are a circle stepper rather
  than the prototype's numbered header row.
- **Access.** Panels in a two-column grid rather than the prototype's labelled
  sections; tokens are a list rather than a table; no reveal warning panel with
  its close confirmation; SSH has no server switch row in the prototype's shape
  and no root-password danger panel.
- **System.** Seven tabs against the prototype's six. The prototype folds
  recovery into Update & recovery, factory reset into General and support
  access into Diagnostics. Update lacks the eight-step strip, the check table,
  the automatic-update policy, manual upload and configuration backup. Storage
  lacks the role table with usage bars and the DATA breakdown. Diagnostics
  lacks the snapshot scope grid and the support PIN flow. Information is not
  the prototype's three labelled cards plus known limitations.

The device API already answers health, meta, system info and telemetry, tasks,
network configuration and status, settings, storage status, time status,
update and rollback, diagnostics snapshots, tokens, SSH keys, UI bundles, Wi-Fi
client networks and the action endpoints. It answers nothing for applications,
service configuration, the terminal, automatic-update policy, configuration
backup, support access or the catalog. `src/shared/simulation/` already exists
for exactly that boundary and labels every page that uses it.

## Proposal

Seven phases. Each phase is independently verifiable, ends with the pinned
frontend gate, and only the last regenerates the Playwright baselines so
appearance churn is reviewed once.

1. **Shell and shared states.** Drop page descriptions and give `PageHeader`
   the prototype's tag-plus-freshness slot. Bind footer release and active slot
   to `system/info` and `update`. Add the spinning refresh, the reconnecting and
   offline banner, the searchable language picker dialog, the segmented theme
   control, and a toast. Add the shared loading skeleton, empty, error, offline
   and unsupported blocks the later phases reuse.
2. **Overview.** Attention label above the card, tagged rows with trailing
   actions, four navigating summary cards with monospace identifiers, and the
   five-column task table.
3. **Network.** Merge observed state into the interface table, add the
   `/network/$interface` detail route with the three sections, the review
   dialog and the apply progress strip, and rebuild the Known Wi-Fi and
   WireGuard tabs. The observed routes, cellular and scan facts that the
   prototype has no place for move into a marked section under Interfaces.
4. **Services.** Card grid with the header switch, the `/services/$service`
   detail route with the three summary cards and per-service configuration, and
   the terminal window with its minimized pill. Configuration forms and the
   terminal are simulation.
5. **Applications.** Source and kind filters, retained-data count, Desired
   column, container-off banner, prototype catalog fields, and the four-step
   install wizard with the numbered header row.
6. **Access.** Four labelled sections, the token table with its reveal panel
   and close confirmation, the SSH server switch with key rows and removal
   confirmation, and the root-password danger panel. Device claim and the
   provisioning document stay as a marked fifth section.
7. **System.** Collapse to six tabs and rebuild each: General with hostname,
   the UI package list and power plus the factory-reset strip; Information as
   three labelled cards with the copy action and known limitations; Time with
   the sync banner, three clocks and the servers form; Update & recovery with
   the step strip, release cards, check table, automatic policy, manual upload
   and configuration backup; Storage with the role table, DATA breakdown and
   media health; Diagnostics with the snapshot scope grid and the support PIN
   flow. Credential recovery, reset tiers and rollback stay as marked sections
   under Update & recovery.

Behavior changes are written test-first: a failing Vitest case per new state or
transition before the component exists, and Playwright flows extended for the
interface detail route, the service detail route and the install wizard.

## Risks

- The prototype is a mock with device data invented for the screenshot. Every
  value that the device cannot answer must come from the simulation layer with
  its notice, or the console will state facts it does not know. Each phase
  states which fields are bound and which are simulated.
- Two new routes (interface detail, service detail) change navigation and the
  embedded lazy-chunk layout. The `/api`, `/_ui` and custom-root ownership
  boundaries are untouched, but the route tree is regenerated and the built
  asset set changes.
- Removing page descriptions and folding the Recovery tab deletes localized
  strings and one navigation target. Anything reachable only from that tab is
  re-parented, not dropped.
- Retaining shipped surfaces the prototype omits keeps the console a superset
  of the design. They are marked as additions so a reader can tell design from
  product, but the two will not be identical.
- The scope is large enough that a single review is impractical; phases land
  and are verified one at a time rather than as one change.

## Open questions

1. Shipped surfaces the prototype has no place for — observed routes and
   cellular, device claim, provisioning document, credential recovery, reset
   tiers, rollback, package manifest, telemetry. Keep them as marked extra
   sections, or drop the ones you consider unnecessary?
2. The prototype's service configuration, WireGuard rotation, configuration
   backup, support PIN, automatic-update policy and application catalog have no
   device API. Confirm they should ship as labelled simulation rather than be
   left out until the API exists.
3. Folding System's Recovery tab into Update & recovery, General and
   Diagnostics changes a navigation target that current documentation and the
   `/_ui/system#recovery` hash reference. Confirm that is acceptable.
