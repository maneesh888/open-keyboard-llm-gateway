# Branch Protection Guide

Protect `main` with a branch ruleset or branch protection rule:

1. Require a pull request before merging.
2. Require at least one approval when another maintainer is available.
3. Require conversation resolution.
4. Require branches to be up to date before merging.
5. Require the `Required checks` status.
6. Block force pushes and branch deletion.
7. Disable administrator bypass when the repository should enforce one merge path.

Recommended repository settings:

- Allow squash merge.
- Delete head branches automatically after merge.
- Enable auto-merge only for the guarded exact-head lifecycle.

Before an intentional merge, invoke `$review-verify-merge-pr`, record the independent review's exact SHA in the PR body, and confirm the local full gate and GitHub status refer to that same head.

If native auto-merge queues rather than completing immediately, disable it and report the unsatisfied gate. Do not add a write-enabled Actions merger, use administrator bypass, or leave unattended auto-merge queued.
