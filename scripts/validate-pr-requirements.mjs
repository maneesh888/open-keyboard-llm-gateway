#!/usr/bin/env node
import { parsePullRequestEvidence, readJson } from "./pr-evidence-lib.mjs";

try {
  const evidence = parsePullRequestEvidence({
    body: process.env.PR_BODY ?? "",
    headSha: process.env.HEAD_SHA ?? "",
    prUrl: process.env.PR_URL ?? "",
    checkRuns: readJson(process.env.CHECK_RUNS_JSON_FILE ?? "", "GitHub check runs"),
  });
  console.log(
    `Pull-request requirement evidence passed for ${process.env.HEAD_SHA} via ${evidence.authorizationRoute}.`,
  );
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
