# Gateway admin UI acceptance requirements

The shipping UI is served publicly at `/ui`; administrative data and actions require an authenticated admin session. The old “UI missing/404” implementation brief is superseded by this document. Resolve future conflicts against reachable production behavior and `ADMIN_FUNCTION_TEST_PLAN.md`, not historical plans.

## User journeys

| Journey | Observable acceptance |
| --- | --- |
| Sign in and return | Labeled fields, understandable failure, restored valid session, expired-session recovery, and logout that removes access. |
| Manage client access | Create, inspect, edit, disable/enable and delete keys; edit preserves the credential. Reveal/copy only on explicit action; list responses conceal full keys. Destructive actions permit cancellation. |
| Choose a model | Preserve configured model identity and explain manual selection. Keep client key enablement, provider availability, loaded model state and successful inference distinct. |
| Model controls and setup | Status checks perform no inference or automatic setup command. Start/stop only supported configured controls; safe diagnostics explain real next steps. |
| Test a key | Key-row handoff selects the intended key/model. Credential fetch is deferred until needed. Visible states distinguish not run, loading, success, failure and recovery. Production messages pass through unchanged. |
| Navigate and read | Desktop and narrow layouts keep actions reachable; labels, focus, navigation and state announcements are understandable. User-visible wording stays consistent across the journey. |

## Content and proof

Use `$write-gateway-product-copy` for wording and `$audit-gateway-ui` for behavior and journeys. Trace product, privacy, compatibility and readiness claims to shipping source. Do not imply that model metadata proves inference, or that provider choice requires self-hosting. Describe concrete value and real recovery actions without exposing implementation details that do not help the user decide.

Run relevant Vitest coverage and `./scripts/check-e2e.sh`. Browser E2E uses the real UI/gateway with controlled upstreams, and never proves a real model. Use `docs/BROWSER_SMOKE_PLAN.md` for observed usability; use the classifier-selected live gate for affected provider behavior. Source-only findings remain explicitly classified until rendered/interactive acceptance is inspected.
