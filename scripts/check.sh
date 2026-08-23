#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:---full}"

usage() {
  cat <<'EOF'
Usage: ./scripts/check.sh [--hygiene|--quick|--full]

  --hygiene  Validate tooling, shell/YAML syntax, policies, secrets, and whitespace.
  --quick    Run hygiene, all Vitest tests, and the TypeScript build.
  --full     Run quick checks plus Compose validation and a Docker runtime smoke.
             This is the default and the release/pre-push gate.
EOF
}

validate_yaml() {
  local yaml_file

  while IFS= read -r -d '' yaml_file; do
    [[ -f "$ROOT/$yaml_file" ]] || continue
    ruby -e 'require "yaml"; YAML.parse_file(ARGV.fetch(0))' "$ROOT/$yaml_file"
  done < <(
    git -C "$ROOT" ls-files --cached --others --exclude-standard -z -- '*.yml' '*.yaml'
  )
}

validate_shell() {
  local shell_file

  while IFS= read -r -d '' shell_file; do
    [[ -f "$ROOT/$shell_file" ]] || continue
    bash -n "$ROOT/$shell_file"
  done < <(
    git -C "$ROOT" ls-files --cached --others --exclude-standard -z -- '*.sh' '.githooks/*'
  )
}

validate_whitespace() {
  local temporary_directory
  local temporary_index
  local temporary_objects
  local repository_objects

  git -C "$ROOT" diff --check
  git -C "$ROOT" diff --cached --check

  temporary_directory="$(mktemp -d)"
  temporary_index="$temporary_directory/index"
  temporary_objects="$temporary_directory/objects"
  repository_objects="$(git -C "$ROOT" rev-parse --git-path objects)"
  mkdir -p "$temporary_objects"

  cleanup_temporary_index() {
    rm -rf -- "$temporary_directory"
  }
  trap cleanup_temporary_index EXIT

  GIT_INDEX_FILE="$temporary_index" \
    GIT_OBJECT_DIRECTORY="$temporary_objects" \
    GIT_ALTERNATE_OBJECT_DIRECTORIES="$repository_objects" \
    git -C "$ROOT" read-tree HEAD
  GIT_INDEX_FILE="$temporary_index" \
    GIT_OBJECT_DIRECTORY="$temporary_objects" \
    GIT_ALTERNATE_OBJECT_DIRECTORIES="$repository_objects" \
    git -C "$ROOT" add --intent-to-add .
  GIT_INDEX_FILE="$temporary_index" \
    GIT_OBJECT_DIRECTORY="$temporary_objects" \
    GIT_ALTERNATE_OBJECT_DIRECTORIES="$repository_objects" \
    git -C "$ROOT" diff --check

  cleanup_temporary_index
  trap - EXIT
}

run_hygiene() {
  local environment_mode="${1:---hygiene}"

  "$ROOT/scripts/check-environment.sh" "$environment_mode"
  validate_shell
  validate_yaml
  npm run secret-scan
  "$ROOT/scripts/tests/secret-scan-test.sh"
  "$ROOT/scripts/tests/push-ref-policy-test.sh"
  node "$ROOT/scripts/tests/pr-evidence-policy-test.mjs"
  node "$ROOT/scripts/tests/review-evidence-snapshot-test.mjs"
  "$ROOT/scripts/tests/workflow-policy-test.sh"
  validate_whitespace
  echo "LLM Gateway hygiene checks passed."
}

run_quick() {
  run_hygiene --quick
  "$ROOT/scripts/check-semantic-prompt-contract.sh"
  "$ROOT/scripts/local-ci.sh" --quick
  echo "LLM Gateway quick checks passed."
}

run_full() {
  run_hygiene --full
  "$ROOT/scripts/check-semantic-prompt-contract.sh"
  "$ROOT/scripts/local-ci.sh" --quick
  "$ROOT/scripts/local-ci.sh" --docker
  echo "LLM Gateway full checks passed."
}

case "$MODE" in
  --hygiene|hygiene)
    run_hygiene --hygiene
    ;;
  --quick|quick)
    run_quick
    ;;
  --full|full)
    run_full
    ;;
  --help|-h|help)
    usage
    ;;
  *)
    echo "Unknown check mode: $MODE" >&2
    usage >&2
    exit 2
    ;;
esac
