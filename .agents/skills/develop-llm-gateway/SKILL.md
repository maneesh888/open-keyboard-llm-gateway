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
4. For semantic diagnostics, initialize the pinned `Vendor/semantic-prompt-contract` submodule and treat its canonical JSON and generated browser adapter as the source of truth.
5. If the user requests a plan, invoke the read-only `work-package-planner`; otherwise keep a compact internal work order and proceed.
6. Apply the authority/phase record and fresh isolated worktree rules in `AGENTS.md`. Preserve unrelated work and inspect all outgoing commits before publication.

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
7. Never copy canonical prompt wording into gateway code. The admin tester may consume package fixtures, while the production proxy must preserve client messages exactly.
8. Maintain the PR requirement ledger with one stable sequential row per in-scope requirement. Missing, stale, substituted, fallback, wrong-target, uninspectable, or weaker evidence remains `UNVERIFIED`.

## Content and journey loop

For changed visible wording, use `$write-gateway-product-copy`; for UI or journey changes, use `$audit-gateway-ui`. Resolve conflicting product sources before drafting. Keep findings tied to reachable production states and retain missing behavior as behavior work, not a wording fix. Follow `docs/BROWSER_SMOKE_PLAN.md` for observed acceptance and `./scripts/check-e2e.sh` for regression proof. These are distinct from live-provider evidence.

Use the configured project agent roles when delegation is useful: `gateway-explorer` for bounded source questions, `gateway-product-copy` for content, and `gateway-ui-auditor` for journeys. Roles select model/effort; skills define the method. Keep implementation ownership with the root and independent final review with `pr-reviewer`. Escalate uncertain conclusions to the root rather than silently substituting a model or weakening evidence.

## Lifecycle autonomy

A bounded implementation request authorizes branch preparation, edits, checks, commit, push, draft PR, in-scope review fixes, readiness, and guarded merge. Preserve each active constraint with its phase/task scope as described in `AGENTS.md`. Honor explicit opt-outs: `local only`, `do not commit`, `do not push`, `do not create a PR`, `keep draft`, or `do not merge`.

Planning/review-only requests remain read-only. Stop for unavailable credentials, ambiguous dirty-file ownership, destructive actions, material scope expansion, deployment, or another external change outside the request.

## Verify and publish

- Run affected tests while iterating.
- Run `./scripts/check.sh --hygiene` for Fast, `--quick` for Standard, and `--full` for Release.
- Run `./scripts/check-semantic-prompt-contract.sh` when the contract gitlink, semantic fixtures, generated browser adapter, or adapter-serving route changes.
- Run the classifier-selected `./scripts/check-live.sh` on the clean committed head before push. Inspect the sanitized proof; preserve exact provider/model identity.
- Install and never bypass the committed hooks.
- Start PRs as drafts and complete `.github/pull_request_template.md` with the full exact head SHA, exact-copy acceptance/proof rows, and current authorization fields.
- Use `$review-verify-merge-pr` for independent review, readiness, and guarded merge.

Keep the PR draft unless the independent same-head reviewer verifies every row, reports no blocker or material uncertainty, reports operational confidence exactly `100%`, and recommends `automatic`. Below 100%, only explicit repository-owner authorization naming the current full SHA can select the human route; preserve every `UNVERIFIED` row and proof gap. Never infer or manufacture that authorization. Human authorization cannot override security, authentication, authorization, credential exposure, data loss, API/proxy compatibility, mandatory gates, conflicts, requested changes, unresolved threads, secret controls, or branch protection.

After the root posts the report as a durable GitHub `COMMENTED` review and links it, use the exact labeled non-approval COMMENTED revalidation trigger described by `$review-verify-merge-pr`. Require fixed context `Required review evidence` and `gh pr checks <number> --required` before readiness and again before merge. Any new commit invalidates local proof, CI conclusions, the independent report, reviewer confidence, and human authorization.

Report changed surfaces, checks/results, branch/head, PR/merge state, and proof limits.
