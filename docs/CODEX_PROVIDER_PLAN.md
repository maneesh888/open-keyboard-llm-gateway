# Codex Provider Implementation and Rollout Plan

## Purpose

Maintain the private Codex provider without weakening the gateway's OpenAI-compatible contract, secret boundaries, Ollama/Apfel behavior, or guarded delivery workflow. This is the focused requirement source for Codex-provider implementation, hardening, verification, and deployment work.

The provider baseline shipped in PR #7. Treat the current implementation and public contract as the starting point; do not repeat completed work unless a current requirement or failing check proves that it has regressed.

## Shipped baseline

- Codex is opt-in and disabled by default.
- A stable public alias routes to a separately configured underlying Codex model and is reported with `owned_by: "codex"`.
- Only an exact per-key model grant authorizes Codex; a wildcard grant does not authorize, discover, or execute it.
- The MVP accepts non-streaming, text-only `POST /v1/chat/completions` requests and preserves structured OpenKeyboard operation normalization.
- The runner uses the pinned official Codex runtime with fixed arguments, prompt input over stdin, an empty temporary working directory, an isolated temporary `CODEX_HOME`, read-only sandboxing, no approvals, ephemeral state, and bounded output capture.
- Configuration bounds request duration, concurrency, queue length, prompt size, and output size. Client cancellation reaches the isolated turn, and the runner attempts to remove its temporary invocation directory afterward.
- Codex errors use the gateway's safe error envelope without returning credentials, prompts, raw responses, CLI events, stderr, private paths, or upstream configuration.
- Health reports `disabled`, `configured/ready`, or `unavailable` without making a paid inference call or changing Ollama/Apfel health.
- Deterministic tests use an injected fake runner. GitHub CI and Docker smoke do not receive Codex credentials or make live OpenAI calls.

The README and `docs/OPENAI_COMPATIBILITY.md` remain the public setup and API-contract sources. If implementation work changes the baseline, update those documents and this plan in the same change.

## Maintenance work order

For a Codex-provider feature, fix, upgrade, or security change:

1. Use `$develop-llm-gateway`, read this plan and the relevant public contract, and inspect the current implementation before proposing edits.
2. Verify version-sensitive Codex CLI or SDK assumptions against current official OpenAI documentation. Preserve the fixed isolated runner unless a supported interface can satisfy every existing security and cancellation boundary.
3. Keep routes thin and provider behavior under `src/providers/` and `src/proxy/`. Never accept client-controlled executable paths, arguments, environment variables, credentials, working directories, provider configuration, or underlying model identifiers.
4. Preserve authentication ordering, rate limiting, explicit Codex grants, structured-operation normalization, request cancellation, and existing Ollama/Apfel routing.
5. Reject unsupported streaming, tools, multimodal content, response formats, generation controls, and additive fields rather than silently ignoring them or overstating compatibility.
6. Add deterministic focused tests for every behavior change. At minimum, retain coverage for default-off behavior, configuration validation, model discovery and ownership, explicit authorization, routing, request mapping, response wrapping, structured operations, safe failures, timeout, cancellation, bounded output, concurrency saturation, and Ollama/Apfel regressions. Add direct runner tests before claiming that temporary-directory removal is verified.
7. Do not read the primary checkout's ignored configuration during deterministic tests. For an explicitly authorized credential-gated check, resolve the primary checkout from `git rev-parse --path-format=absolute --git-common-dir` as required by `AGENTS.md`; do not copy or edit its configuration from a disposable worktree, and do not retain response bodies, credentials, Authorization headers, or private prompts.

## Verification and pull-request gates

During implementation, run the smallest focused Vitest set that covers the changed surface. Before handoff:

1. Run `git diff --check`.
2. Run `./scripts/check.sh --quick` for provider-only logic, or `./scripts/check.sh --full` when configuration, startup, dependencies, Docker, workflow, or release behavior changes.
3. Install the committed hooks, stage only task files, inspect the staged filenames and diff, and scan for secrets or generated artifacts.
4. Commit and push without bypassing hooks. Open a draft PR with the repository template and full exact head SHA.
5. Before readiness or merge, require a clean exact-head `./scripts/check.sh --full`, independent same-head `$review-verify-merge-pr` review with no blocking findings, successful `Required checks`, no requested changes or unresolved threads, a mergeable diff, and effective `main` protection.
6. Use GitHub's native exact-head squash merge. Any new commit invalidates earlier exact-head checks and review.

Deterministic fake-runner tests prove gateway behavior only. The Docker smoke proves that the image starts with Codex disabled. Neither proves credentials, model entitlement, billing, network access, latency, response quality, or live Codex inference.

## Deployment authorization record

Merge, image publication, and deployment are separate actions. Do not publish or deploy until every field below is resolved outside this tracked file and the user explicitly authorizes the named target. Record secrets only in the approved secret manager or protected environment, never here.

| Required field | Deployment value |
| --- | --- |
| Target environment and host/service | `<required before deployment>` |
| Immutable merged commit or image digest | `<required before deployment>` |
| Deployment runbook or command | `<required before deployment>` |
| Protected service-account credential source | `<required before deployment>` |
| Approved underlying Codex model | `<required before deployment>` |
| External exposure policy | `<private/trusted users only>` |
| Rollout owner and maintenance window | `<required before deployment>` |
| Canary gateway key owner | `<required; exact Codex grant only>` |
| Health and functional probe base URL | `<required before deployment>` |
| Rollback version and tested command | `<required before deployment>` |
| Deployment approver and authorization reference | `<required before deployment>` |

These markers are gates, not values to replace in a planning or implementation PR. Keep them unresolved in source control; supply the real values through the separately authorized deployment record.

## Low-risk rollout and rollback

After explicit authorization:

1. Confirm the target is private, record the currently deployed immutable version, verify the rollback artifact and command, and confirm that the service credential is injected only through the protected `CODEX_API_KEY` environment.
2. Deploy the immutable merged candidate to one instance or a canary. Do not mount or copy personal Codex authentication, repository files, user configuration, plugins, skills, hooks, MCP state, or a writable project workspace.
3. Verify `/health`, existing Ollama/Apfel routing, and authentication/rate-limit behavior before enabling the Codex canary key.
4. Run one redacted non-streaming request with a dedicated key whose allowlist contains the exact Codex alias. Validate only status, latency bound, and response schema; do not print or retain the prompt, credential, or response body.
5. Inspect sanitized operational signals for crashes, timeouts, overload, process leaks, or secret exposure. Temporary-directory removal remains unproved unless the deployment has an explicitly authorized host-level observation that does not reveal paths or contents. Expand beyond the canary only after the named owner accepts the available evidence and its limits.
6. Roll back immediately if gateway health, existing providers, authentication, latency bounds, observable resource isolation, or the Codex probe fails. Disable the Codex configuration and canary key first when that safely contains the failure, then restore the recorded version using the tested rollback command.

## Completion report

Report the changed surfaces, tests and exact results, branch and exact head, PR/review/merge state, and proof limits. For an authorized deployment, also report the target, immutable deployed version, health and redacted canary result, expansion decision, and rollback readiness without revealing secrets or raw model content.
