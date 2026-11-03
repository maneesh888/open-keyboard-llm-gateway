import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connect, createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { once } from 'node:events';
import { startLiveGateway } from '../../scripts/lib/gateway-test-server.mjs';
import { probeContract } from '../../scripts/live-proof-lib.mjs';
import { startFixture } from './harness.mjs';

const test = base.extend({
  gateway: async ({}, use) => { const gateway = await startFixture(); try { await use(gateway); } finally { await gateway.close(); } },
});
async function signIn(page, gateway) {
  await page.goto(`${gateway.url}/ui`);
  await page.getByLabel('Username', { exact: true }).fill('fixture-admin');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#pageKeys')).toBeVisible();
}
async function rowAction(page, row, name) {
  await row.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
async function confirmDialog(page, button) {
  await page.locator('#confirmDialog').getByRole('button', { name: button, exact: true }).click();
}
async function createKey(page, name = 'Journey client', model = 'fixture:model') {
  await page.getByRole('button', { name: 'New key', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  if (['fixture:model', 'apple-foundationmodel'].includes(model)) {
    await page.getByLabel('Default model', { exact: true }).selectOption(model);
  } else {
    await page.getByLabel('Default model', { exact: true }).selectOption('__custom__');
    await page.locator('#keyModelManual').fill(model);
  }
  await page.getByRole('button', { name: 'Create key', exact: true }).click();
  await expect(page.locator('#keyModal')).not.toBeVisible();
  const row = page.locator('tr').filter({ hasText: name });
  await expect(row).toBeVisible();
  return row;
}
async function savedKey(gateway, name) {
  return JSON.parse(await readFile(join(gateway.directory, 'config/keys.json'), 'utf8')).keys.find(key => key.name === name);
}
async function chat(gateway, body, key = gateway.clientKey) {
  return fetch(`${gateway.url}/v1/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
const messages = [{ role: 'user', content: 'Public transport test fixture.' }];

test('sign-in failure, keyboard access, session restore, expiry and logout', async ({ page, gateway }) => {
  await page.goto(`${gateway.url}/ui`);
  await page.getByLabel('Username', { exact: true }).fill('fixture-admin');
  await page.getByLabel('Password', { exact: true }).fill('incorrect fixture password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#loginError')).toContainText('Invalid credentials');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.locator('#pageKeys')).toBeVisible();
  await page.reload();
  await expect(page.locator('#pageKeys')).toBeVisible();
  // Deliberately expired browser session is automated regression evidence only.
  await page.evaluate(() => localStorage.setItem('llmGatewayAdminSession', JSON.stringify({ token: 'expired-fixture', expiresAt: Date.now() + 10000 })));
  await page.reload();
  await expect(page.locator('#loginScreen')).toBeVisible();
  await expect(page.locator('#loginError')).toContainText('Session expired');
  await signIn(page, gateway);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('#loginScreen')).toBeVisible();
  await page.reload();
  await expect(page.locator('#loginScreen')).toBeVisible();
});

test('key lifecycle persists settings, protects credentials and revokes access', async ({ page, context, gateway }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: gateway.url });
  await signIn(page, gateway);
  let row = await createKey(page);
  const original = await savedKey(gateway, 'Journey client');
  expect(Boolean(original?.key)).toBe(true);
  expect((await page.locator('#dashboardSuccess').textContent()).includes(original.key)).toBe(false);
  await rowAction(page, row, 'Reveal key');
  await expect.poll(async () => await row.locator('.key-display').textContent() === original.key).toBe(true);
  await row.getByRole('button', { name: 'Copy key', exact: true }).click();
  await expect.poll(async () => await page.evaluate(() => navigator.clipboard.readText()) === original.key).toBe(true);
  await rowAction(page, row, 'Hide key');
  await expect.poll(async () => await row.locator('.key-display').textContent() === original.key).toBe(false);
  // Seed a production API setting that the UI intentionally does not expose.
  const login = await fetch(`${gateway.url}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'fixture-admin', password: 'fixture-password' }) });
  const admin = await login.json();
  const features = { suggestions: false, customActions: [{ id: 'fixture-action', label: 'Fixture action', prompt: 'Public fixture instruction.' }] };
  const seeded = await fetch(`${gateway.url}/admin/keys/${original.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ features }) });
  expect(seeded.status).toBe(200);
  await rowAction(page, row, 'Edit');
  await page.getByLabel('Name', { exact: true }).fill('Renamed client');
  await page.getByLabel('Requests per minute', { exact: true }).fill('42');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  row = page.locator('tr').filter({ hasText: 'Renamed client' });
  await expect(row).toContainText('42 req/min');
  const updated = await savedKey(gateway, 'Renamed client');
  expect(updated.key === original.key).toBe(true);
  expect(updated.features).toEqual(features);
  await rowAction(page, row, 'Disable key');
  await expect(row.locator('td[data-label="Access"]')).toHaveText('Disabled');
  expect((await chat(gateway, { model: 'fixture:model', messages }, original.key)).status).toBe(401);
  await rowAction(page, row, 'Enable key');
  await expect(row.locator('td[data-label="Access"]')).toHaveText('Enabled');
  expect((await chat(gateway, { model: 'fixture:model', messages }, original.key)).status).toBe(200);
  await rowAction(page, row, 'Delete key');
  await expect(page.locator('#confirmDialog')).toContainText('Delete Renamed client?');
  await confirmDialog(page, 'Cancel');
  await expect(row).toBeVisible();
  await rowAction(page, row, 'Delete key');
  await confirmDialog(page, 'Delete');
  await expect(row).toHaveCount(0);
  expect((await chat(gateway, { model: 'fixture:model', messages }, original.key)).status).toBe(401);
  expect(await savedKey(gateway, 'Renamed client') === undefined).toBe(true);
});

test('row actions treat stored identifiers as data and stay reachable in a short viewport', async ({ page, gateway }) => {
  await page.setViewportSize({ width: 390, height: 320 });
  await signIn(page, gateway);
  await page.evaluate(() => { globalThis.reviewMarker = false; });
  const injectedModel = "fixture');globalThis.reviewMarker=true;//";
  const row = await createKey(page, 'Stored model fixture', injectedModel);
  await expect(row).toContainText(injectedModel);
  await row.getByRole('button', { name: 'More actions', exact: true }).click();
  const menu = page.locator('#rowMenu');
  await expect(menu).toBeVisible();
  const bounds = await menu.evaluate(element => { const rect = element.getBoundingClientRect(); return { y: rect.y, height: rect.height }; });
  expect(bounds.y).toBeGreaterThanOrEqual(8);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(312);
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).press('End');
  const keyboardReach = await menu.evaluate(element => {
    const menuRect = element.getBoundingClientRect();
    const activeRect = document.activeElement.getBoundingClientRect();
    return { active: document.activeElement.textContent.trim(), scrollTop: element.scrollTop, menuBottom: menuRect.bottom, activeBottom: activeRect.bottom };
  });
  expect(keyboardReach.active).toBe('Delete key');
  expect(keyboardReach.scrollTop).toBeGreaterThan(0);
  expect(keyboardReach.activeBottom).toBeLessThanOrEqual(keyboardReach.menuBottom);
  await page.getByRole('menuitem', { name: 'Refresh status', exact: true }).click();
  await expect(page.locator('#dashboardError')).toBeVisible();
  expect(await page.evaluate(() => globalThis.reviewMarker)).toBe(false);
  expect(gateway.state.chatCalls).toHaveLength(0);
});

test('tester clears an old result after key defaults change', async ({ page, gateway }) => {
  await signIn(page, gateway);
  let row = await createKey(page, 'Default model fixture');
  await row.getByRole('button', { name: 'Open in tester', exact: true }).click();
  await page.getByRole('button', { name: 'Run test', exact: true }).click();
  await expect(page.locator('#testerStatus')).toHaveText('Passed');
  await page.goBack();
  await expect(page.locator('#pageKeys')).toBeVisible();
  row = page.locator('tr').filter({ hasText: 'Default model fixture' });
  await rowAction(page, row, 'Edit');
  await page.getByText('Advanced: max tokens, temperature, reasoning effort, max burst', { exact: true }).click();
  await page.getByLabel('Reasoning effort (default)', { exact: true }).selectOption('high');
  await page.getByLabel('Temperature', { exact: true }).fill('1.2');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await row.getByRole('button', { name: 'Open in tester', exact: true }).click();
  await expect(page.locator('#testerModel')).toHaveValue('fixture:model');
  await expect(page.locator('#testerStatus')).toHaveText('Not run yet');
  await expect(page.locator('#chatLog')).not.toContainText('Fixture answer');
  await page.getByRole('button', { name: 'Run test', exact: true }).click();
  await expect(page.locator('#testerStatus')).toHaveText('Passed');
  await page.goBack();
  await expect(page.locator('#pageKeys')).toBeVisible();
  row = page.locator('tr').filter({ hasText: 'Default model fixture' });
  await rowAction(page, row, 'Edit');
  await page.getByLabel('Default model', { exact: true }).selectOption('apple-foundationmodel');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await row.getByRole('button', { name: 'Open in tester', exact: true }).click();
  await expect(page.locator('#testerModel')).toHaveValue('apple-foundationmodel');
  await expect(page.locator('#testerStatus')).toHaveText('Not run yet');
  await expect(page.locator('#chatLog')).not.toContainText('Fixture answer');
});

for (const width of [1280, 390]) {
  test(`playground journey and failure recovery at ${width}px`, async ({ page, gateway }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, gateway);
    const row = await createKey(page);
    await row.getByRole('button', { name: 'Open in tester', exact: true }).click();
    await expect(page.locator('#pagePlayground')).toBeVisible();
    await expect(page.locator('#testerModel')).toHaveValue('fixture:model');
    await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible();
    await expect(page.locator('#operationCatalogVersion')).toHaveText('Contract 3.1.1');
    await expect(page.locator('#operationCatalog')).toContainText('fix_grammar');
    await expect(page.locator('#operationCatalog')).toContainText('keyboard_suggestions');
    await expect(page.locator('#testerStatus')).toHaveText('Not run yet');
    await page.locator('#testerSystemDetails summary').click();
    await page.getByLabel('System prompt', { exact: true }).fill('');
    await page.getByLabel('Message', { exact: true }).fill(messages[0].content);
    await page.getByRole('button', { name: 'Run test', exact: true }).click();
    await expect(page.locator('#testerStatus')).toHaveText('Passed');
    await expect(page.locator('#chatLog')).toContainText('Fixture answer');
    expect(gateway.state.chatCalls.at(-1).messages).toEqual(messages);
    expect(gateway.state.chatCalls.at(-1)).not.toHaveProperty('operation');
    expect(gateway.state.chatCalls.at(-1)).not.toHaveProperty('input_text');
    expect(gateway.state.chatCalls.at(-1)).not.toHaveProperty('response_format');
    expect(gateway.state.credentialForwarded).toBe(false);
    gateway.state.mode = 'offline';
    await page.getByRole('button', { name: 'Run test', exact: true }).click();
    await expect(page.locator('#testerStatus')).toHaveText('Failed');
    await expect(page.locator('#chatLog')).toHaveAttribute('role', 'alert');
    gateway.state.mode = 'ok';
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.locator('#testerStatus')).toHaveText('Passed');
    // A result never outlives the selection it was produced for.
    await page.locator('#testerKey').selectOption('');
    await expect(page.locator('#testerStatus')).toHaveText('Not run yet');
    await expect(page.locator('#chatLog')).not.toContainText('Fixture answer');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.goBack();
    await expect(page.locator('#pageKeys')).toBeVisible();
  });
}

test('model metadata is distinct from inference and start/stop affect only owned fixtures', async ({ page, gateway }) => {
  await signIn(page, gateway);
  const row = await createKey(page);
  await expect(row).toContainText('Not loaded, loads on first use');
  expect(gateway.state.chatCalls).toHaveLength(0);
  await rowAction(page, row, 'Load into memory');
  await expect(row.locator('.model-status')).toHaveText('Loaded');
  await rowAction(page, row, 'Unload from memory');
  await expect(row).toContainText('Not loaded, loads on first use');
  expect(gateway.state.controls).toHaveLength(2);
  expect(gateway.state.controls.every(body => !body.prompt && body.stream === false)).toBe(true);
  expect(gateway.state.controls[1].keep_alive).toBe(0);
  expect(gateway.state.chatCalls).toHaveLength(0);
  gateway.state.mode = 'offline';
  await rowAction(page, row, 'Refresh status');
  await expect(row.locator('.model-status')).toHaveText('Ollama offline');
  await expect(row.locator('.model-status')).toHaveAttribute('title', /not reachable/);
  gateway.state.mode = 'ok';
  await rowAction(page, row, 'Refresh status');
  await expect(row).toContainText('Not loaded, loads on first use');
});

test('public API covers both provider routes, streaming, malformed upstream and error redaction', async ({ gateway }) => {
  expect((await fetch(`${gateway.url}/v1/models`)).status).toBe(401);
  for (const model of ['fixture:model', 'apple-foundationmodel']) {
    const result = await chat(gateway, { model, messages, stream: false });
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.model).toBe(model);
    expect(body.choices[0].message.content).toBe('Fixture answer');
    const stream = await chat(gateway, { model, messages, stream: true });
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const events = await stream.text();
    expect(events).toContain('Fixture answer');
    expect(events).toContain('[DONE]');
  }
  gateway.state.mode = 'malformed';
  expect((await chat(gateway, { model: 'fixture:model', messages })).status).toBe(502);
  gateway.state.mode = 'error';
  const failure = await chat(gateway, { model: 'fixture:model', messages });
  expect(failure.status).toBe(502);
  expect((await failure.text()).includes('private_detail')).toBe(false);
  gateway.state.mode = 'slow-metadata';
  const timeout = await fetch(`${gateway.url}/v1/models`, { headers: { Authorization: `Bearer ${gateway.clientKey}` } });
  expect(timeout.status).toBe(504);
  gateway.state.mode = 'ok';
  expect((await chat(gateway, { model: 'fixture:model', messages })).status).toBe(200);
  expect(gateway.state.credentialForwarded).toBe(false);
});

for (const provider of ['ollama', 'apfel']) {
  test(`live runner isolates ${provider} from an absent opposite provider`, async ({ gateway }) => {
    const profile = { version: 1, provider, upstreamUrl: gateway.upstreamUrl,
      model: provider === 'apfel' ? 'apple-foundationmodel' : 'fixture:model', timeoutMs: 5000 };
    const owned = await startLiveGateway({ profile });
    try {
      expect(await probeContract({ ...owned, profile })).toEqual({ authentication: true, models: true, completion: true, streaming: true });
      const host = Object.values(networkInterfaces()).flat().find(address => address.family === 'IPv4' && !address.internal)?.address || '127.0.0.2';
      const canConnect = port => new Promise(resolve => {
        const socket = connect({ host, port });
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
        socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
      });
      // Confirm this address actually detects a wildcard listener before testing isolation.
      const control = createServer(socket => socket.destroy());
      control.listen(0, '0.0.0.0'); await once(control, 'listening');
      try { expect(await canConnect(control.address().port)).toBe(true); }
      finally { await new Promise(resolve => control.close(resolve)); }
      expect(await canConnect(Number(new URL(owned.url).port))).toBe(false);
    } finally { await owned.close(); }
  });
}
