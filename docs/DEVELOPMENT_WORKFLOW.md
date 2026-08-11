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
- Docker smoke proves image construction, non-root startup, mounted config, and `/health` response. It expects `ollama: disconnected` and does not prove model inference.
- Real backend testing must be explicitly requested, use local ignored credentials/configuration, avoid retaining response bodies, and record its target and exact tested commit separately.
- GitHub Actions is read-only and secretless. It never merges, deploys, or receives local gateway credentials.

## Pull requests

Pull requests begin as drafts and use `.github/pull_request_template.md`. Record the full head SHA, verification, independent review status, scope, and proof limits. A new commit invalidates exact-head evidence.

The stable required status is `Required checks`. Configure `main` according to `.github/BRANCH_PROTECTION_GUIDE.md`. Only the root implementation agent may fix findings, update PR state, or invoke a guarded squash merge after all exact-head gates pass.
