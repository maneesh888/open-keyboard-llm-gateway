#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CI_WORKFLOW="$ROOT/.github/workflows/ci.yml"
REVIEW_WORKFLOW="$ROOT/.github/workflows/pr-review-evidence.yml"
SEMANTIC_CONTRACT_CHECK="$ROOT/scripts/check-semantic-prompt-contract.sh"
SEMANTIC_CONTRACT_ROOT="$ROOT/Vendor/semantic-prompt-contract"

fail() {
  echo "workflow policy test failed: $1" >&2
  exit 1
}

[[ -f "$CI_WORKFLOW" ]] || fail ".github/workflows/ci.yml is missing."
[[ -f "$REVIEW_WORKFLOW" ]] || fail ".github/workflows/pr-review-evidence.yml is missing."
[[ -f "$ROOT/package-lock.json" ]] || fail "package-lock.json is missing."
[[ -x "$SEMANTIC_CONTRACT_CHECK" ]] || fail "semantic contract check is missing or not executable."
[[ -f "$SEMANTIC_CONTRACT_ROOT/contracts/manifest.json" ]] || fail "pinned semantic contract is missing."
git -C "$ROOT" check-ignore --quiet package-lock.json && fail "package-lock.json is ignored."

rg --quiet '^  pull_request:' "$CI_WORKFLOW" || fail "CI must run for pull requests."
rg --quiet '^  push:' "$CI_WORKFLOW" || fail "CI must run for pushes."
rg --quiet '^  workflow_dispatch:' "$CI_WORKFLOW" || fail "CI must support manual dispatch."
rg --quiet '^  workflow_call:' "$CI_WORKFLOW" || fail "CI must be reusable."
rg --quiet '^concurrency:$' "$CI_WORKFLOW" || fail "technical CI concurrency behavior must be preserved."
rg --quiet '^permissions:$' "$CI_WORKFLOW" || fail "CI must declare permissions."
rg --quiet '^  contents: read$' "$CI_WORKFLOW" || fail "CI must use read-only contents permission."
rg --quiet 'name: Required checks' "$CI_WORKFLOW" || fail "the stable Required checks aggregate is missing."
rg --quiet 'name: Semantic prompt contract' "$CI_WORKFLOW" || fail "semantic contract CI is missing."
rg --fixed-strings --quiet 'name: Semantic prompt contract (Node ${{ matrix.node }})' "$CI_WORKFLOW" ||
  fail "semantic contract CI must cover every supported Node lane."
rg --quiet 'submodules:[[:space:]]*recursive' "$CI_WORKFLOW" || fail "CI must initialize pinned submodules."
rg --quiet 'check-semantic-prompt-contract\.sh' "$CI_WORKFLOW" || fail "CI must validate the pinned contract."
rg --quiet '^## Shared Semantic Prompt Contract$' "$ROOT/AGENTS.md" || fail "gateway contract ownership workflow is missing."
git -C "$ROOT" ls-files --stage Vendor/semantic-prompt-contract | rg --quiet '^160000 ' || fail "semantic contract must be pinned as a gitlink."
rg --quiet 'github.event.pull_request.head.sha \|\| github.sha' "$CI_WORKFLOW" ||
  fail "jobs must check out the exact pull-request candidate."

if rg --quiet 'pull_request_target|\$\{\{[[:space:]]*secrets\.|contents:[[:space:]]*write|pull-requests:[[:space:]]*write' "$CI_WORKFLOW"; then
  fail "ordinary CI must not use privileged triggers, secrets, or write permissions."
fi
rg --quiet '^  pull_request:' "$REVIEW_WORKFLOW" || fail "review evidence must handle pull-request metadata events."
rg --quiet '^  pull_request_review:' "$REVIEW_WORKFLOW" || fail "review evidence must handle review events."
for event_type in opened synchronize reopened edited ready_for_review converted_to_draft submitted dismissed; do
  rg --quiet "^[[:space:]]+- $event_type$" "$REVIEW_WORKFLOW" ||
    fail "review evidence is missing the $event_type event."
done
rg --quiet '^permissions:$' "$REVIEW_WORKFLOW" || fail "review evidence must declare permissions."
rg --quiet '^  checks: read$' "$REVIEW_WORKFLOW" || fail "review evidence needs read-only check access."
rg --quiet '^  contents: read$' "$REVIEW_WORKFLOW" || fail "review evidence needs read-only content access."
rg --quiet '^  pull-requests: read$' "$REVIEW_WORKFLOW" || fail "review evidence needs read-only PR access."
rg --quiet '^[[:space:]]+name: Required review evidence$' "$REVIEW_WORKFLOW" ||
  fail "the fixed Required review evidence context is missing."
if rg --quiet '^concurrency:|pull_request_target|\$\{\{[[:space:]]*secrets\.|contents:[[:space:]]*write|pull-requests:[[:space:]]*write|checks:[[:space:]]*write' "$REVIEW_WORKFLOW"; then
  fail "review evidence must have no capped concurrency queue, privileged trigger, secret, or write permission."
fi
if rg --quiet 'npm (ci|test)|scripts/check\.sh|scripts/local-ci\.sh|docker-smoke|check-semantic-prompt-contract|npm run build' "$REVIEW_WORKFLOW"; then
  fail "review metadata events must not rerun technical CI."
fi
rg --fixed-strings --quiet 'git cat-file -e "$PR_BASE_SHA:.github/review-evidence-enforced"' "$REVIEW_WORKFLOW" ||
  fail "review enforcement must be selected from the trusted base marker."
rg --fixed-strings --quiet 'git show "$PR_BASE_SHA:scripts/$validator_name"' "$REVIEW_WORKFLOW" ||
  fail "enforced review validation must load scripts from the trusted base commit."
rg --fixed-strings --quiet 'Trusted base validator scripts/$validator_name is missing; enforcement fails closed.' "$REVIEW_WORKFLOW" ||
  fail "missing trusted base validators must fail closed without candidate fallback."
rg --fixed-strings --quiet 'validate-pr-review-evidence-event.mjs' "$REVIEW_WORKFLOW" ||
  fail "dual-snapshot event validation is not wired into the metadata workflow."
rg --fixed-strings --quiet 'gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER"' "$REVIEW_WORKFLOW" ||
  fail "review evidence must fetch current PR state separately from the event snapshot."
rg --fixed-strings --quiet 'commits/$HEAD_SHA/check-runs' "$REVIEW_WORKFLOW" ||
  fail "review evidence must inspect the exact-head technical aggregate."
rg --quiet '^Review-evidence validators must be loaded from the pull request' "$ROOT/.github/review-evidence-enforced" ||
  fail "trusted-base enforcement marker is missing."

while IFS= read -r uses_line; do
  action_ref="${uses_line#*@}"
  action_ref="${action_ref%% *}"
  [[ "$action_ref" =~ ^[0-9a-f]{40}$ ]] || fail "action is not pinned to a full SHA: $uses_line"
done < <(rg --no-filename '^[[:space:]]*uses:[[:space:]]+[^./][^@]+@' "$CI_WORKFLOW" "$REVIEW_WORKFLOW")

rg --quiet 'ARG NODE_IMAGE=node:24-alpine' "$ROOT/Dockerfile" || fail "Docker must default to Node 24 LTS."
rg --quiet 'RUN npm ci$' "$ROOT/Dockerfile" || fail "Docker build must use npm ci."
rg --quiet '"node": "\^22\.12\.0 \|\| \^24\.0\.0"' "$ROOT/package.json" || fail "supported Node lanes drifted."
rg --fixed-strings --quiet '<title>LLM Gateway · Admin</title>' "$ROOT/public/admin/index.html" ||
  fail "the admin UI title contract drifted."
rg --fixed-strings --quiet '<title>LLM Gateway · Admin</title>' "$ROOT/scripts/docker-smoke.sh" ||
  fail "the Docker smoke no longer checks the admin UI title contract."
rg --fixed-strings --quiet '/ui/semantic-prompt-contract.js' "$ROOT/scripts/docker-smoke.sh" ||
  fail "the Docker smoke no longer checks the pinned semantic adapter route."

for required_path in \
  .agents/skills/develop-llm-gateway/SKILL.md \
  .agents/skills/plan-llm-gateway-work-package/SKILL.md \
  .agents/skills/review-verify-merge-pr/SKILL.md \
  .codex/agents/work-package-planner.toml \
  .codex/agents/pr-reviewer.toml \
  .githooks/pre-commit \
  .githooks/pre-push \
  .github/pull_request_template.md \
  .github/review-evidence-enforced \
  .github/workflows/pr-review-evidence.yml \
  scripts/pr-evidence-lib.mjs \
  scripts/validate-pr-requirements.mjs \
  scripts/validate-pr-review-record.mjs \
  scripts/validate-pr-review-evidence-event.mjs \
  scripts/tests/pr-evidence-policy-test.mjs \
  scripts/tests/review-evidence-snapshot-test.mjs \
  scripts/validate-push-refs.sh; do
  [[ -f "$ROOT/$required_path" ]] || fail "$required_path is missing."
done

rg --fixed-strings --line-regexp --quiet '2. Read the relevant README sections and only the focused requirement sources for the changed surface: `ADMIN_FUNCTION_TEST_PLAN.md`, `ADMIN_UI_REQUIREMENTS.md`, `docs/OPEN_KEYBOARD_CLIENT.md`, or `docs/APFEL_PORTAL_POC.md`.' "$ROOT/.agents/skills/develop-llm-gateway/SKILL.md" ||
  fail "the implementation workflow focused-source routing is stale."
rg --fixed-strings --line-regexp --quiet '3. Select only directly relevant focused sources: `ADMIN_FUNCTION_TEST_PLAN.md`, `ADMIN_UI_REQUIREMENTS.md`, `docs/OPEN_KEYBOARD_CLIENT.md`, or `docs/APFEL_PORTAL_POC.md`.' "$ROOT/.agents/skills/plan-llm-gateway-work-package/SKILL.md" ||
  fail "the planning workflow focused-source routing is stale."

if rg --quiet 'TODO|\[TODO' "$ROOT/.agents" "$ROOT/.codex"; then
  fail "repository skills or agents still contain placeholders."
fi

rg --quiet '^sandbox_mode = "read-only"$' "$ROOT/.codex/agents/work-package-planner.toml" ||
  fail "work-package-planner must remain read-only."
rg --quiet '^sandbox_mode = "read-only"$' "$ROOT/.codex/agents/pr-reviewer.toml" ||
  fail "pr-reviewer must remain read-only."

for contract_file in \
  "$ROOT/AGENTS.md" \
  "$ROOT/docs/DEVELOPMENT_WORKFLOW.md" \
  "$ROOT/.github/BRANCH_PROTECTION_GUIDE.md" \
  "$ROOT/.github/CI-CD-SETUP.md" \
  "$ROOT/.agents/skills/develop-llm-gateway/SKILL.md" \
  "$ROOT/.agents/skills/review-verify-merge-pr/SKILL.md"; do
  rg --fixed-strings --quiet 'Required review evidence' "$contract_file" ||
    fail "$(basename "$contract_file") does not name the fixed review-evidence context."
done

rg --fixed-strings --quiet 'gh pr checks <number> --required' "$ROOT/.agents/skills/review-verify-merge-pr/SKILL.md" ||
  fail "readiness must inspect every required event family."
rg --fixed-strings --quiet 'project pr-reviewer (read-only, no inherited conversation)' "$ROOT/.codex/agents/pr-reviewer.toml" ||
  fail "the exact reviewer audit marker is missing."
rg --fixed-strings --quiet '| ID | Requirement and durable source | Observable acceptance criterion | Required proof type | Exact evidence | Status |' "$ROOT/.github/pull_request_template.md" ||
  fail "the PR requirement ledger contract is missing."
rg --fixed-strings --quiet -- '- Non-overridable blockers: pending' "$ROOT/.github/pull_request_template.md" ||
  fail "the PR template does not retain non-overridable blockers."

echo "Workflow policy test passed."
