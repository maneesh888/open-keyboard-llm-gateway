# LLM Gateway Default Workflow

## Purpose

Use this workflow for gateway implementation, tests, Docker validation, CI, independent pull-request review, and guarded merge work. Keep every task bounded, secret-safe, and tied to reproducible repository checks.

## Start Every Task

1. Resolve the repository root with `git rev-parse --show-toplevel` and inspect `git status --short --branch` before edits.
2. Preserve unrelated user or agent changes. Never clean, restage, or revert files outside the current task.
3. Before authorized coding, fetch the configured remote and create an isolated `codex/<session-slug>` worktree from fresh `origin/main`, unless the user explicitly selects another base or the current checkout. Stop on fetch failure; do not silently use a stale base. Preserve the integration checkout even when clean.
4. Treat an existing dirty file as in scope only when the user explicitly assigns it or the requested workflow necessarily includes it.
5. If the user requests planning or asks what to do next, invoke the read-only `work-package-planner`; it uses `$plan-llm-gateway-work-package`.
6. For a clear implementation request, use `$develop-llm-gateway` and keep an internal work order: objective, affected surfaces, out-of-scope behavior, verification, and publish authority.
7. Ask only when scope, dirty-file ownership, destructive cleanup, credentials, external deployment, or a material architectural choice is genuinely ambiguous.

## Authority and task phases

Keep a compact internal record of objective, phase, constraints and their scope/expiry, edit/commit/push/PR/merge authority, required evidence, and blockers. Recheck it before each state change. A bounded implementation request grants the normal lifecycle below; evidence gates determine when an authorized action is ready, without another permission request.

Planning, audits, diagnosis, and “test and report before implementing” are read-only. Use existing checks or a temporary non-repository harness for proof-first experiments. Do not edit tracked production, tests, or docs in that phase. “Try another approach” does not clear an active restriction. After delivering a diagnostic checkpoint, a clear implementation request ends that phase's constraints; independently task-wide restrictions remain active until revoked. An unavailable required provider is `LIVE_UNVERIFIED`, not evidence about model capability.

## Content, usability, and evidence

For user-visible wording, use `$write-gateway-product-copy`; for changed screens or journeys, use `$audit-gateway-ui` inside the development loop. Review the entry, affected screen, next action, and recovery without expanding edit scope. Reconcile stale requirements before using them as acceptance authority. A copy change cannot replace a missing behavior or recovery path.

Keep these evidence classes separate: **automated regression**, **browser/API E2E with fixture upstreams**, **live provider transport/contract**, and **observed browser usability**. UI journeys need browser E2E and the walkthrough in `docs/BROWSER_SMOKE_PLAN.md`; affected provider/proxy behavior needs the classifier-selected live gate. Source inspection and successful clicks alone do not prove visual acceptance. Live transport does not prove semantic quality.

Report applicable `DETERMINISTIC_VERIFIED`, `LIVE_VERIFIED`/`LIVE_UNVERIFIED`, and `RUNTIME_VERIFIED`/`RUNTIME_UNVERIFIED` task labels separately from PR-row statuses. Missing required evidence blocks automatic readiness; keep the gap visible and follow the existing exact-head human route only for overridable evidence risk. Never call a required unverified journey working.

## Repository Tools

Prefer the committed routes over ad hoc command sequences:

- Implementation: `$develop-llm-gateway`
- Read-only planning: `work-package-planner` via `$plan-llm-gateway-work-package`
- Hygiene: `./scripts/check.sh --hygiene`
- Standard deterministic gate: `./scripts/check.sh --quick`
- Exact-head release gate: `./scripts/check.sh --full`
- Focused unit/integration tests: `npm test`
- TypeScript build: `npm run build`
- Browser/API E2E: `./scripts/check-e2e.sh`
- Exact-head live provider gate: `./scripts/check-live.sh`
- Change impact: `node scripts/verification-impact.mjs <base> <head>`
- Container runtime smoke: `./scripts/docker-smoke.sh`
- Hook installation: `./scripts/install-hooks.sh`
- Independent PR review: `pr-reviewer` via `$review-verify-merge-pr`

GitHub Actions runs repository hygiene, Node 24/22 tests, the Node 24 build, and the Docker runtime smoke, and browser/API E2E, then reports the stable `Required checks` status.
Pull-request metadata validation runs separately and reports the fixed `Required review evidence` status without rerunning technical jobs.

## Change Rules

- Keep Hono routes thin. Put authentication and traffic policy in middleware, upstream behavior in `src/proxy/`, key persistence in `src/keys/`, and request logging in `src/logging/`.
- Add or update focused Vitest coverage when behavior changes.
- Keep Node runtime APIs compatible with the supported Node 24 production image and Node 22 compatibility lane.
- Preserve the OpenAI-compatible `/v1` contract and distinguish deterministic mock coverage from a real Ollama or Apfel backend test.
- Never print or commit API keys, Authorization headers, JWT secrets, password hashes, local config, private prompts, raw gateway responses, `.ci-results`, `dist`, or `node_modules`.
- Update README or focused docs when a public contract, setup route, verification route, or proof claim changes.

## Shared Semantic Prompt Contract

- Treat the pinned `Vendor/semantic-prompt-contract` Git submodule as the only canonical home for reusable prompt wording, semantic operation metadata, schemas, rendering rules, and semantic diagnostic fixtures.
- Initialize submodules before implementation or verification and require the checkout to match the recorded gitlink. Do not use an adjacent mutable package checkout as release proof.
- The gateway may serve generated package diagnostics in the admin tester, but production request handling must preserve client messages exactly and must not inject, rebuild, or own OpenKeyboard prompts.
- Do not edit generated adapters or copy canonical prompt wording into HTML, TypeScript, tests, or docs. Change canonical JSON, classify the semantic-version impact, regenerate, inspect equivalence fixtures, and advance the gitlink intentionally.
- Run `./scripts/check-semantic-prompt-contract.sh` for contract or adapter changes, then the proportional gateway gate. Live model proof remains distinct from deterministic package, mock, and Docker health checks.

## Verification Modes

- **Fast:** targeted tests plus `./scripts/check.sh --hygiene`.
- **Standard:** `./scripts/check.sh --quick` (hygiene, all Vitest tests, TypeScript build).
- **Release:** clean exact head plus `./scripts/check.sh --full` (Standard plus browser/API E2E, Compose validation, image build, and container `/health` smoke).

Always run `git diff --check` before claiming completion. A passing container health smoke proves the gateway image starts with safe fixture configuration and reports the backend disconnected; it does not prove a live Ollama/Apfel request.

## Fail-Closed Pull-Request Evidence

- Keep one stable sequential `R1` through `RN` ledger row for every in-scope requirement. Each row must retain its durable source, observable acceptance criterion, exact required proof type, inspected evidence, and `VERIFIED` or `UNVERIFIED` status.
- Missing, ambiguous, stale, skipped, substituted, fallback, wrong-target, uninspectable, contributor-attested-only when stronger proof is required, or weaker-than-required evidence remains `UNVERIFIED`. Never narrow a criterion or substitute a proof type to make a row pass.
- The independent project reviewer assesses every row and returns a six-column exact-copy report. The root retains it as a durable GitHub `COMMENTED` review and links the newest same-head report from the PR. Project-reviewer reports are never GitHub approvals or requested-changes submissions.
- The textual project-reviewer marker is durable audit/process evidence, not cryptographic proof of actor identity. Any newer same-head project-reviewer report supersedes an older report, including when the newer report blocks.
- Automatic authorization requires every row `VERIFIED`, no blocker or material uncertainty, complete mandatory exact-head gates, reviewer confidence exactly `100%`, and recommendation `automatic`.
- Below 100%, keep the PR draft. Merge requires explicit repository-owner authorization naming the current full SHA. Retain every `UNVERIFIED` row and accepted proof gap.
- Human authorization never overrides security, authentication, authorization, credential exposure, data loss, the OpenAI-compatible API/proxy contract, failed or missing mandatory tests/checks, conflicts, requested changes, unresolved threads, secret controls, or branch protection.
- A new commit invalidates local proof, CI conclusions, independent review, reviewer confidence, and human authorization.

### Review and readiness order

The report field `Mandatory exact-head gates` is the legacy name for review-stage prerequisites: clean head, local Full, technical `Required checks`, required live/observed proof and each requirement's evidence. Metadata checks consume that report and run afterward. The reviewer records `Post-report readiness: pending`; its automatic recommendation alone is not merge authorization. The root must then post/link/revalidate the report and require both metadata event families and `gh pr checks --required` before readiness or merge. Failed/missing checks at either stage block advancement through that stage; no check is waived. A new commit expires both stages.

## Pull Request Lifecycle

A bounded implementation request authorizes the normal lifecycle through branch preparation, edits, verification, commit, push, draft PR, in-scope review fixes, readiness, and guarded merge unless the user opts out with `local only`, `do not commit`, `do not push`, `do not create a PR`, `keep draft`, or `do not merge`.

Before commit:

1. Install the committed hooks with `./scripts/install-hooks.sh`.
2. Inspect `git status --short --branch` and stage only task files.
3. Inspect `git diff --cached --name-only` and scan the staged diff for secrets or generated artifacts.
4. Never bypass hooks with `--no-verify`.

Create PRs as drafts with the repository template completed, including the full exact head SHA. For review/readiness/merge, use `$review-verify-merge-pr`. Any new commit invalidates earlier exact-head local checks and independent review.

Before push, inspect `git log origin/main..HEAD` and the complete outgoing diff. Stop if earlier unrelated commits have ambiguous ownership. The hook requires a clean exact head, Full, and any classifier-selected live check.

Before guarded merge require:

- exact-head `./scripts/check.sh --full` success;
- independent review of the same head with no blocking findings;
- successful `Required checks` for the same head;
- successful `Required review evidence` for both relevant event families and a successful `gh pr checks <number> --required` rollup;
- no requested changes or unresolved review threads;
- a mergeable in-scope diff; and
- effective protection of `main` requiring PRs and the aggregate check.

Use GitHub's native squash merge with exact-head matching. Never force, bypass protection, dismiss valid feedback, or leave an unattended queued auto-merge. Deployment or image publication is separate and requires an explicit target and authorization.

After merge, inspect relevant `main` CI. Remove only an owned, clean session worktree and a confirmed merged branch when no longer needed; never discard dirty or unmerged work.

## Reporting

Report the branch, changed areas, checks and results, exact SHA for Release work, PR/merge state, and residual proof limits. Do not equate mock tests or a disconnected-backend container smoke with live model behavior.
