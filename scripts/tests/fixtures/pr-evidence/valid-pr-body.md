## Summary

- Enforce exact-head review evidence.

## Requirements and proof

| ID | Requirement and durable source | Observable acceptance criterion | Required proof type | Exact evidence | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | User request: fail closed | Invalid or stale evidence remains UNVERIFIED | Adversarial validator tests | Exact-head policy tests passed | VERIFIED |
| R2 | AGENTS.md release lifecycle | The full release gate and Required checks pass on the exact head | Exact-head local and GitHub gate results | Full gate and Required checks passed for the current SHA | VERIFIED |

- Requirement count: 2
- Verified requirement count: 2
- Unverified in-scope requirements: none
- Authorized out-of-scope items: none

## Independent review

- Reviewer: project pr-reviewer (read-only, no inherited conversation)
- Exact reviewed head: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
- Review requirement coverage: 2/2
- Review unverified requirements: none
- Blocking findings: none
- Non-overridable blockers: none
- Mandatory exact-head gates: complete
- Independent review evidence: https://github.com/maneesh888/open-keyboard-llm-gateway/pull/123#pullrequestreview-1001
- Reviewer confidence: 100%
- Merge recommendation: automatic
- Residual proof limits (authorized out-of-scope only): no real backend behavior claimed

## Merge authorization

- Merge authorization route: automatic
- Human approval status: not-required
- Human-approved head: not-required
- Human approval evidence: not-required

## Exact head SHA

`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
