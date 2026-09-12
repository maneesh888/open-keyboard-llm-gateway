#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
npm run build
node scripts/tests/browser-failure-redaction.mjs
"$ROOT/node_modules/.bin/playwright" test
printf '%s\n' 'Browser/API E2E passed with disposable fixture upstreams; no live inference or observed usability claim.'
