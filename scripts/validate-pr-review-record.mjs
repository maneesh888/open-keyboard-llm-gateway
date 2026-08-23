#!/usr/bin/env node
import {
  parsePullRequestEvidence,
  readJson,
  validateReviewRecord,
} from "./pr-evidence-lib.mjs";

try {
  const headSha = process.env.HEAD_SHA ?? "";
  const prUrl = process.env.PR_URL ?? "";
  const checkRuns = readJson(process.env.CHECK_RUNS_JSON_FILE ?? "", "GitHub check runs");
  const prEvidence = parsePullRequestEvidence({
    body: process.env.PR_BODY ?? "",
    headSha,
    prUrl,
    checkRuns,
  });
  const reviews = readJson(process.env.REVIEWS_JSON_FILE ?? "", "GitHub reviews");
  const eventReview = process.env.EVENT_REVIEW_JSON_FILE
    ? readJson(process.env.EVENT_REVIEW_JSON_FILE, "Event review snapshot")
    : null;
  validateReviewRecord({ prEvidence, headSha, prUrl, reviews, eventReview });
  console.log(`Independent review record passed for ${headSha}.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
