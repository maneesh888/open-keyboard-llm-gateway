# LLM Gateway Development Workflow

## Proof levels

The repository uses cumulative validation modes:

| Mode | Command | Evidence |
| --- | --- | --- |
| Hygiene | `./scripts/check.sh --hygiene` | Environment, shell/YAML syntax, workflow policy, secret scan, whitespace |
| Quick | `./scripts/check.sh --quick` | Hygiene plus all Vitest tests and TypeScript build |
| Full | `./scripts/check.sh --full` | Quick plus Compose validation, Docker image build, and runtime `/health` smoke |

`--full` is the exact-head release and pre-push gate. The runtime smoke mounts generated, non-secret fixture configuration and expects the gateway to start successfully while reporting its intentionally absent Ollama backend as disconnected.

## Routing by changed surface

| Surface | Targeted iteration | Required handoff |
| --- | --- | --- |
| `src/middleware/`, auth, limits, proxy, key behavior | Relevant Vitest file | Quick |
| Admin API or static UI | `tests/admin/*` | Quick |
| Config or process startup | Config/integration tests | Full |
| Dockerfile, Compose, dependencies, runtime files | Build or focused script | Full |
| CI, hooks, scripts, repository skills/agents | Workflow policy test | Full |
| Docs only | Hygiene | Hygiene unless a behavior claim changed |

## Proof boundaries

- Vitest tests use deterministic local doubles and do not prove a real Ollama or Apfel backend.
- TypeScript build proves compilation for the declared project, not container startup.
- Docker smoke proves image construction, non-root startup, mounted config, and `/health` response. It expects `ollama: disconnected`; it does not prove model inference.
- Real backend testing must be explicitly requested, use local ignored credentials/configuration, avoid retaining response bodies, and record its target and exact tested commit separately.
- GitHub Actions is read-only and secretless. It never merges, deploys, or receives local gateway credentials.

## Pull-request requirement evidence

Every implementation PR keeps one stable sequential `R1` through `RN` ledger row per in-scope requirement. Each row records the durable source, observable acceptance criterion, exact required proof type, inspectable evidence, and `VERIFIED` or `UNVERIFIED`. Missing, ambiguous, stale, skipped, substituted, fallback, wrong-target, uninspectable, contributor-attested-only when stronger proof is required, or weaker-than-required evidence stays `UNVERIFIED`.

The independent project reviewer must copy every acceptance criterion and proof type verbatim into its six-column report. The root posts that report as a durable GitHub `COMMENTED` review and links the newest same-head report from the PR body. Project-reviewer reports are never approvals or requested-changes reviews. A newer same-head report supersedes an older one, including when the newer report blocks. The textual reviewer marker supplies durable audit/process evidence; it does not cryptographically establish which actor controlled the GitHub account.

Automatic authorization requires all rows `VERIFIED`, no blocker or material uncertainty, complete exact-head mandatory gates, confidence exactly `100%`, and recommendation `automatic`. Below 100%, the PR remains draft until the repository owner explicitly authorizes the current full SHA. Human authorization retains every gap and cannot override security, authentication, authorization, credentials, data loss, the OpenAI-compatible API/proxy contract, failed mandatory tests/checks, conflicts, requested changes, unresolved threads, secret controls, or branch protection. Any new commit expires local proof, CI conclusions, review, confidence, and human authorization.

`.github/workflows/pr-review-evidence.yml` is a separate read-only, secretless metadata workflow with fixed context `Required review evidence`. It handles PR body/state and review submitted/edited/dismissed events without a capped concurrency queue. It validates both the immutable triggering-event snapshot and separately fetched current GitHub state; both must name the same full head and both must pass. Once enforcement exists on the base branch, the workflow loads all validator code from that trusted base commit and fails if any validator is absent. It never falls back to candidate validators after activation.

The independent report submission initially fails its review-event family because the immutable PR snapshot cannot yet link that new report. After the PR body links the report and its body/state event succeeds, submit the exact same-head non-approval COMMENTED revalidation sentence from `$review-verify-merge-pr`. This reruns the review-event family without masquerading as a report or approval. Before readiness and merge, `gh pr checks <number> --required` must succeed so an unsuperseded failed event family cannot be hidden by a newer result with the same protected name.

The metadata workflow does not run the Node matrices, build, semantic-contract checks, or Docker smoke. Those remain in `.github/workflows/ci.yml` with their existing triggers, concurrency behavior, and stable technical aggregate `Required checks`.

## Staged enforcement rollout

The bootstrap implementation PR adds the marker, validators, workflow, policy tests, and documentation. Because its base lacks trusted validators, its candidate-validator run is bootstrap evidence only; `main` protection remains on `Required checks` through that merge. After those files exist on `main`, create a small activation/proof PR. Its metadata workflow must report `trusted-base`, and both pull-request and review-event families must be exercised on one real exact head.

Only after `Required review evidence` succeeds on that activation head may protection require both `Required checks` and `Required review evidence`. Preserve strict branch updating, conversation resolution, administrator enforcement, force-push blocking, and deletion blocking. The activation PR then completes the same guarded exact-head lifecycle under both contexts.

## Pull requests

Pull requests begin as drafts and use `.github/pull_request_template.md`. Record the full head SHA, requirement ledger, verification, independent review link/status, authorization route, scope, and proof limits. A new commit invalidates exact-head evidence.

The fixed protected statuses after activation are technical `Required checks` and metadata `Required review evidence`. Configure `main` according to `.github/BRANCH_PROTECTION_GUIDE.md`. Only the root implementation agent may fix findings, update PR state, or invoke a guarded squash merge after all exact-head gates pass.
