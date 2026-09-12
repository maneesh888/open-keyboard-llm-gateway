import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { startGateway } from '../../scripts/lib/gateway-test-server.mjs';

export async function startFixture() {
  const state = { mode: 'ok', loaded: false, chatCalls: [], controls: [], credentialForwarded: false };
  const upstream = createServer(async (request, response) => {
    state.credentialForwarded ||= Boolean(request.headers.authorization);
    if (state.mode === 'offline') { request.socket.destroy(); return; }
    if (state.mode === 'slow-metadata' && request.url === '/api/tags') return;
    const send = (body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (request.url === '/api/tags') return send({ models: [{ name: 'fixture:model' }] });
    if (request.url === '/api/ps') return send({ models: state.loaded ? [{ name: 'fixture:model' }] : [] });
    if (request.url === '/v1/models') return send({ object: 'list', data: [{ id: 'apple-foundationmodel', object: 'model', created: 0, owned_by: 'apfel' }] });
    if (request.url === '/health') return send({ status: 'ok', model_available: true });
    let raw = ''; for await (const part of request) raw += part;
    const body = raw ? JSON.parse(raw) : {};
    if (request.url === '/api/generate') {
      state.controls.push(body); state.loaded = body.keep_alive !== 0;
      return send({ done: true });
    }
    if (request.url !== '/v1/chat/completions') return send({ error: 'fixture route absent' }, 404);
    state.chatCalls.push(body);
    if (state.mode === 'error') return send({ private_detail: 'fixture upstream detail must not escape' }, 500);
    if (state.mode === 'malformed') return send({ unexpected: true });
    if (body.stream) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const delta of [{ role: 'assistant' }, { content: 'Fixture answer' }]) {
        response.write(`data: ${JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      }
      response.end(`data: ${JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    send({ id: 'chatcmpl-fixture', object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'Fixture answer' }, finish_reason: 'stop' }] });
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const adminConfig = { users: [{ username: 'fixture-admin', passwordHash: await bcrypt.hash('fixture-password', 4), createdAt: '2026-01-01T00:00:00Z' }],
    jwtSecret: randomBytes(32).toString('hex'), sessionExpiryHours: 1 };
  try {
    const gateway = await startGateway({ upstreamUrl, apfelUrl: upstreamUrl, adminConfig });
    return { ...gateway, upstreamUrl, state, async close() { await gateway.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); } };
  } catch (error) { upstream.closeAllConnections(); upstream.close(); throw error; }
}
