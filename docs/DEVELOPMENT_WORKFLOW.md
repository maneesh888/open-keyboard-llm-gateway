# LLM Gateway Development Workflow

## Proof levels

The repository uses cumulative validation modes:

| Mode | Command | Evidence |
| --- | --- | --- |
| Hygiene | `./scripts/check.sh --hygiene` | Environment, shell/YAML syntax, workflow policy, secret scan, whitespace |
| Quick | `./scripts/check.sh --quick` | Hygiene plus all Vitest tests and TypeScript build |
| Full | `./scripts/check.sh --full` | Quick plus browser/API E2E, Compose validation, Docker image build, and runtime `/health` smoke |

`--full` is the exact-head release and pre-push gate. The runtime smoke mounts generated, non-secret fixture configuration and expects the gateway to start successfully while reporting its intentionally absent Ollama backend as disconnected.

## Routing by changed surface

| Surface | Targeted iteration | Required handoff |
| --- | --- | --- |
| `src/middleware/`, auth, limits, proxy, key behavior | Relevant Vitest file | Quick |
| Admin API or static UI | `tests/admin/*`, content/journey review | Quick + browser E2E + observed walkthrough |
| Config or process startup | Config/integration tests | Full |
| Dockerfile, Compose, dependencies, runtime files | Build or focused script | Full |
| CI, hooks, scripts, repository skills/agents | Workflow policy test | Full |
| Docs only | Hygiene | Hygiene unless a behavior claim changed |

## Proof boundaries

- Vitest tests use deterministic local doubles and do not prove a real Ollama or Apfel backend.
- TypeScript build proves compilation for the declared project, not container startup.
- Docker smoke proves image construction, non-root startup, mounted config, and `/health` response. It expects `ollama: disconnected`; it does not prove model inference.
- The impact classifier selects required live transport/contract proof for runtime/provider changes. Read the secure local profile, use an owned exact-head gateway, and retain only sanitized assertions. Missing profile or unavailable/wrong model remains `LIVE_UNVERIFIED`; no fallback.
- GitHub Actions is read-only and secretless. It never merges, deploys, or receives local gateway credentials.

## Straight-line execution

1. Apply the objective/phase/authority record in `AGENTS.md`; keep scoped constraints separate from evidence readiness.
2. Prepare authorized coding in a fresh isolated worktree and inspect the outgoing commit scope before push.
3. Reconcile product sources. Apply `$write-gateway-product-copy` and `$audit-gateway-ui` to affected wording/journeys before edits; inspect adjacent handoffs without broadening scope.
4. Implement narrowly and run focused regression checks.
5. Run Full, browser E2E, applicable observed walkthrough and classifier-selected live proof. Preserve separate evidence classes and requirement rows.
6. Follow the existing independent exact-head review and guarded merge route. Verify relevant `main` CI afterward; clean only owned, clean, merged work.

### Browser/API E2E

Install locked dependencies and `npx playwright install chromium` (`--with-deps` on Linux CI). Run `./scripts/check-e2e.sh`. It builds and starts the production entry point with disposable state, fresh browser contexts and owned ephemeral upstream servers. No production browser request is intercepted. It covers login/session recovery, persistent key CRUD/revocation, reveal/copy, selected-key playground success/failure, narrow/desktop navigation, bounded fixture model controls, both provider routes, non-streaming/SSE, malformed upstream, redaction and metadata timeout.

Full and technical CI include this route. Vitest remains separate for fast iteration. Browser traces/video/automatic screenshots and failure ARIA snapshots are disabled; an expected-failure canary checks saved diagnostics for DOM credential leakage. Sensitive assertions compare booleans so values do not enter reporter errors. These captures are disabled because they can contain credentials; retain only intentionally sanitized visual proof. The fixture suite proves application integration, not live inference or observed usability. Follow `docs/BROWSER_SMOKE_PLAN.md` separately.

### Secure exact-head live proof

Create `<primary-checkout>/.agent/local-seeds/gateway-live.json`, ignored/untracked, current-user-owned, mode `600`, in a mode `700` seeds directory without symlinks or extended ACLs. Worktrees resolve this single profile through Git's common directory; do not copy it. Example with a deliberately non-routable placeholder:

```json
{"version":1,"provider":"ollama","upstreamUrl":"https://gateway-upstream.example.invalid","model":"replace-with-exact-model","timeoutMs":90000}
```

Use `ollama` for the gateway's Ollama-compatible upstream or `apfel` with exact model `apple-foundationmodel`. Set the explicit HTTPS origin or loopback HTTP origin; credentials, extra fields, URL paths, queries, incomplete profiles and model/route mismatch are rejected. The gateway does not accept arbitrary upstream bearer credentials through this profile.

`node scripts/verification-impact.mjs <base> <head>` classifies the complete PR diff including both sides of renames. Runtime sources, dependency manifests, container config, semantic gitlinks and live-proof infrastructure require live proof; UI/serving changes require observed browser proof. No valid base is a failure. Explicit requirements can demand additional target/model or UI evidence beyond this minimum classifier; retain separate rows for every requested target.

`./scripts/check-live.sh` requires a clean committed checkout, rebuilds it, launches an owned gateway with ephemeral client credentials, and checks unauthorized access, the exact model entry in both the scoped gateway catalog and the selected provider’s own catalog, nonempty compatible completion and a complete SSE response for that exact model. It does not start/stop real model services. Requests use public transport fixtures, bounded time/size/token limits and no fallback. It writes `.ci-results/live-proof.json` with the exact SHA, provider, target digest, time and boolean assertions. The digest binds the configured origin/provider/model without publishing the private profile. The pre-push hook reruns the selected gate; a failed attempt removes stale retained proof.

Live transport/contract success is not semantic acceptance, proof of every supported provider, or browser usability. Never retain prompts, response bodies or credentials. Use `DETERMINISTIC_VERIFIED`, `LIVE_VERIFIED`/`LIVE_UNVERIFIED`, and `RUNTIME_VERIFIED`/`RUNTIME_UNVERIFIED` separately; the requirement ledger remains authoritative.

### Models for development agents

Project `.codex/agents/` roles use Terra/medium for bounded exploration and planning and Astra/high for product copy, usability and independent review. Skills define the work method; roles choose model and effort. The root retains implementation ownership and the conversation's selected model. These settings do not change gateway inference model selection. If a configured model is unavailable, report that route and use an explicitly selected supported alternative; do not claim a model ran when it did not.

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

## Browser/live metadata activation

The initial implementation adds `.github/verification-evidence-enforced` and validator scripts. Its base lacks that marker, so new workflow metadata is explicitly `bootstrap-not-enforced`; existing technical and review checks remain mandatory. Local live/browser evidence is still required by the work scope.

Once the marker exists on `main`, the existing metadata workflow loads the classifier, live-proof validator and workflow validator only from that trusted base. Missing trusted scripts fail closed. It classifies the Git diff itself and validates both immutable-event and current-PR bodies, requiring equal base/head revisions. Test an activation PR under that trusted base; do not claim remote enforcement proof from candidate-only tests. No new protected status name or weaker branch protection is introduced: `Required review evidence` includes these validations, and `Required checks` includes browser E2E.

PR fields are `Workflow live proof` (the sanitized JSON, or `not-required` when unclassified) and `Workflow browser proof` (`observed:<sha>:<reference>`, exact-head human route, or `not-required` when unclassified). These are audit metadata, not cryptographic evidence of execution or visual quality. The independent reviewer inspects the underlying proof and every requirement row. A new commit expires all evidence.

## Pull requests

Pull requests begin as drafts and use `.github/pull_request_template.md`. Record the full head SHA, requirement ledger, verification, independent review link/status, authorization route, scope, and proof limits. A new commit invalidates exact-head evidence.

The fixed protected statuses after activation are technical `Required checks` and metadata `Required review evidence`. Configure `main` according to `.github/BRANCH_PROTECTION_GUIDE.md`. Only the root implementation agent may fix findings, update PR state, or invoke a guarded squash merge after all exact-head gates pass.
