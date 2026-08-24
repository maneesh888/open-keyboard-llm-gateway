# Required Review Evidence Activation

This document is the intentionally small Stage 2 change used to prove the pull-request review-evidence workflow after its validators exist on `main`.

For this activation PR:

- `.github/workflows/pr-review-evidence.yml` must report validator source `trusted-base` for the exact PR head;
- both the pull-request body/state event family and the labeled non-approval `COMMENTED` review-event family must pass `Required review evidence`;
- the unchanged technical aggregate `Required checks` and the exact-head local full gate must pass;
- the newest same-head project-reviewer report must be retained as a `COMMENTED` review and linked from the PR ledger; and
- `gh pr checks <number> --required` must succeed before readiness and merge.

Only after that live exact-head proof may `main` protection add `Required review evidence` alongside `Required checks`. The protection update must preserve strict branch updating, conversation resolution, administrator enforcement, force-push blocking, and deletion blocking.

This activation change does not alter gateway runtime behavior and does not prove a real Ollama, Apfel, or model-specific request. No credentialed GitHub workflow, deployment, or image publication is introduced.
