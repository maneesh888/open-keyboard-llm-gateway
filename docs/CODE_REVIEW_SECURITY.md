# Advisory Code Review and security review

## Routine route and boundaries

Use the Codex app **Code Review** PR view and its PR chat as the routine advisory route.
Inspect the exact PR base/head, diff, supporting code, comments and checks. Use the existing
chat when available. App chat reviews and automatic GitHub reviews are distinct. If a
completed automatic GitHub Code Review already covers the same scope and revision, inspect
that result instead of launching a duplicate app review. Record which route supplied it.
Local `/review` is a checkout review, not the PR plugin or a GitHub submission.

This is an advisory rollout, not a new protected status or an account activation instruction.
Deterministic CI, secret scans, the independent project `pr-reviewer`, its six-column ledger,
exact-head validity, draft/readiness and guarded merge remain mandatory. The independent
reviewer must inspect external findings and their evidence rather than inherit another
reviewer's conclusion. App/cloud results must never be labeled as the custom reviewer report.
Validated correctness/security findings enter the existing blocker rules. A completed review
with no findings does not prove security, runtime behavior, or all acceptance criteria.

For auth/authorization, credentials/headers, network/endpoints/trusted proxies, rate limits,
storage/privacy/logging, command execution, dependencies, signing or CI permissions, add a
deeper security review of the changed boundary and directly supporting code. Prefer a local
scoped Changes scan when the Codex Security plugin is installed and authorized. Use GitHub
Security Review only when eligibility, access, disclosure audience and its trigger are
confirmed and authorized. Keep these routes distinct from Security Cloud repository scans.
Policy scripts can execute commands: this workflow integration itself is security-sensitive.

## Record and inspect actual results

Keep one private record per selected route. Record base/head, scope, product/route, status,
reason, whether the report was inspected, a private report reference and each finding's
evidenced disposition. Use only `pending`, `completed`, `failed`, `unavailable`, or
`not-applicable`. A running review is pending; execution failure is failed; missing access
is unavailable. Not-applicable needs a scope reason. A failed or unavailable run with zero
findings is never a clean review. If a private report cannot be inspected, do not mark it
completed. Preserve its prior revision as historical evidence after a new commit, and
refresh affected reviews/checks before claiming completion on the new head.

Private JSON record shape (replace placeholders; do not commit filled scan records):

```json
{
  "version": 1,
  "base": "<full-base-sha>",
  "head": "<full-head-sha>",
  "route": "local-security",
  "scope": "PR diff and directly supporting authorization code",
  "status": "unavailable",
  "reason": "Local scan capability has not been confirmed",
  "inspected": false,
  "privateReport": null,
  "findings": []
}
```

Routes are `app-code-review`, `github-code-review`, `local-security`, `github-security`,
or `security-cloud`. For completion, set `inspected: true` and an inspectable private
reference. Findings use `id`, `disposition` (`accepted`, `dismissed`, `fixed`, `unresolved`)
and `evidence`. Accepted/unresolved findings need independent triage; fixed needs regression
proof, and dismissed needs a reason grounded in the code/attack path. Validate the record:

```bash
node scripts/advisory-review.mjs /private/path/review.json <base-sha> <head-sha>
```

This validates bookkeeping, not the report's truth, quality or merge readiness. It is not a
mandatory CI gate and runs no scan. Give the independent reviewer private references with
access to inspect them. Public PRs receive only sanitized scope, revision, status and
disposition summaries. Do not post vulnerability details, private infrastructure, raw reports,
credentials, prompts or gateway responses. Do not fabricate coverage scores or timings.

## Baseline and threat-model route

Use [SECURITY.md](../SECURITY.md) as the public, repository-specific threat-model starting
point. With local plugin availability and scan usage authorized, select Security → Scans →
+ Scan → Codebase, the owned Gateway checkout and exact revision, and start one standard
baseline scan. Review auth/key scope, credential forwarding/redaction, trusted proxies/rate
limits, endpoint trust, key persistence, streams and admin sessions. A baseline is prepared
here, not executed or required on every PR. Subsequent sensitive PRs use Changes with explicit
base/head and supporting context. Revisit the baseline when trust boundaries change.

Before a baseline, record plugin version, chosen model/effort and criteria such as reachable
attack-path evidence, false positives and actionable remediation. After it finishes, inspect
`report.md`, `scan-manifest.json`, `findings.json` and `coverage.json`, including deferred
surfaces and validation limits. Keep the complete artifact directory private outside the
repository. An unfinished scan or incomplete coverage is not absence of vulnerabilities.

## Availability, activation and usage

Documentation checked on 2026-10-15:

- [App Code Review](https://learn.chatgpt.com/docs/code-review) supports PR inspection and
  chat review. Reviewing in chat does not itself publish provider feedback.
- [GitHub Code Review](https://learn.chatgpt.com/docs/third-party/github) has separate
  repository/personal settings and the manual `@codex review` comment trigger.
- [GitHub Security Review](https://learn.chatgpt.com/docs/security/security-review) currently
  supports Enterprise, Business, Edu and Pro, not Plus; it consumes included allowance or
  credits. It has separate auto-review settings and `@codex security review`. Its findings
  inherit PR visibility; absence of posted findings can reflect a severity threshold.
- [Local security Changes scans](https://learn.chatgpt.com/docs/security/plugin/code-changes)
  and [baseline scans](https://learn.chatgpt.com/docs/security/plugin/scans) require the local
  plugin. [Security Cloud](https://learn.chatgpt.com/docs/security/setup) is a separate service.

Recheck current official documentation and actual account/plugin capabilities before use.
The implementation session exposed Code Review CI diagnostics but no review-launch tool;
local Codex Security was not confirmed installed, and GitHub Security Review eligibility was
not established. These are capability limits, not clean scan results. No plugin installation,
account settings, automatic reviews, recurring cloud scans, branch protection, vulnerability
publication or separately purchased usage is activated by these files.

Before activation, confirm access to the exact repository, plan/allowance and intended
report audience. Changes to account settings, installation, recurring scans and purchased
usage require explicit authority. Posting provider trigger/review comments also requires
applicable explicit authorization; ordinary PR lifecycle authority alone does not request
optional cloud-review comments. The existing project-reviewer COMMENTED report and labeled
revalidation remain authorized by the repository lifecycle. Missing optional services remain
visible but do not waive or substitute any mandatory local/project evidence.
