import fs from "node:fs";

export const PROJECT_REVIEWER_MARKER =
  "project pr-reviewer (read-only, no inherited conversation)";
export const HUMAN_AUTHORIZATION_EVIDENCE =
  "explicit repository-owner approval for this exact head in the active Codex task";
export const REQUIRED_TECHNICAL_CONTEXT = "Required checks";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REQUIREMENT_ID_PATTERN = /^R[1-9][0-9]*$/;
const PLACEHOLDER_PATTERN = /^(?:pending|unknown|unverified|not run|none|n\/a)$/i;

export class EvidenceError extends Error {
  constructor(message) {
    super(message);
    this.name = "EvidenceError";
  }
}

function fail(message) {
  throw new EvidenceError(message);
}

function assertExactHead(headSha) {
  if (!SHA_PATTERN.test(headSha)) {
    fail("Review evidence requires the exact lowercase 40-character pull-request head SHA.");
  }
}

function exactField(body, label, source) {
  const prefix = `- ${label}: `;
  const values = body
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
  if (values.length !== 1) {
    fail(`${source} must contain exactly one '${label}' field.`);
  }
  if (values[0] === "" || values[0].toLowerCase() === "pending") {
    fail(`${source} field '${label}' cannot be empty or pending.`);
  }
  return values[0];
}

function parseCount(value, label, allowZero = true) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    fail(`${label} must be a non-negative integer.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!allowZero && parsed === 0) {
    fail(`${label} must be at least one.`);
  }
  return parsed;
}

function parseRequirementIds(value, label) {
  if (value === "none") return [];
  const ids = value.split(",").map((id) => id.trim());
  if (
    ids.length === 0 ||
    ids.some((id) => !REQUIREMENT_ID_PATTERN.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    fail(`${label} must be 'none' or a unique comma-separated requirement ID list.`);
  }
  return ids;
}

function splitTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function tableRows(body, expectedHeader, source) {
  const lines = body.split(/\r?\n/u);
  const headerIndexes = lines
    .map((line, index) => ({ cells: splitTableRow(line), index }))
    .filter(({ cells }) => cells && cells.join("\u0000") === expectedHeader.join("\u0000"))
    .map(({ index }) => index);
  if (headerIndexes.length !== 1) {
    fail(`${source} must contain exactly one ${expectedHeader.length}-column evidence table.`);
  }
  const headerIndex = headerIndexes[0];
  const separator = splitTableRow(lines[headerIndex + 1] ?? "");
  if (
    !separator ||
    separator.length !== expectedHeader.length ||
    separator.some((cell) => !/^:?-{3,}:?$/u.test(cell))
  ) {
    fail(`${source} evidence table must have a valid Markdown separator row.`);
  }

  const rows = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") break;
    const cells = splitTableRow(line);
    if (!cells || cells.length !== expectedHeader.length) {
      fail(`${source} contains a malformed evidence row.`);
    }
    if (!REQUIREMENT_ID_PATTERN.test(cells[0])) {
      fail(`${source} contains an invalid requirement ID '${cells[0]}'.`);
    }
    rows.push(cells);
  }
  if (rows.length === 0) fail(`${source} must contain at least one requirement row.`);
  return rows;
}

function sameList(actual, expected, label) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail(`${label} does not match the requirement table.`);
  }
}

function normalizeCheckRuns(checkRuns) {
  if (Array.isArray(checkRuns)) return checkRuns;
  if (checkRuns && Array.isArray(checkRuns.check_runs)) return checkRuns.check_runs;
  fail("Fetched GitHub check runs must contain a check_runs array.");
}

export function validateRequiredTechnicalCheck(checkRuns, headSha) {
  const candidates = normalizeCheckRuns(checkRuns).filter(
    (check) => check && check.name === REQUIRED_TECHNICAL_CONTEXT,
  );
  if (candidates.length === 0) {
    fail(`The exact head has no '${REQUIRED_TECHNICAL_CONTEXT}' check run.`);
  }
  const newest = candidates.toSorted((left, right) => {
    const leftTime = Date.parse(left.completed_at ?? left.started_at ?? left.created_at ?? 0) || 0;
    const rightTime = Date.parse(right.completed_at ?? right.started_at ?? right.created_at ?? 0) || 0;
    return rightTime - leftTime || Number(right.id ?? 0) - Number(left.id ?? 0);
  })[0];
  if (!SHA_PATTERN.test(newest.head_sha ?? "")) {
    fail(`The '${REQUIRED_TECHNICAL_CONTEXT}' check run lacks an inspectable exact-head binding.`);
  }
  if (newest.head_sha !== headSha) {
    fail(`The '${REQUIRED_TECHNICAL_CONTEXT}' check run targets a different head.`);
  }
  if (newest.status !== "completed" || newest.conclusion !== "success") {
    fail(`The newest exact-head '${REQUIRED_TECHNICAL_CONTEXT}' check run is not successful.`);
  }
}

export function parsePullRequestEvidence({ body, headSha, prUrl, checkRuns }) {
  assertExactHead(headSha);
  if (typeof body !== "string" || body === "" || typeof prUrl !== "string" || prUrl === "") {
    fail("Pull-request evidence requires a body and durable pull-request URL.");
  }
  validateRequiredTechnicalCheck(checkRuns, headSha);

  const requirementCount = parseCount(
    exactField(body, "Requirement count", "PR body"),
    "Requirement count",
    false,
  );
  const verifiedCount = parseCount(
    exactField(body, "Verified requirement count", "PR body"),
    "Verified requirement count",
  );
  const unverifiedIds = parseRequirementIds(
    exactField(body, "Unverified in-scope requirements", "PR body"),
    "Unverified in-scope requirements",
  );
  const authorizedOutOfScope = exactField(body, "Authorized out-of-scope items", "PR body");

  const rawRows = tableRows(
    body,
    ["ID", "Requirement and durable source", "Observable acceptance criterion", "Required proof type", "Exact evidence", "Status"],
    "PR body",
  );
  const rows = rawRows.map(([id, requirement, acceptance, proof, evidence, status]) => {
    if ([requirement, acceptance, proof, evidence].some((value) => value === "")) {
      fail(`${id} must provide its durable source, acceptance criterion, proof type, and exact evidence.`);
    }
    if (!new Set(["VERIFIED", "UNVERIFIED"]).has(status)) {
      fail(`${id} has invalid status '${status}'.`);
    }
    if (status === "VERIFIED" && PLACEHOLDER_PATTERN.test(evidence)) {
      fail(`${id} cannot be VERIFIED with placeholder or unavailable evidence.`);
    }
    return { id, requirement, acceptance, proof, evidence, status };
  });
  const expectedIds = Array.from({ length: requirementCount }, (_, index) => `R${index + 1}`);
  sameList(
    rows.map((row) => row.id),
    expectedIds,
    "Requirement IDs",
  );
  if (rows.length !== requirementCount) fail("Requirement count does not match the ledger.");
  const verifiedRows = rows.filter((row) => row.status === "VERIFIED");
  const unverifiedRows = rows.filter((row) => row.status === "UNVERIFIED");
  if (verifiedRows.length !== verifiedCount) {
    fail("Verified requirement count does not match the ledger.");
  }
  sameList(
    unverifiedIds,
    unverifiedRows.map((row) => row.id),
    "Unverified in-scope requirements",
  );
  if (authorizedOutOfScope !== "none" && !authorizedOutOfScope.startsWith("explicitly authorized:")) {
    fail("Authorized out-of-scope items must be 'none' or begin with 'explicitly authorized:'.");
  }

  const reviewedHead = exactField(body, "Exact reviewed head", "PR body");
  if (reviewedHead !== headSha) fail("The PR body's exact reviewed head is stale or mismatched.");
  const reviewCoverage = exactField(body, "Review requirement coverage", "PR body");
  if (reviewCoverage !== `${requirementCount}/${requirementCount}`) {
    fail(`Review requirement coverage must be ${requirementCount}/${requirementCount}.`);
  }
  const reviewUnverifiedIds = parseRequirementIds(
    exactField(body, "Review unverified requirements", "PR body"),
    "Review unverified requirements",
  );
  sameList(
    reviewUnverifiedIds,
    unverifiedRows.map((row) => row.id),
    "Review unverified requirements",
  );

  const blockingFindings = exactField(body, "Blocking findings", "PR body");
  const nonOverridableBlockers = exactField(body, "Non-overridable blockers", "PR body");
  const mandatoryGates = exactField(body, "Mandatory exact-head gates", "PR body");
  const reviewEvidence = exactField(body, "Independent review evidence", "PR body");
  const reviewPrefix = `${prUrl}#pullrequestreview-`;
  if (!reviewEvidence.startsWith(reviewPrefix) || !/^[1-9][0-9]*$/u.test(reviewEvidence.slice(reviewPrefix.length))) {
    fail("Independent review evidence must link one durable review submission on this pull request.");
  }
  const reviewId = Number.parseInt(reviewEvidence.slice(reviewPrefix.length), 10);
  const reviewerConfidence = exactField(body, "Reviewer confidence", "PR body");
  const mergeRecommendation = exactField(body, "Merge recommendation", "PR body");
  const authorizationRoute = exactField(body, "Merge authorization route", "PR body");
  const humanStatus = exactField(body, "Human approval status", "PR body");
  const humanHead = exactField(body, "Human-approved head", "PR body");
  const humanEvidence = exactField(body, "Human approval evidence", "PR body");

  if (mandatoryGates !== "complete") {
    fail("Mandatory exact-head gates must be complete for either authorization route.");
  }
  if (nonOverridableBlockers !== "none") {
    fail("No authorization route may override a non-overridable blocker.");
  }
  if (authorizationRoute === "automatic") {
    if (unverifiedRows.length !== 0) fail("Automatic authorization requires every requirement VERIFIED.");
    if (blockingFindings !== "none") fail("Automatic authorization requires no blocker or material uncertainty.");
    if (reviewerConfidence !== "100%") fail("Automatic authorization requires reviewer confidence exactly 100%.");
    if (mergeRecommendation !== "automatic") fail("Automatic authorization requires an automatic recommendation.");
    if (humanStatus !== "not-required" || humanHead !== "not-required" || humanEvidence !== "not-required") {
      fail("Automatic authorization must not claim human approval.");
    }
  } else if (authorizationRoute === "human") {
    if (unverifiedRows.length === 0) fail("Human authorization must retain at least one UNVERIFIED row.");
    if (blockingFindings === "none") fail("Human authorization must retain every accepted proof gap.");
    if (reviewerConfidence !== "below 100%" || mergeRecommendation !== "human-review-required") {
      fail("Human authorization requires below-100% reviewer confidence and human-review-required recommendation.");
    }
    if (humanStatus !== "approved") fail("Human approval status must be 'approved'.");
    if (humanHead !== headSha) fail("Human authorization is missing the current exact approved SHA.");
    if (humanEvidence !== HUMAN_AUTHORIZATION_EVIDENCE) {
      fail("Human authorization evidence is missing or was inferred instead of explicitly supplied.");
    }
  } else {
    fail("Merge authorization route must be 'automatic' or 'human'.");
  }

  const exactHeadLines = body.split(/\r?\n/u).filter((line) => line.trim() === `\`${headSha}\``);
  if (exactHeadLines.length !== 1) {
    fail("The Exact head SHA section must contain the current full SHA exactly once.");
  }

  return {
    authorizationRoute,
    blockingFindings,
    mandatoryGates,
    mergeRecommendation,
    nonOverridableBlockers,
    requirementCount,
    reviewEvidence,
    reviewId,
    reviewerConfidence,
    reviewUnverifiedIds,
    rows,
    unverifiedIds,
  };
}

function reviewTimestamp(review) {
  return Date.parse(review.submitted_at ?? review.updated_at ?? 0) || Number(review.id ?? 0);
}

function isProjectReviewerReport(review) {
  return typeof review?.body === "string" && review.body.includes(`- Reviewer: ${PROJECT_REVIEWER_MARKER}`);
}

function overlayEventReview(reviews, eventReview) {
  if (!eventReview) return reviews;
  if (!Number.isInteger(eventReview.id)) fail("The event review snapshot lacks a numeric review ID.");
  return [...reviews.filter((review) => review?.id !== eventReview.id), eventReview];
}

export function validateReviewRecord({ prEvidence, headSha, prUrl, reviews, eventReview = null }) {
  assertExactHead(headSha);
  if (!Array.isArray(reviews)) fail("Fetched GitHub reviews must be a JSON array.");
  const effectiveReviews = overlayEventReview(reviews, eventReview);
  const currentHeadRequestedChanges = effectiveReviews.filter(
    (review) =>
      review?.commit_id === headSha && String(review.state ?? "").toUpperCase() === "CHANGES_REQUESTED",
  );
  if (currentHeadRequestedChanges.length !== 0) {
    fail("A current-head CHANGES_REQUESTED review is a non-overridable blocker.");
  }
  const reports = effectiveReviews.filter(isProjectReviewerReport);
  for (const report of reports) {
    const claimsCurrentHead =
      report.commit_id === headSha || report.body.includes(`- Exact reviewed head: ${headSha}`);
    if (!claimsCurrentHead) continue;
    if (report.commit_id !== headSha) fail("A same-head project-reviewer report has a stale commit binding.");
    if (String(report.state ?? "").toUpperCase() !== "COMMENTED") {
      fail("Project-reviewer reports must be COMMENTED reviews, never APPROVED or CHANGES_REQUESTED.");
    }
  }

  const sameHeadReports = reports.filter((report) => report.commit_id === headSha);
  if (sameHeadReports.length === 0) fail("No same-head project-reviewer COMMENTED report was found.");
  const newestReport = sameHeadReports.toSorted(
    (left, right) => reviewTimestamp(right) - reviewTimestamp(left) || Number(right.id) - Number(left.id),
  )[0];
  if (newestReport.id !== prEvidence.reviewId) {
    fail("The PR must link the newest same-head project-reviewer report; a newer report supersedes it.");
  }
  const linked = effectiveReviews.find((review) => review?.id === prEvidence.reviewId);
  if (!linked) fail("The linked independent review submission was not found.");
  if (linked.commit_id !== headSha) fail("The linked independent review targets a stale or mismatched head.");
  if (String(linked.state ?? "").toUpperCase() !== "COMMENTED") {
    fail("The linked project-reviewer report must be a COMMENTED review.");
  }
  if (linked.html_url !== prEvidence.reviewEvidence) {
    fail("The linked independent review URL does not match the fetched review submission.");
  }
  if (!linked.html_url.startsWith(`${prUrl}#pullrequestreview-`)) {
    fail("The linked review is unrelated to this pull request.");
  }

  const body = linked.body;
  const reviewer = exactField(body, "Reviewer", "Independent review");
  if (reviewer !== PROJECT_REVIEWER_MARKER) fail("The linked review lacks the exact project-reviewer marker.");
  if (exactField(body, "Exact reviewed head", "Independent review") !== headSha) {
    fail("The independent review's exact head is stale or mismatched.");
  }
  if (
    exactField(body, "Review requirement coverage", "Independent review") !==
    `${prEvidence.requirementCount}/${prEvidence.requirementCount}`
  ) {
    fail("Independent review coverage must assess every requirement row.");
  }
  const reportUnverifiedIds = parseRequirementIds(
    exactField(body, "Review unverified requirements", "Independent review"),
    "Independent review unverified requirements",
  );
  sameList(reportUnverifiedIds, prEvidence.unverifiedIds, "Independent review unverified requirements");
  const reportBlocking = exactField(body, "Blocking findings", "Independent review");
  const reportNonOverridable = exactField(body, "Non-overridable blockers", "Independent review");
  const reportMandatoryGates = exactField(body, "Mandatory exact-head gates", "Independent review");
  const reportConfidence = exactField(body, "Reviewer confidence", "Independent review");
  const reportRecommendation = exactField(body, "Merge recommendation", "Independent review");
  const reportConclusion = exactField(body, "Conclusion", "Independent review");
  if (reportBlocking !== prEvidence.blockingFindings) fail("Review and ledger blocking findings disagree.");
  if (reportNonOverridable !== prEvidence.nonOverridableBlockers) fail("Review and ledger non-overridable blockers disagree.");
  if (reportMandatoryGates !== prEvidence.mandatoryGates) fail("Review and ledger mandatory-gate status disagree.");
  if (reportConfidence !== prEvidence.reviewerConfidence) fail("Review and ledger reviewer confidence disagree.");
  if (reportRecommendation !== prEvidence.mergeRecommendation) fail("Review and ledger merge recommendations disagree.");

  const rawRows = tableRows(
    body,
    ["ID", "Observable acceptance criterion", "Required proof type", "Evidence inspected", "Status", "Independent assessment"],
    "Independent review",
  );
  if (rawRows.length !== prEvidence.rows.length) {
    fail("Independent review omitted or added a requirement row.");
  }
  rawRows.forEach(([id, acceptance, proof, inspected, status, assessment], index) => {
    const expected = prEvidence.rows[index];
    if (id !== expected.id) fail("Independent review requirement IDs are missing, duplicate, or nonsequential.");
    if (acceptance !== expected.acceptance) fail(`${id} acceptance criterion was omitted or narrowed in review.`);
    if (proof !== expected.proof) fail(`${id} required proof type was substituted in review.`);
    if (status !== expected.status) fail(`${id} review and ledger statuses disagree.`);
    if (inspected === "" || PLACEHOLDER_PATTERN.test(inspected)) fail(`${id} has no inspectable review evidence.`);
    if (assessment === "") fail(`${id} has no independent assessment.`);
  });

  if (prEvidence.authorizationRoute === "automatic") {
    if (reportConclusion !== "requirements-complete") fail("Automatic authorization needs a requirements-complete conclusion.");
    if (reportBlocking !== "none" || reportConfidence !== "100%" || reportRecommendation !== "automatic") {
      fail("Automatic authorization disagrees with the independent report.");
    }
  } else if (reportConclusion !== "human-review-required") {
    fail("Human authorization must retain the reviewer's human-review-required conclusion.");
  }
}

export function validateReviewEvent(review, headSha) {
  if (!review || typeof review !== "object") fail("Review events require an immutable review object.");
  const state = String(review.state ?? "").toUpperCase();
  if (state !== "COMMENTED") {
    fail("Review-evidence events must be COMMENTED; approvals, requested changes, and dismissals fail closed.");
  }
  if (review.commit_id !== headSha) fail("Review-evidence event targets a stale or mismatched head.");
  if (isProjectReviewerReport(review)) return;
  const expected =
    `Review-evidence revalidation trigger for exact head ${headSha}. ` +
    "This COMMENTED submission is not an approval, an independent-review report, or merge authorization.";
  if (review.body !== expected) {
    fail("A non-reviewer review event must be the exact clearly labeled same-head revalidation trigger.");
  }
}

export function validateEvidenceSnapshots({ eventName, eventPayload, currentPr, reviews, checkRuns }) {
  const eventPr = eventPayload?.pull_request;
  if (!eventPr || !currentPr) fail("Evidence validation needs immutable event and current pull-request snapshots.");
  const headSha = eventPr.head?.sha;
  assertExactHead(headSha);
  if (currentPr.head?.sha !== headSha) fail("The current pull-request head changed after the triggering event.");
  if (!eventPr.html_url || currentPr.html_url !== eventPr.html_url) {
    fail("The event and current pull-request URLs do not match.");
  }
  let eventReview = null;
  if (eventName === "pull_request_review") {
    eventReview = eventPayload.review;
    validateReviewEvent(eventReview, headSha);
  } else if (eventName !== "pull_request") {
    fail(`Unsupported evidence event '${eventName}'.`);
  }

  const validateOne = (name, body, overlay = null) => {
    try {
      const prEvidence = parsePullRequestEvidence({
        body: body ?? "",
        headSha,
        prUrl: eventPr.html_url,
        checkRuns,
      });
      validateReviewRecord({
        prEvidence,
        headSha,
        prUrl: eventPr.html_url,
        reviews,
        eventReview: overlay,
      });
    } catch (error) {
      if (error instanceof EvidenceError) fail(`${name} snapshot invalid: ${error.message}`);
      throw error;
    }
  };
  validateOne("Immutable event", eventPr.body, eventReview);
  validateOne("Current GitHub", currentPr.body, null);
  return { headSha, prUrl: eventPr.html_url };
}

export function readJson(path, label) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label} is missing, unreadable, or invalid JSON: ${error.message}`);
  }
}
