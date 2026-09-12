---
name: write-gateway-product-copy
description: Write or review visible Gateway admin wording for clear tasks, truthful claims, useful recovery, and consistent terminology across setup, keys, model status, and the playground. Excludes model prompts and generated responses.
---

# Write Gateway Product Copy

Make the user's task, current state, consequences, and next action understandable. Apply `AGENTS.md` authority: audits are read-only; authorized copy changes stay inside the development lifecycle without an extra approval gate.

## Establish truth and journey

Read current capability/setup sections of `README.md`, the relevant `ADMIN_FUNCTION_TEST_PLAN.md` and `ADMIN_UI_REQUIREMENTS.md` sections, and reachable production UI plus its state-producing API/service. Treat historical plans, fixtures, tests, and unused strings as context, not proof a capability ships. Report contradictory sources.

Identify the audience and task. Trace entry → target screen/state → next action or recovery. Check adjacent screens for shared terminology and promises, without silently expanding edits. Distinguish interface language from configuration values, user text, and generated output. Keep semantic prompts and schemas in the pinned contract.

## Review the words

- Lead with useful outcomes; introduce gateway/provider/model details where a user needs them to make a decision. Provider choice does not necessarily mean self-hosting. Name supported providers only when production evidence supports the claim.
- Buttons describe their immediate action or destination. Trace the handler: “Save”, “Test”, “Start”, “Stop”, “Copy”, and “Delete” are distinct promises.
- Keep key enablement, saved configuration, provider reachability, model availability/running state, and successful inference separate. Metadata checks do not establish that a model can answer. Avoid unqualified “ready”, “secure”, “private”, or “works with any AI”.
- For applicable empty, loading, disabled, stale, success, partial, authentication, offline, timeout, cancellation, and failure states, explain what happened and a real next step. Record a missing recovery action as a behavior gap; wording cannot implement it.
- Explain data transmission, destructive effects, and material prerequisites near the relevant action. Never include credentials, raw errors/payloads, or private configuration in explanatory copy.
- Keep a small consistent vocabulary across keys, setup help, model controls, and playground. Use plain, concise language without hiding necessary meaning. Check long values, narrow screens, zoom/localization expansion, and accessible names.

## Deliver and verify

Give one recommended version per element, with source references and brief rationale. Use a copy table when useful: `Screen/state | Element | Current | Recommended | Purpose`. Classify material claims as shipping fact, verified limitation, future intent, or unsupported claim. Future intent is allowed in labeled proposals, never as a shipping promise.

Report non-copy gaps separately. Source-only work cannot accept rendered fit, focus, or usability. For implementation, update only in-scope strings and accessible labels, relevant assertions, and run the browser E2E plus `docs/BROWSER_SMOKE_PLAN.md`. A workflow-only skill change requires skill/policy validation, not a claim of product runtime acceptance.
