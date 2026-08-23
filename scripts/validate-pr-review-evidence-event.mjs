#!/usr/bin/env node
import { readJson, validateEvidenceSnapshots } from "./pr-evidence-lib.mjs";

try {
  const result = validateEvidenceSnapshots({
    eventName: process.env.EVENT_NAME ?? "",
    eventPayload: readJson(process.env.EVENT_JSON_FILE ?? "", "GitHub event snapshot"),
    currentPr: readJson(process.env.CURRENT_PR_JSON_FILE ?? "", "Current pull request"),
    reviews: readJson(process.env.REVIEWS_JSON_FILE ?? "", "GitHub reviews"),
    checkRuns: readJson(process.env.CHECK_RUNS_JSON_FILE ?? "", "GitHub check runs"),
  });
  console.log(`Immutable event and current GitHub review evidence passed for ${result.headSha}.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
