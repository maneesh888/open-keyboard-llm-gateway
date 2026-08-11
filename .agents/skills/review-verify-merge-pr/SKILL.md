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
- Deployment remains separate. Never bypass hooks, scanners, required checks, protection, or valid review findings.

## Establish the target

1. Resolve the PR number, base, full head SHA, draft state, diff, mergeability, reviews, unresolved threads, and checks.
2. Use a clean isolated worktree when the checkout is not the exact head.
3. Read `AGENTS.md`, the PR brief, root diff, and only relevant requirement/acceptance sources.
4. Treat any head change as invalidating prior local, CI, Docker, and independent-review evidence.

## Review and verify

1. Prepare a neutral packet with PR identity/base/head, requested behavior, durable sources, acceptance criteria, changed files/diff, verification and proof boundaries, and out-of-scope behavior. Exclude secrets, private prompts, response bodies, and raw logs.
2. Spawn the read-only project `pr-reviewer` without inherited implementation context when available. Run independent review and GitHub checks concurrently where practical.
3. Treat correctness, security, credential exposure, authorization, rate-limit bypass, proxy/streaming contract, data-loss, missing-material-test, and false-evidence findings as blockers.
4. Run `./scripts/check.sh --full` on the clean exact head for readiness.
5. Confirm `Required checks` succeeds for the same head.

During an implementation lifecycle, fix in-scope blockers while the PR remains draft, then repeat the exact-head review/gate cycle. Review-only work reports findings and stops.

## Readiness gate

Require all of the following for the same full head SHA:

1. Current PR brief and neutral reviewer packet.
2. Independent review with no blocker.
3. Successful local full gate.
4. Successful `Required checks`.
5. No requested changes or unresolved threads.
6. In-scope, secret-safe diff with no generated artifacts.
7. Mergeable/up-to-date branch and effective `main` protection requiring PRs and the stable check.

Pending, skipped, stale, missing, cancelled, or failed mandatory evidence blocks readiness and merge.

## Guarded merge

If `keep draft`, leave the PR draft. If `do not merge`, a clean head may become ready but remains unmerged. Otherwise refresh every gate, mark ready, refresh again, and invoke:

```bash
gh pr merge <number> --auto --squash --match-head-commit <reviewed-head-sha>
```

Inspect state immediately. If GitHub queues instead of completing, disable auto-merge and report the unsatisfied gate. If the head changes, disable auto-merge, return to draft when applicable, and restart the cycle. Never force, use administrator bypass, dismiss valid feedback, or leave unattended auto-merge queued.

After merge, report the PR URL, reviewed head, squash commit, checks, review result, and proof limits. Inspect resulting `main` CI when workflow/runtime claims depend on it.
