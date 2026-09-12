#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLiveProof } from './live-proof-lib.mjs';
import { impactBetween } from './verification-impact.mjs';

function field(body, name) {
  const values = body.split(/\r?\n/u).filter(line => line.startsWith(`- ${name}: `)).map(line => line.slice(name.length + 4).trim());
  if (values.length !== 1 || !values[0]) throw new Error(`Exactly one ${name} field is required.`);
  return values[0];
}
export function validateWorkflowEvidence({ body, head, impact }) {
  if (!/^[0-9a-f]{40}$/u.test(head) || typeof body !== 'string') throw new Error('Workflow evidence requires exact head and PR body.');
  const live = field(body, 'Workflow live proof');
  if (impact.live || live !== 'not-required') {
    let proof; try { proof = JSON.parse(live); } catch { throw new Error('Required live proof is absent or malformed.'); }
    validateLiveProof(proof, head);
  }
  const browser = field(body, 'Workflow browser proof');
  if (impact.browser || browser !== 'not-required') {
    const match = /^(observed|human-approved):([0-9a-f]{40}):(.+)$/u.exec(browser);
    if (!match || match[2] !== head || /^(pending|none|unknown|not-required)$/iu.test(match[3])) throw new Error('Required browser evidence is missing or stale.');
    if (match[1] === 'human-approved' && (field(body, 'Merge authorization route') !== 'human' || field(body, 'Human-approved head') !== head)) throw new Error('Human browser evidence requires the existing exact-head human authorization route.');
  }
  return true;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const event = JSON.parse(readFileSync(process.env.EVENT_JSON_FILE, 'utf8'));
    const current = JSON.parse(readFileSync(process.env.CURRENT_PR_JSON_FILE, 'utf8'));
    const snapshot = event.pull_request;
    if (!snapshot || current.head.sha !== snapshot.head.sha || current.base.sha !== snapshot.base.sha) throw new Error('Workflow evidence snapshots target different revisions.');
    const head = current.head.sha;
    const impact = impactBetween(process.cwd(), current.base.sha, head);
    for (const pr of [snapshot, current]) validateWorkflowEvidence({ body: pr.body, head, impact });
    console.log(`Workflow evidence metadata passed for ${head}. Execution and observed usability require independent inspection.`);
  } catch { console.error('Workflow evidence is absent, stale, malformed, or insufficient for the changed surfaces.'); process.exitCode = 1; }
}
