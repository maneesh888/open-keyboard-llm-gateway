import { serve } from '@hono/node-server';
import { createModelServiceControllerApp } from './models/hostController.js';
import { protectedValue } from './lib/protectedValue.js';

const token = protectedValue('MODEL_SERVICE_CONTROL_TOKEN', 'MODEL_SERVICE_CONTROL_TOKEN_FILE');
if (!token) {
  console.error('[model-service-controller] A protected control token is required.');
  process.exit(1);
}

const port = Number.parseInt(process.env.MODEL_SERVICE_CONTROLLER_PORT || '18777', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('[model-service-controller] MODEL_SERVICE_CONTROLLER_PORT must be a valid port.');
  process.exit(1);
}

console.log(`[model-service-controller] Listening on loopback port ${port}`);
serve({
  fetch: createModelServiceControllerApp(token).fetch,
  hostname: '127.0.0.1',
  port,
});
