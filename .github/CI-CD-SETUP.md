# LLM Gateway CI/CD Setup

## Workflow

```text
Pull request
  -> Exact-head local full gate
  -> GitHub repository hygiene
  -> GitHub Node 24 and Node 22 tests
  -> GitHub Node 24 TypeScript build
  -> GitHub semantic-contract Node lanes
  -> GitHub Docker build and runtime smoke
  -> Required checks
  -> Independent read-only PR reviewer COMMENTED report
  -> PR body link and COMMENTED review-event revalidation
  -> Required review evidence
  -> Automatic 100% or explicit exact-SHA owner authorization
  -> gh pr checks --required and protection gates
  -> Guarded exact-head squash merge
```

Normal CI is read-only and secretless. It checks out the exact pull-request head and pins third-party Actions to full commit SHAs. It never receives gateway credentials, publishes an image, deploys, or merges.

## Independent reviewer

The repository includes `.codex/agents/pr-reviewer.toml` and `$review-verify-merge-pr`. The reviewer is read-only and reviews one exact head with a neutral requirement ledger, diff, verification context, and proof boundaries. It covers every row, copies criteria/proof types without narrowing, and reports `VERIFIED` or `UNVERIFIED`. The root retains the exact report as a durable GitHub `COMMENTED` review; it is never an approval. The textual marker is audit/process evidence rather than cryptographic actor identity. A newer same-head report supersedes an older one, and a new commit invalidates the review.

## Review-evidence workflow

`.github/workflows/pr-review-evidence.yml` is separate from technical CI. It has read-only permissions, no secrets, no `pull_request_target`, no write permission, and no capped concurrency queue. It handles PR body/state events and review submitted/edited/dismissed events, validating the immutable event snapshot and separately fetched current GitHub state against the same full head. Once the base contains `.github/review-evidence-enforced`, validator code is loaded only from that trusted base and missing base validators fail closed.

The fixed metadata context is `Required review evidence`; the technical aggregate remains `Required checks`. Review comments do not rerun Node tests, TypeScript build, semantic-contract lanes, or Docker smoke. After linking the newest report, use the exact same-head COMMENTED revalidation trigger documented in the review skill. Require `gh pr checks <number> --required` before readiness and merge.

## Local gates

- `./scripts/check.sh --hygiene`: repository and automation policy.
- `./scripts/check.sh --quick`: deterministic tests and build.
- `./scripts/check.sh --full`: quick gate plus Docker build/runtime smoke.

Install `.githooks` with `./scripts/install-hooks.sh`. Pre-commit runs the quick gate from a fully staged worktree. Pre-push requires a clean committed checkout and runs the full gate.

## Required repository settings

Follow `.github/BRANCH_PROTECTION_GUIDE.md`. Stage 1 retains only stable `Required checks`; its candidate validator run is bootstrap evidence. After a Stage 2 real exact-head trusted-base proof exercises both metadata event families, require both fixed contexts: `Required checks` and `Required review evidence`. Preserve strict updating, conversation resolution, administrator enforcement, force-push blocking, and deletion blocking. Enable squash merging and automatic branch deletion. Merge automation remains in the guarded root-agent lifecycle, not GitHub Actions.

## Deployment boundary

No registry or hosting destination is defined. Image publication and deployment require a named target, least-privilege credentials, a protected environment, and separate explicit authorization.
