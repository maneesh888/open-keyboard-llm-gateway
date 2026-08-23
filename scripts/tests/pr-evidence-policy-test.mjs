#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HUMAN_AUTHORIZATION_EVIDENCE,
  parsePullRequestEvidence,
  validateReviewRecord,
} from "../pr-evidence-lib.mjs";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(testRoot, "fixtures", "pr-evidence");
const headSha = "a".repeat(40);
const staleSha = "b".repeat(40);
const prUrl = "https://github.com/maneesh888/open-keyboard-llm-gateway/pull/123";
const bodyFixture = fs.readFileSync(path.join(fixtureRoot, "valid-pr-body.md"), "utf8");
const reviewsFixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "valid-reviews.json"), "utf8"));
const checkRuns = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "valid-check-runs.json"), "utf8"));

function clone(value) {
  return structuredClone(value);
}

function parse(body = bodyFixture, checks = checkRuns) {
  return parsePullRequestEvidence({ body, headSha, prUrl, checkRuns: checks });
}

function validate(body = bodyFixture, reviews = reviewsFixture) {
  const prEvidence = parse(body);
  validateReviewRecord({ prEvidence, headSha, prUrl, reviews });
}

function rejects(label, operation, pattern) {
  assert.throws(operation, pattern, label);
}

validate();

rejects(
  "missing requirement rows fail closed",
  () => parse(bodyFixture.replace(/^\| R2 .*\n/mu, "")),
  /Requirement IDs|count does not match/u,
);
rejects(
  "duplicate requirement IDs fail closed",
  () => parse(bodyFixture.replace("| R2 | AGENTS.md", "| R1 | AGENTS.md")),
  /Requirement IDs/u,
);
rejects(
  "nonsequential requirement IDs fail closed",
  () => parse(bodyFixture.replace("| R2 | AGENTS.md", "| R3 | AGENTS.md")),
  /Requirement IDs/u,
);
rejects(
  "malformed requirement rows fail closed",
  () => parse(bodyFixture.replace("| Exact-head policy tests passed | VERIFIED |", "| Exact-head policy tests passed |")),
  /malformed evidence row/u,
);
rejects(
  "incorrect requirement counts fail closed",
  () => parse(bodyFixture.replace("- Requirement count: 2", "- Requirement count: 3")),
  /Requirement IDs|count does not match/u,
);
rejects(
  "incorrect status lists fail closed",
  () => parse(bodyFixture.replace("- Unverified in-scope requirements: none", "- Unverified in-scope requirements: R2")),
  /does not match/u,
);
rejects(
  "invalid ledger statuses fail closed",
  () => parse(bodyFixture.replace("| Exact-head policy tests passed | VERIFIED |", "| Exact-head policy tests passed | COMPLETE |")),
  /invalid status/u,
);
rejects(
  "stale reviewed heads fail closed",
  () => parse(bodyFixture.replace(`- Exact reviewed head: ${headSha}`, `- Exact reviewed head: ${staleSha}`)),
  /stale or mismatched/u,
);
rejects(
  "missing or unrelated review links fail closed",
  () => parse(bodyFixture.replace(prUrl, "https://github.com/maneesh888/open-keyboard-llm-gateway/pull/999")),
  /durable review submission/u,
);

{
  const reviews = clone(reviewsFixture);
  reviews[0].body = reviews[0].body.replace(/^\| R2 .*$/mu, "");
  rejects("omitted independent-review rows fail closed", () => validate(bodyFixture, reviews), /omitted or added/u);
}
{
  const reviews = clone(reviewsFixture);
  reviews[0].body = reviews[0].body.replace(
    "Invalid or stale evidence remains UNVERIFIED",
    "Stale evidence is rejected",
  );
  rejects("narrowed acceptance criteria fail closed", () => validate(bodyFixture, reviews), /omitted or narrowed/u);
}
{
  const reviews = clone(reviewsFixture);
  reviews[0].body = reviews[0].body.replace(
    "Adversarial validator tests",
    "Source inspection",
  );
  rejects("substituted proof types fail closed", () => validate(bodyFixture, reviews), /proof type was substituted/u);
}
{
  const reviews = clone(reviewsFixture);
  reviews[0].body = reviews[0].body.replace(
    "| R2 | The full release gate and Required checks pass on the exact head | Exact-head local and GitHub gate results | Local full gate and GitHub Required checks | VERIFIED |",
    "| R2 | The full release gate and Required checks pass on the exact head | Exact-head local and GitHub gate results | Local full gate and GitHub Required checks | UNVERIFIED |",
  );
  rejects("review and ledger status disagreement fails closed", () => validate(bodyFixture, reviews), /statuses disagree/u);
}
for (const state of ["APPROVED", "CHANGES_REQUESTED"]) {
  const reviews = clone(reviewsFixture);
  reviews[0].state = state;
  rejects(
    `${state} project-reviewer reports fail closed`,
    () => validate(bodyFixture, reviews),
    state === "APPROVED" ? /must be COMMENTED/u : /non-overridable blocker/u,
  );
}
{
  const reviews = clone(reviewsFixture);
  reviews.push({
    id: 1002,
    commit_id: headSha,
    state: "CHANGES_REQUESTED",
    submitted_at: "2026-08-23T12:05:00Z",
    html_url: `${prUrl}#pullrequestreview-1002`,
    body: "Blocking review from another reviewer.",
  });
  rejects(
    "an unrelated current-head requested-changes review blocks every authorization route",
    () => validate(bodyFixture, reviews),
    /non-overridable blocker/u,
  );
}
{
  const reviews = clone(reviewsFixture);
  const newer = clone(reviews[0]);
  newer.id = 1002;
  newer.html_url = `${prUrl}#pullrequestreview-1002`;
  newer.submitted_at = "2026-08-23T12:05:00Z";
  newer.body = newer.body
    .replace("- Review unverified requirements: none", "- Review unverified requirements: R2")
    .replace("- Blocking findings: none", "- Blocking findings: R2 mandatory proof is incomplete")
    .replace("- Reviewer confidence: 100%", "- Reviewer confidence: below 100%")
    .replace("- Merge recommendation: automatic", "- Merge recommendation: human-review-required")
    .replace("- Conclusion: requirements-complete", "- Conclusion: human-review-required")
    .replace("| VERIFIED | Both mandatory gates passed on this SHA |", "| UNVERIFIED | Mandatory proof is incomplete | ");
  reviews.push(newer);
  rejects("a newer blocking reviewer report supersedes an older positive report", () => validate(bodyFixture, reviews), /newest same-head/u);
}

rejects(
  "automatic authorization below 100% fails closed",
  () => parse(bodyFixture.replace("- Reviewer confidence: 100%", "- Reviewer confidence: below 100%")),
  /exactly 100%/u,
);

function humanBody() {
  return bodyFixture
    .replace("| Full gate and Required checks passed for the current SHA | VERIFIED |", "| Required release proof remains unavailable | UNVERIFIED |")
    .replace("- Verified requirement count: 2", "- Verified requirement count: 1")
    .replace("- Unverified in-scope requirements: none", "- Unverified in-scope requirements: R2")
    .replace("- Review unverified requirements: none", "- Review unverified requirements: R2")
    .replace("- Blocking findings: none", "- Blocking findings: R2 exact release proof remains unavailable")
    .replace("- Reviewer confidence: 100%", "- Reviewer confidence: below 100%")
    .replace("- Merge recommendation: automatic", "- Merge recommendation: human-review-required")
    .replace("- Merge authorization route: automatic", "- Merge authorization route: human")
    .replace("- Human approval status: not-required", "- Human approval status: approved")
    .replace("- Human-approved head: not-required", `- Human-approved head: ${headSha}`)
    .replace("- Human approval evidence: not-required", `- Human approval evidence: ${HUMAN_AUTHORIZATION_EVIDENCE}`);
}

function humanReviews() {
  const reviews = clone(reviewsFixture);
  reviews[0].body = reviews[0].body
    .replace("- Review unverified requirements: none", "- Review unverified requirements: R2")
    .replace("- Blocking findings: none", "- Blocking findings: R2 exact release proof remains unavailable")
    .replace("- Reviewer confidence: 100%", "- Reviewer confidence: below 100%")
    .replace("- Merge recommendation: automatic", "- Merge recommendation: human-review-required")
    .replace("- Conclusion: requirements-complete", "- Conclusion: human-review-required")
    .replace("| R2 | The full release gate and Required checks pass on the exact head | Exact-head local and GitHub gate results | Local full gate and GitHub Required checks | VERIFIED | Both mandatory gates passed on this SHA |", "| R2 | The full release gate and Required checks pass on the exact head | Exact-head local and GitHub gate results | Required release proof remains unavailable | UNVERIFIED | The proof gap is retained for owner decision | ");
  return reviews;
}

validate(humanBody(), humanReviews());
rejects(
  "human authorization missing the exact approved SHA fails closed",
  () => parse(humanBody().replace(`- Human-approved head: ${headSha}`, `- Human-approved head: ${staleSha}`)),
  /current exact approved SHA/u,
);
rejects(
  "human authorization cannot override security or another non-overridable blocker",
  () => parse(humanBody().replace("- Non-overridable blockers: none", "- Non-overridable blockers: authentication bypass")),
  /No authorization route may override/u,
);

{
  const failedChecks = clone(checkRuns);
  failedChecks.check_runs[0].conclusion = "failure";
  rejects("failed mandatory technical checks fail both routes", () => parse(humanBody(), failedChecks), /not successful/u);
}
{
  const headlessChecks = clone(checkRuns);
  delete headlessChecks.check_runs[0].head_sha;
  rejects(
    "mandatory technical checks without an inspectable head binding fail closed",
    () => parse(bodyFixture, headlessChecks),
    /lacks an inspectable exact-head binding/u,
  );
}

console.log("PR evidence adversarial policy tests passed.");
