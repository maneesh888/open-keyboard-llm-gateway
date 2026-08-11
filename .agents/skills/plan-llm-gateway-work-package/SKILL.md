---
name: plan-llm-gateway-work-package
description: Create a concise, source-bound LLM Gateway work order from current repository docs. Use when the user asks what to do next or explicitly requests a plan; do not delay an already clear implementation request.
---

# Plan an LLM Gateway Work Package

Produce one compact read-only work order without editing files or changing project state.

## Read minimal sources

1. Resolve the root, inspect `git status --short --branch`, and read `AGENTS.md` completely.
2. Read only the current capability/setup sections in `README.md` relevant to the request.
3. Select only directly relevant focused sources: `ADMIN_FUNCTION_TEST_PLAN.md`, `ADMIN_UI_REQUIREMENTS.md`, `docs/OPEN_KEYBOARD_CLIENT.md`, or `docs/APFEL_PORTAL_POC.md`.
4. Read the applicable mode, routing row, and proof boundary in `docs/DEVELOPMENT_WORKFLOW.md`.
5. Treat old completion reports or test notes as historical unless a current source makes them authoritative.
6. Compute `git hash-object` digests for every source used in the work order.

## Keep planning non-blocking

- Do not edit, test, install hooks/dependencies, access GitHub, or spawn agents.
- Do not ask for repository facts that can be discovered locally.
- If implementation is already clear and bounded, return control immediately.
- Surface only a decision that changes scope, architecture, credentials, proof, deployment, or lifecycle.

## Return this form

Keep the response under 500 words:

```text
Work package:
Current project state:
Objective:
Requirement sources:
Source digests:

In scope:
Out of scope:
Affected surfaces:
Likely files/modules:

Mode: Fast | Standard | Release
Targeted verification:
Release-only deferred gates:
Proof limits:

Lifecycle: planning only | implementation requested | narrowed by explicit opt-out
Blocking decision: none | concise decision
Next action:
```

Use Release for PR readiness, merge, workflow/release hardening, or explicit release verification. A digest mismatch requires refreshing only the changed source and affected fields.
