---
name: review-verify-merge-pr
description: Independently review LLM Gateway pull requests and verify exact-head readiness. Use for PR review and for authorized implementation lifecycles reaching guarded readiness and merge; honor explicit draft or merge opt-outs.
---

# Review, Verify, and Safely Merge an LLM Gateway PR

Bind every review conclusion and state change to one exact pull-request head.

## Authority

- Review/readiness requests are read-only. A bounded implementation request authorizes the guarded repository lifecycle.
- Only the root agent may fix findings, commit, push, change PR state, or merge. The independent `pr-reviewer` stays read-only.
- Honor `local only`, `do not commit`, `do not push`, `do not create a PR`, `keep draft`, and `do not merge`.
- Do not request another confirmation while the same-head reviewer reports operational confidence exactly `100%` and recommends `automatic`. Below 100%, explicit repository-owner authorization naming the current full SHA is mandatory.
- Deployment remains separate. Never bypass hooks, scanners, required checks, protection, or valid review findings.

## Establish the target

1. Resolve the PR number, base, full head SHA, draft state, diff, mergeability, reviews, unresolved threads, and checks.
2. Use a clean isolated worktree when the checkout is not the exact head.
3. Read `AGENTS.md`, the PR brief, root diff, and only relevant requirement/acceptance sources.
4. Treat any head change as invalidating prior local, CI, Docker, independent-review, reviewer-confidence, and human-authorization evidence.

## Review and verify

1. Prepare a neutral packet with PR identity/base/head, requested behavior, durable sources, acceptance criteria, changed files/diff, verification and proof boundaries, and explicitly authorized out-of-scope behavior. Include one stable sequential `R1` through `RN` ledger row per in-scope requirement with its criterion and exact required proof type. Exclude secrets, private prompts, response bodies, and raw logs.
2. Spawn the read-only project `pr-reviewer` without inherited implementation context when available. Run independent review and GitHub checks concurrently where practical.
3. Treat missing, ambiguous, stale, skipped, substituted, fallback, wrong-target, uninspectable, contributor-attested-only when stronger evidence is required, or weaker-than-required proof as `UNVERIFIED`. Never combine rows, narrow acceptance, or substitute proof types.
4. Treat correctness, security, authentication, authorization, credential exposure, rate-limit bypass, proxy/streaming or OpenAI-compatible contract, data-loss, missing-material-test, and false-evidence findings as blockers.
5. Require the reviewer to return every row in the exact six-column report contract: `ID | Observable acceptance criterion | Required proof type | Evidence inspected | Status | Independent assessment`. Acceptance and proof cells must copy the ledger verbatim.
6. Require exactly one report field for reviewer marker, exact head, N/N coverage, unverified IDs, blocking findings, non-overridable blockers, mandatory exact-head gates, confidence, recommendation, and conclusion. The textual project-reviewer marker is audit/process evidence, not cryptographic actor-identity proof.
7. Use `100%` / `automatic` / `requirements-complete` only when every row is `VERIFIED`, mandatory exact-head gates are complete, and no blocker or material uncertainty remains. Otherwise use `below 100%` / `human-review-required` / `human-review-required` and retain every gap.
8. Run `./scripts/check.sh --full` on the clean exact head for readiness.
9. Confirm `Required checks` succeeds for the same head before the report is finalized.

During an implementation lifecycle, fix in-scope blockers while the PR remains draft, then repeat the exact-head review/gate cycle. Review-only work reports findings and stops. Every new commit invalidates all earlier exact-head proof and authorization.

The root must retain the exact independent report as a durable GitHub `COMMENTED` review and link that submission in the PR. The report must never be submitted as `APPROVED` or `CHANGES_REQUESTED`. The linked submission must be the newest same-head project-reviewer report; a newer blocking report supersedes any older positive report.

After linking the report, submit exactly one same-head COMMENTED review with this body, replacing the placeholder with the full SHA:

```text
Review-evidence revalidation trigger for exact head <full-sha>. This COMMENTED submission is not an approval, an independent-review report, or merge authorization.
```

The revalidation trigger must not contain the project-reviewer marker and is not the linked report. It exists to re-run the `pull_request_review` event family after the body link is current.

## Readiness gate

Require all of the following for the same full head SHA:

1. Current PR brief and neutral reviewer packet with all `R1` through `RN` ledger rows.
2. Independent review with N/N coverage and either the automatic or human authorization route below.
3. Successful local full gate.
4. Successful `Required checks`.
5. A durable newest same-head project-reviewer `COMMENTED` report linked in the PR, plus successful `Required review evidence` results for both the body/state and review-event families.
6. Successful `gh pr checks <number> --required`; this is mandatory because a newer same-name result can otherwise hide a failed event family.
7. No requested changes or unresolved threads.
8. In-scope, secret-safe diff with no generated artifacts.
9. Mergeable/up-to-date branch and effective `main` protection requiring PRs, strict updating, conversation resolution, and both fixed contexts after rollout activation.

Require exactly one authorization route:

- **Automatic:** every requirement is `VERIFIED`; no blocker or material uncertainty exists; all mandatory exact-head gates are complete; reviewer confidence is exactly `100%`; and recommendation is `automatic`. Human fields are `not-required`.
- **Human:** confidence is below 100%, recommendation is `human-review-required`, the PR remains draft until the repository owner explicitly authorizes the current full SHA in the active task, and every `UNVERIFIED` row and accepted proof gap remains visible. The root must not infer approval from authorship, the implementation request, prior-SHA approval, silence, or general policy.

Human authorization accepts only disclosed overridable proof risk. It never overrides security, authentication, authorization, credential exposure, data loss, the OpenAI-compatible API/proxy contract, failed or missing mandatory tests/checks, conflicts, requested changes, unresolved threads, secret controls, or branch protection. If any such blocker exists, both routes fail. If below-100% authorization is absent, keep the PR draft, report the current full SHA and gaps, and stop for the owner's decision.

Pending, skipped, stale, missing, cancelled, or failed mandatory evidence blocks readiness and merge.

## Guarded merge

If `keep draft`, leave the PR draft. If `do not merge`, a clean head may become ready but remains unmerged. Otherwise refresh every gate, run `gh pr checks <number> --required`, mark ready, refresh and run it again, then invoke:

```bash
gh pr merge <number> --auto --squash --match-head-commit <reviewed-head-sha>
```

Inspect state immediately. If GitHub queues instead of completing, disable auto-merge and report the unsatisfied gate. If the head changes, disable auto-merge, return to draft when applicable, and restart the cycle. Never force, use administrator bypass, dismiss valid feedback, or leave unattended auto-merge queued.

After merge, report the PR URL, reviewed head, squash commit, checks, review result, and proof limits. Inspect resulting `main` CI when workflow/runtime claims depend on it.
