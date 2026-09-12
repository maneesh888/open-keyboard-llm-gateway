---
name: audit-gateway-ui
description: Audit Gateway admin screens and journeys for production behavior, navigation, accessibility, layout risks, state clarity, and recovery. Use for UI/UX audits and inside authorized UI changes; delegate wording to the product-copy skill.
---

# Audit Gateway UI

Follow a real user journey through the production UI, handlers, API, and state producers. Apply `AGENTS.md`: audits are read-only, while already authorized fixes remain inside the development loop.

## Trace the task

Define the target journey, user task, scope, and available evidence. Read relevant current admin requirements and function-test expectations. Trace reachable UI from entry to completion/cancellation/recovery; check adjacent handoffs without broadening the edit scope. Follow each material control into its handler and API/service. Distinguish shipping behavior from test injection, fixtures, dead code, and intended behavior.

Check applicable empty/loading/disabled/stale/success/partial/error states. For key creation, editing, reveal/copy, disable/delete, model status/start/stop, and playground testing, verify that affordance, actual action, resulting state, and recovery agree. Keep credential status, provider availability, and inference outcome separate. A status request must not become an implicit setup command.

## Evaluate the experience

Inspect hierarchy, grouping, navigation/back behavior, modal dismissal, duplicate actions, cancellation, and stale state. Check narrow layouts, zoom, long names, scrolling, visible primary actions, and touch targets. Inspect label associations, icon names, keyboard order, focus return, error announcements, and color-only meaning. Trace behavior before prescribing a copy change; use `$write-gateway-product-copy` for labels, claims, tone, and terminology.

Classify each finding:
- **confirmed from code**: reachable source establishes a behavior or structural issue.
- **likely visual risk**: code suggests a layout risk that rendering must resolve.
- **requires browser verification**: actual appearance, focus, interaction, or accessibility behavior remains unknown.

Severity describes user impact independently of certainty. Cite exact source lines and the relevant state/action chain. Missing test coverage alone does not prove a product defect.

## Deliver and follow through

Lead with the most consequential findings. A useful table is `ID | Severity | Classification | State | Source | User impact | Recommendation | Required verification`. Retain adjacent out-of-scope issues separately. Distinguish copy, behavior, accessibility, and coverage work.

Source inspection, DOM metadata, successful automation calls, and fixture tests do not establish observed usability. Run `docs/BROWSER_SMOKE_PLAN.md` for affected journeys using the normally served UI and inspect visible results. Browser fixtures prove application integration; live provider calls prove the configured transport/contract; neither automatically proves semantic quality or usability for every user.

When implementation is authorized, retain finding IDs as the boundary, apply scoped fixes, run focused regression plus browser E2E, and collect observed proof before automatic readiness. Report unresolved evidence without weakening criteria or requesting broad redesign.
