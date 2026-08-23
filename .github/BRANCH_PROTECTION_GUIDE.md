# Branch Protection Guide

Protect `main` with a branch ruleset or branch protection rule:

1. Require a pull request before merging.
2. Require at least one approval when another maintainer is available.
3. Require conversation resolution.
4. Require branches to be up to date before merging.
5. Require the technical `Required checks` status.
6. After the staged activation proof, separately require the fixed `Required review evidence` status.
7. Block force pushes and branch deletion.
8. Enforce the rule for administrators.

Recommended repository settings:

- Allow squash merge.
- Delete head branches automatically after merge.
- Enable auto-merge only for the guarded exact-head lifecycle.

Before an intentional merge, invoke `$review-verify-merge-pr`, record and link the newest independent project-reviewer COMMENTED report for the exact SHA, and confirm the local full gate and both GitHub statuses refer to that same head. Run `gh pr checks <number> --required` before readiness and again before merge so a failed event family cannot be hidden by a newer same-name result.

Automatic authorization is allowed only for N/N `VERIFIED` requirements, no blocker or material uncertainty, complete mandatory exact-head gates, reviewer confidence exactly `100%`, and recommendation `automatic`. Below 100%, keep the PR draft until the repository owner explicitly authorizes the current full SHA. Human authorization retains every proof gap and never overrides a security, authentication, authorization, credential, data-loss, API/proxy-contract, mandatory-check, conflict, requested-change, unresolved-thread, secret-control, or protection blocker.

Roll out the second context in two stages. Merge the bootstrap implementation under the existing `Required checks` protection because the base cannot supply trusted validators. Then use a small activation/proof PR whose metadata run loads validators from the trusted base and exercises both PR and review events. Only after a real exact-head `Required review evidence` success should protection be updated to require both fixed contexts. Preserve strict updates, conversation resolution, administrator enforcement, force-push blocking, and deletion blocking throughout.

If native auto-merge queues rather than completing immediately, disable it and report the unsatisfied gate. Do not rename or repurpose `Required checks`, add a write-enabled Actions merger, use administrator bypass, or leave unattended auto-merge queued.
