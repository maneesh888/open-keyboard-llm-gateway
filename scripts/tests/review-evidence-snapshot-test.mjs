#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvidenceSnapshots } from "../pr-evidence-lib.mjs";

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(testRoot, "fixtures", "pr-evidence");
const body = fs.readFileSync(path.join(fixtureRoot, "valid-pr-body.md"), "utf8");
const reviews = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "valid-reviews.json"), "utf8"));
const checkRuns = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "valid-check-runs.json"), "utf8"));
const eventFixture = JSON.parse(
  fs.readFileSync(path.join(fixtureRoot, "valid-event-pull-request.json"), "utf8"),
);
const currentFixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "valid-current-pr.json"), "utf8"));
const headSha = "a".repeat(40);
const staleSha = "b".repeat(40);
const prUrl = "https://github.com/maneesh888/open-keyboard-llm-gateway/pull/123";

function event(bodyValue = body) {
  const value = structuredClone(eventFixture);
  value.pull_request.body = bodyValue;
  return value;
}

function current(bodyValue = body, sha = headSha) {
  const value = structuredClone(currentFixture);
  value.body = bodyValue;
  value.head.sha = sha;
  return value;
}

function validate(eventPayload = event(), currentPr = current(), eventName = "pull_request") {
  return validateEvidenceSnapshots({ eventName, eventPayload, currentPr, reviews, checkRuns });
}

validate();

const invalidBody = body.replace(/^\| R2 .*\n/mu, "");
assert.throws(
  () => validate(event(invalidBody), current()),
  /Immutable event snapshot invalid/u,
  "invalid event snapshots must not be repaired by restored current state",
);
assert.throws(
  () => validate(event(), current(invalidBody)),
  /Current GitHub snapshot invalid/u,
  "valid events must not hide invalid current state",
);
assert.throws(
  () => validate(event(), current(body, staleSha)),
  /current pull-request head changed/u,
  "a changed current head must invalidate all evidence",
);

const triggerBody =
  `Review-evidence revalidation trigger for exact head ${headSha}. ` +
  "This COMMENTED submission is not an approval, an independent-review report, or merge authorization.";
const reviewEvent = event();
reviewEvent.action = "submitted";
reviewEvent.review = {
  id: 2001,
  commit_id: headSha,
  state: "COMMENTED",
  submitted_at: "2026-08-23T12:10:00Z",
  html_url: `${prUrl}#pullrequestreview-2001`,
  body: triggerBody,
};
validate(reviewEvent, current(), "pull_request_review");

for (const state of ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]) {
  const invalidReviewEvent = structuredClone(reviewEvent);
  invalidReviewEvent.review.state = state;
  assert.throws(
    () => validate(invalidReviewEvent, current(), "pull_request_review"),
    /must be COMMENTED/u,
    `${state} review events must fail closed`,
  );
}

const unrelatedReviewEvent = structuredClone(reviewEvent);
unrelatedReviewEvent.review.body = "Looks good to me.";
assert.throws(
  () => validate(unrelatedReviewEvent, current(), "pull_request_review"),
  /exact clearly labeled/u,
  "unrelated review comments must not spoof revalidation",
);

console.log("Review-evidence dual-snapshot tests passed.");
