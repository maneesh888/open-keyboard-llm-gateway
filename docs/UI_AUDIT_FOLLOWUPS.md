# Source-only UI audit follow-ups

An independent trial of `audit-gateway-ui` and `write-gateway-product-copy` traced the shipping API Keys → key tester journey while the workflow/E2E harness was introduced. These are follow-up findings, not claims of observed runtime acceptance or requirements silently added to that infrastructure package.

| Finding | Evidence and user impact | Next bounded verification/fix |
| --- | --- | --- |
| High: results can outlive the selected key | `loadTesterKey` changes selection/diagnostics without clearing or binding prior chat/status; the old success may appear under a different key. | Test A success → select B/model override/back/refresh; bind result identity and clear/mark stale output. |
| Medium: pending test/reset race | `sendTestMessage` does not lock duplicate submissions or ignore obsolete responses; `resetPlaygroundState` does not cancel an in-flight request. | Add delayed-response browser scenarios for reset, duplicate submission, selection and navigation. |
| Medium: modal error/focus semantics | Form errors use a dashboard banner outside `keyModal`; modal markup lacks dialog semantics and explicit focus return. | Keyboard/assistive walkthrough, inline error, dialog and focus management with regression. |
| Medium: ambiguous readiness and wording | `updateTesterReadiness` calls cached credential state “Ready”; API Keys promises rotation, and the panel describes table/card implementation. | Copy deck: “Key loaded”; describe client access/model defaults/limits; label the handoff “Open key tester”. Confirm production states first. |
| Medium: deletion consequences | `deleteKey` confirms without identifying the key or explaining loss of client access. | Name the key and irreversible effect; verify cancellation and deletion with disposable data. |

Relevant production source is `public/admin/index.html`, reached by `src/server.ts`'s `/ui` route. These are **confirmed from code** behavior/content findings; actual focus/visibility/fit still **requires browser verification**.

The trial also found feature settings overwritten by a name-only edit and a full credential in the creation banner. Those two bounded defects are corrected in the workflow package and covered by the key-lifecycle E2E test. The mobile alert overflow found during browser execution is covered by the narrow-viewport regression. The audit's initial stale-doc/missing-walkthrough observations were made while those documents were being written; current requirements and `BROWSER_SMOKE_PLAN.md` now replace those obsolete inputs.
