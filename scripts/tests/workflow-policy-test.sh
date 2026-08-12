#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CI_WORKFLOW="$ROOT/.github/workflows/ci.yml"
SEMANTIC_CONTRACT_CHECK="$ROOT/scripts/check-semantic-prompt-contract.sh"
SEMANTIC_CONTRACT_ROOT="$ROOT/Vendor/semantic-prompt-contract"

fail() {
  echo "workflow policy test failed: $1" >&2
  exit 1
}

[[ -f "$CI_WORKFLOW" ]] || fail ".github/workflows/ci.yml is missing."
[[ -f "$ROOT/package-lock.json" ]] || fail "package-lock.json is missing."
[[ -x "$SEMANTIC_CONTRACT_CHECK" ]] || fail "semantic contract check is missing or not executable."
[[ -f "$SEMANTIC_CONTRACT_ROOT/contracts/manifest.json" ]] || fail "pinned semantic contract is missing."
git -C "$ROOT" check-ignore --quiet package-lock.json && fail "package-lock.json is ignored."

rg --quiet '^  pull_request:' "$CI_WORKFLOW" || fail "CI must run for pull requests."
rg --quiet '^  push:' "$CI_WORKFLOW" || fail "CI must run for pushes."
rg --quiet '^  workflow_dispatch:' "$CI_WORKFLOW" || fail "CI must support manual dispatch."
rg --quiet '^  workflow_call:' "$CI_WORKFLOW" || fail "CI must be reusable."
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

while IFS= read -r uses_line; do
  action_ref="${uses_line#*@}"
  action_ref="${action_ref%% *}"
  [[ "$action_ref" =~ ^[0-9a-f]{40}$ ]] || fail "action is not pinned to a full SHA: $uses_line"
done < <(rg --no-filename '^[[:space:]]*uses:[[:space:]]+[^./][^@]+@' "$CI_WORKFLOW")

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
  scripts/validate-push-refs.sh; do
  [[ -f "$ROOT/$required_path" ]] || fail "$required_path is missing."
done

[[ -f "$ROOT/docs/CODEX_PROVIDER_PLAN.md" ]] || fail "docs/CODEX_PROVIDER_PLAN.md is missing."
rg --fixed-strings --line-regexp --quiet '2. Read the relevant README sections and only the focused requirement sources for the changed surface: `ADMIN_FUNCTION_TEST_PLAN.md`, `ADMIN_UI_REQUIREMENTS.md`, `docs/OPEN_KEYBOARD_CLIENT.md`, `docs/APFEL_PORTAL_POC.md`, or `docs/CODEX_PROVIDER_PLAN.md`. Read `docs/CODEX_PROVIDER_PLAN.md` for any Codex-provider implementation, hardening, verification, or deployment task.' "$ROOT/.agents/skills/develop-llm-gateway/SKILL.md" ||
  fail "the implementation workflow no longer routes Codex-provider work through its plan."
rg --fixed-strings --line-regexp --quiet '3. Select only directly relevant focused sources: `ADMIN_FUNCTION_TEST_PLAN.md`, `ADMIN_UI_REQUIREMENTS.md`, `docs/OPEN_KEYBOARD_CLIENT.md`, `docs/APFEL_PORTAL_POC.md`, or `docs/CODEX_PROVIDER_PLAN.md`. Use `docs/CODEX_PROVIDER_PLAN.md` for Codex-provider implementation, hardening, verification, rollout, or deployment planning.' "$ROOT/.agents/skills/plan-llm-gateway-work-package/SKILL.md" ||
  fail "the planning workflow no longer treats the Codex-provider plan as a focused source."

if rg --quiet 'TODO|\[TODO' "$ROOT/.agents" "$ROOT/.codex"; then
  fail "repository skills or agents still contain placeholders."
fi

rg --quiet '^sandbox_mode = "read-only"$' "$ROOT/.codex/agents/work-package-planner.toml" ||
  fail "work-package-planner must remain read-only."
rg --quiet '^sandbox_mode = "read-only"$' "$ROOT/.codex/agents/pr-reviewer.toml" ||
  fail "pr-reviewer must remain read-only."

echo "Workflow policy test passed."
