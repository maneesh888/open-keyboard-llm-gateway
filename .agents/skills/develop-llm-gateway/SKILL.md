---
name: develop-llm-gateway
description: Execute bounded LLM Gateway analysis, implementation, testing, documentation, CI, Docker, security, and release-hardening work. Use for changes to this TypeScript/Hono gateway and carry authorized implementation through the repository's guarded lifecycle.
---

# Develop LLM Gateway

Work on one bounded gateway package while preserving API compatibility, secret boundaries, and truthful proof.

## Establish context

1. Resolve the repository root, inspect `git status --short --branch`, and read `AGENTS.md` completely.
2. Read the relevant README sections and only the focused requirement sources for the changed surface: `ADMIN_FUNCTION_TEST_PLAN.md`, `ADMIN_UI_REQUIREMENTS.md`, `docs/OPEN_KEYBOARD_CLIENT.md`, or `docs/APFEL_PORTAL_POC.md`.
3. Read `docs/DEVELOPMENT_WORKFLOW.md` when choosing checks or changing scripts, hooks, CI, Docker, skills, agents, or release behavior.
4. If the user requests a plan, invoke the read-only `work-package-planner`; otherwise keep a compact internal work order and proceed.
5. Preserve unrelated work and use an isolated branch/worktree when a dirty integration checkout makes exact-head work unsafe.

## Select the mode

- **Fast:** focused change, affected tests, and hygiene.
- **Standard:** complete deterministic implementation plus the quick gate.
- **Release:** clean exact head, full gate, GitHub CI, independent review, and guarded readiness/merge.

Use the highest mode required by the requested outcome or affected surface.

## Execute

1. Keep route, middleware, proxy, key storage, configuration, logging, and admin responsibilities in their existing modules.
2. Add focused Vitest coverage for behavior changes and preserve Node 22/24 compatibility.
3. Preserve OpenAI-compatible response/streaming behavior and never forward client Authorization credentials upstream.
4. Keep mock, Docker smoke, and real Ollama/Apfel evidence distinct.
5. Never print or commit keys, JWT secrets, password hashes, Authorization headers, local config, private prompts, or raw gateway responses.
6. Update affected docs when public behavior or verification changes.

## Lifecycle autonomy

A bounded implementation request authorizes branch preparation, edits, checks, commit, push, draft PR, in-scope review fixes, readiness, and guarded merge. Honor the latest explicit opt-out: `local only`, `do not commit`, `do not push`, `do not create a PR`, `keep draft`, or `do not merge`.

Planning/review-only requests remain read-only. Stop for unavailable credentials, ambiguous dirty-file ownership, destructive actions, material scope expansion, deployment, or another external change outside the request.

## Verify and publish

- Run affected tests while iterating.
- Run `./scripts/check.sh --hygiene` for Fast, `--quick` for Standard, and `--full` for Release.
- Install and never bypass the committed hooks.
- Start PRs as drafts and complete `.github/pull_request_template.md` with the full exact head SHA.
- Use `$review-verify-merge-pr` for independent review, readiness, and guarded merge.

Report changed surfaces, checks/results, branch/head, PR/merge state, and proof limits.
