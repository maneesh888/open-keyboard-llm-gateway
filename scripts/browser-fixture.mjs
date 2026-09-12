#!/usr/bin/env node
import { startFixture } from '../tests/e2e/harness.mjs';
const fixture = await startFixture();
console.log(`Disposable browser walkthrough: ${fixture.url}/ui`);
console.log('Use the public fixture account in docs/BROWSER_SMOKE_PLAN.md. Fixture upstreams; no live inference.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void fixture.close().then(() => process.exit(0)); });
