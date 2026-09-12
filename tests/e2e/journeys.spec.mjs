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
async function createKey(page, name = 'Journey client') {
  await page.getByRole('button', { name: '+ New Key', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Default model', { exact: true }).selectOption('fixture:model');
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
  await page.locator('#pageKeys').getByRole('button', { name: 'Logout', exact: true }).click();
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
  await row.getByRole('button', { name: 'Reveal', exact: true }).click();
  await expect.poll(async () => await row.locator('.key-display').textContent() === original.key).toBe(true);
  await row.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect.poll(async () => await page.evaluate(() => navigator.clipboard.readText()) === original.key).toBe(true);
  await row.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect.poll(async () => await row.locator('.key-display').textContent() === original.key).toBe(false);
  // Seed a production API setting that the UI intentionally does not expose.
  const login = await fetch(`${gateway.url}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'fixture-admin', password: 'fixture-password' }) });
  const admin = await login.json();
  const features = { suggestions: false, customActions: [{ id: 'fixture-action', label: 'Fixture action', prompt: 'Public fixture instruction.' }] };
  const seeded = await fetch(`${gateway.url}/admin/keys/${original.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ features }) });
  expect(seeded.status).toBe(200);
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Renamed client');
  await page.getByLabel('Requests / minute', { exact: true }).fill('42');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  row = page.locator('tr').filter({ hasText: 'Renamed client' });
  await expect(row).toContainText('42/min');
  const updated = await savedKey(gateway, 'Renamed client');
  expect(updated.key === original.key).toBe(true);
  expect(updated.features).toEqual(features);
  await row.getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();
  expect((await chat(gateway, { model: 'fixture:model', messages }, original.key)).status).toBe(401);
  await row.getByRole('button', { name: 'Enable', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Disable', exact: true })).toBeVisible();
  expect((await chat(gateway, { model: 'fixture:model', messages }, original.key)).status).toBe(200);
  page.once('dialog', dialog => dialog.dismiss());
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row).toHaveCount(0);
  expect((await chat(gateway, { model: 'fixture:model', messages }, original.key)).status).toBe(401);
  expect(await savedKey(gateway, 'Renamed client') === undefined).toBe(true);
});

for (const width of [1280, 390]) {
  test(`playground journey and failure recovery at ${width}px`, async ({ page, gateway }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, gateway);
    const row = await createKey(page);
    await row.getByRole('button', { name: 'Live test', exact: true }).click();
    await expect(page.locator('#pagePlayground')).toBeVisible();
    await expect(page.locator('#testerModel')).toHaveValue('fixture:model');
    await page.getByLabel('System prompt', { exact: true }).fill('');
    await page.getByLabel('User message', { exact: true }).fill(messages[0].content);
    await page.getByRole('button', { name: 'Test this key', exact: true }).click();
    await expect(page.locator('#testerStatus')).toContainText('Key can chat');
    await expect(page.locator('#chatLog')).toContainText('Fixture answer');
    expect(gateway.state.chatCalls.at(-1).messages).toEqual(messages);
    expect(gateway.state.credentialForwarded).toBe(false);
    gateway.state.mode = 'offline';
    await page.getByRole('button', { name: 'Test this key', exact: true }).click();
    await expect(page.locator('#testerStatus')).toContainText('Test failed');
    gateway.state.mode = 'ok';
    await page.getByRole('button', { name: 'Test this key', exact: true }).click();
    await expect(page.locator('#testerStatus')).toContainText('Key can chat');
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await expect(page.locator('#testerStatus')).toContainText('No test run');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.goBack();
    await expect(page.locator('#pageKeys')).toBeVisible();
  });
}

test('model metadata is distinct from inference and start/stop affect only owned fixtures', async ({ page, gateway }) => {
  await signIn(page, gateway);
  const row = await createKey(page);
  await expect(row).toContainText('Available · idle');
  expect(gateway.state.chatCalls).toHaveLength(0);
  await row.getByRole('button', { name: 'Start model', exact: true }).click();
  await expect(row).toContainText('Running');
  await row.getByRole('button', { name: 'Stop model', exact: true }).click();
  await expect(row).toContainText('Available · idle');
  expect(gateway.state.controls).toHaveLength(2);
  expect(gateway.state.controls.every(body => !body.prompt && body.stream === false)).toBe(true);
  expect(gateway.state.controls[1].keep_alive).toBe(0);
  expect(gateway.state.chatCalls).toHaveLength(0);
  gateway.state.mode = 'offline';
  await row.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(row.locator('.model-status')).toContainText('not reachable');
  gateway.state.mode = 'ok';
  await row.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(row).toContainText('Available · idle');
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
