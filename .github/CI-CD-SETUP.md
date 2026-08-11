# LLM Gateway CI/CD Setup

## Workflow

```text
Pull request
  -> Exact-head local full gate
  -> Independent read-only PR reviewer
  -> GitHub repository hygiene
  -> GitHub Node 24 and Node 22 tests
  -> GitHub Node 24 TypeScript build
  -> GitHub Docker build and runtime smoke
  -> Required checks
  -> Human/protection gates
  -> Guarded exact-head squash merge
```

Normal CI is read-only and secretless. It checks out the exact pull-request head and pins third-party Actions to full commit SHAs. It never receives gateway credentials, publishes an image, deploys, or merges.

## Independent reviewer

The repository includes `.codex/agents/pr-reviewer.toml` and `$review-verify-merge-pr`. The reviewer is read-only and reviews one exact head with neutral scope, requirement, diff, and verification context. A new commit invalidates the review.

## Local gates

- `./scripts/check.sh --hygiene`: repository and automation policy.
- `./scripts/check.sh --quick`: deterministic tests and build.
- `./scripts/check.sh --full`: quick gate plus Docker build/runtime smoke.

Install `.githooks` with `./scripts/install-hooks.sh`. Pre-commit runs the quick gate from a fully staged worktree. Pre-push requires a clean committed checkout and runs the full gate.

## Required repository settings

Follow `.github/BRANCH_PROTECTION_GUIDE.md` and require the stable `Required checks` status. Enable squash merging and automatic branch deletion. Merge automation remains in the guarded root-agent lifecycle, not GitHub Actions.

## Deployment boundary

No registry or hosting destination is defined. Image publication and deployment require a named target, least-privilege credentials, a protected environment, and separate explicit authorization.
