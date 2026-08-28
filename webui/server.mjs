import { createReadStream, existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const host = '127.0.0.1';
const port = Number(process.env.UNIFIED_WEBUI_PORT || 8788);
const services = [
  { id: 'motion', name: 'ARDY Motion', port: 8793 },
  { id: 'face-api', name: 'Face Backend', port: 8794 },
  { id: 'face', name: 'Face Animation', host: 'localhost', port: 8795 },
  { id: 'voice', name: 'PocketTTS CUDA', port: 8796 },
  { id: 'lam', name: 'LAM A2E', port: 8797 },
];
const controlActions = {
  'session.start': { description: 'Open Live Full Flow and start the resident live session.', args: {} },
  'session.stop': { description: 'Stop the live session.', args: {} },
  'speech.say': { description: 'Queue one line for live PocketTTS and LAM processing.', args: { text: 'string' } },
  'speech.queue.clear': { description: 'Remove speech that is not currently processing or playing.', args: {} },
  'speech.schedule.set': { description: 'Replace scheduled speech.', args: { cues: [{ time: 'seconds >= 0', text: 'string' }], loop: 'boolean optional' } },
  'embedding.activate': { description: 'Activate a cached embedding by key, nickname, or exact text.', args: { selector: 'string' } },
  'embedding.release': { description: 'Release the active embedding to the idle fallback.', args: {} },
  'embedding.idle.set': { description: 'Choose the required idle fallback embedding.', args: { selector: 'cache key, nickname, or exact text' } },
  'embedding.stack.set': { description: 'Replace the arrow-key embedding stack.', args: { selectors: ['cache key, nickname, or exact text'] } },
  'embedding.schedule.set': { description: 'Replace scheduled embedding selections.', args: { cues: [{ time: 'seconds >= 0', selector: 'cached selector or idle' }], loop: 'boolean optional' } },
  'embedding.create': { description: 'Compute and permanently store a new cached embedding while stopped.', args: { text: 'string', nickname: 'string optional' } },
  'path.schedule.set': { description: 'Replace timed X/Z walk endpoints.', args: { endpoints: [{ time: 'arrival seconds >= 0', x: 'metres', z: 'metres' }], loop: 'boolean optional' } },
  'path.clear': { description: 'Clear all scheduled walk endpoints.', args: {} },
  'loops.set': { description: 'Change any independent schedule loop without replacing its cues.', args: { speech: 'boolean optional', embeddings: 'boolean optional', path: 'boolean optional' } },
  'locomotion.keys': { description: 'Hold zero or more locomotion keys, optionally for a bounded duration.', args: { keys: ['w|a|s|d'], durationMs: '0..60000 optional' } },
  'locomotion.stop': { description: 'Release all locomotion keys.', args: {} },
  'camera.set': { description: 'Set live camera behavior or framing.', args: { target: 'face|torso|hips|full optional', follow: 'boolean optional', orbit: 'boolean optional', distance: '0.45..12 optional', yaw: '-180..180 degrees optional', pitch: '10..170 degrees optional', orbitSpeed: '-90..90 degrees/sec optional', smoothing: '0.5..20 optional', targetOffsetY: '-1..1 metres optional' } },
  'camera.preset': { description: 'Apply a standard camera shot.', args: { preset: 'face|torso|full' } },
  'camera.nudge': { description: 'Adjust the current camera without replacing unrelated settings.', args: { yaw: 'degree delta optional', pitch: 'degree delta optional', distance: 'metre delta optional' } },
  'camera.reset': { description: 'Restore the default torso-follow camera.', args: {} },
};
let controlSequence = 0;
const controlCommands = [];
const controlResults = new Map();
const controlRequestIds = new Map();
let controlState = { session: { active: false }, note: 'Live UI has not reported state yet.' };
let controlUiSeenAt = 0;

function portOpen(servicePort, serviceHost = host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: serviceHost, port: servicePort });
    const done = (online) => { socket.destroy(); resolve(online); };
    socket.setTimeout(350);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function readJson(request, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    request.on('data', (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > limit) { rejected = true; reject(new Error('JSON body is too large.')); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('Request body must be valid JSON.')); }
    });
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${host}:${port}`);
  if (request.method === 'GET' && url.pathname === '/api/control/schema') {
    json(response, 200, {
      ok: true,
      version: 1,
      baseUrl: `http://${host}:${port}`,
      workflow: ['GET /api/control/state', 'POST /api/control with {action,args,requestId}', 'GET /api/control/result?id=<commandId> until completed or failed'],
      retrySafety: 'Use a unique stable requestId for each intended action. Retrying the same requestId returns the original command instead of executing twice.',
      endpoints: {
        state: 'GET /api/control/state',
        command: 'POST /api/control',
        result: 'GET /api/control/result?id=<commandId>',
        openapi: 'GET /api/control/openapi.json',
      },
      actions: controlActions,
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/control/openapi.json') {
    json(response, 200, {
      openapi: '3.1.0',
      info: { title: 'Neural Avatar Pipeline Local Control API', version: '1.0.0', description: 'Loopback command API for the open Live Full Flow WebUI.' },
      servers: [{ url: `http://${host}:${port}` }],
      paths: {
        '/api/control/schema': { get: { operationId: 'getControlSchema', summary: 'Read action catalog and safe workflow', responses: { 200: { description: 'Control schema' } } } },
        '/api/control/state': { get: { operationId: 'getControlState', summary: 'Read current live suite state', responses: { 200: { description: 'Current WebUI state' } } } },
        '/api/control': {
          post: {
            operationId: 'submitControlCommand', summary: 'Queue one retry-safe control command',
            requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ControlCommand' } } } },
            responses: { 202: { description: 'Command accepted' }, 400: { description: 'Invalid action or JSON' } },
          },
        },
        '/api/control/result': {
          get: {
            operationId: 'getControlResult', summary: 'Read asynchronous command status',
            parameters: [{ name: 'id', in: 'query', required: true, schema: { type: 'integer', minimum: 1 } }],
            responses: { 200: { description: 'Pending, running, completed, or failed result' }, 404: { description: 'Unknown command id' } },
          },
        },
      },
      components: {
        schemas: {
          ControlCommand: {
            type: 'object', required: ['action', 'args'], additionalProperties: false,
            properties: {
              requestId: { type: 'string', maxLength: 160, description: 'Stable unique id for retry safety.' },
              action: { type: 'string', enum: Object.keys(controlActions) },
              args: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/control/state') {
    json(response, 200, { ok: true, uiConnected: Date.now() - controlUiSeenAt < 3000, state: controlState });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/control') {
    try {
      const body = await readJson(request);
      const action = String(body.action || '');
      if (!controlActions[action]) { json(response, 400, { ok: false, error: `Unknown action “${action}”.`, allowedActions: Object.keys(controlActions) }); return; }
      const requestId = String(body.requestId || '').trim().slice(0, 160);
      if (requestId && controlRequestIds.has(requestId)) {
        const existingId = controlRequestIds.get(requestId);
        json(response, 200, { ok: true, accepted: true, duplicate: true, commandId: existingId, command: controlResults.get(existingId), uiConnected: Date.now() - controlUiSeenAt < 3000 });
        return;
      }
      const command = { id: ++controlSequence, requestId: requestId || null, action, args: body.args && typeof body.args === 'object' ? body.args : {}, createdAt: new Date().toISOString() };
      controlCommands.push(command);
      controlResults.set(command.id, { id: command.id, requestId: command.requestId, status: 'pending', action, createdAt: command.createdAt });
      if (requestId) controlRequestIds.set(requestId, command.id);
      while (controlCommands.length > 500) {
        const dropped = controlCommands.shift();
        const result = controlResults.get(dropped.id);
        if (result?.status === 'pending') controlResults.set(dropped.id, { ...result, status: 'failed', completedAt: new Date().toISOString(), error: 'Command queue capacity was exceeded before the WebUI connected.' });
      }
      while (controlResults.size > 1000) {
        const oldestId = controlResults.keys().next().value;
        const oldest = controlResults.get(oldestId);
        if (oldest?.requestId) controlRequestIds.delete(oldest.requestId);
        controlResults.delete(oldestId);
      }
      json(response, 202, { ok: true, accepted: true, commandId: command.id, uiConnected: Date.now() - controlUiSeenAt < 3000 });
    } catch (error) { json(response, 400, { ok: false, error: error.message }); }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/control/commands') {
    controlUiSeenAt = Date.now();
    const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
    const commands = controlCommands.filter((command) => command.id > after && controlResults.get(command.id)?.status === 'pending').slice(0, 50);
    json(response, 200, { ok: true, commands, latestId: controlSequence });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/control/result') {
    try {
      const body = await readJson(request);
      const id = Number(body.id);
      if (!Number.isInteger(id) || !controlResults.has(id)) { json(response, 404, { ok: false, error: 'Unknown command id.' }); return; }
      if (body.status === 'running') {
        controlResults.set(id, { ...controlResults.get(id), status: 'running', startedAt: new Date().toISOString() });
      } else {
        controlResults.set(id, { ...controlResults.get(id), status: body.ok ? 'completed' : 'failed', completedAt: new Date().toISOString(), result: body.result ?? null, error: body.ok ? null : String(body.error || 'Command failed.') });
      }
      controlUiSeenAt = Date.now();
      json(response, 200, { ok: true });
    } catch (error) { json(response, 400, { ok: false, error: error.message }); }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/control/result') {
    const id = Number(url.searchParams.get('id'));
    const result = controlResults.get(id);
    if (!result) { json(response, 404, { ok: false, error: 'Unknown command id.' }); return; }
    json(response, 200, { ok: true, command: result });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/control/state') {
    try {
      const body = await readJson(request);
      controlState = body && typeof body === 'object' ? body : {};
      controlUiSeenAt = Date.now();
      json(response, 200, { ok: true });
    } catch (error) { json(response, 400, { ok: false, error: error.message }); }
    return;
  }
  if (url.pathname === '/api/status') {
    const status = await Promise.all(services.map(async (service) => ({ ...service, online: await portOpen(service.port, service.host || host) })));
    json(response, 200, { ok: true, root: process.env.UNIFIED_LAB_ROOT || path.dirname(root), services: status });
    return;
  }
  if (url.pathname === '/unified-character.js' || url.pathname === '/live-flow.js') {
    const file = path.join(root, path.basename(url.pathname));
    if (!existsSync(file)) {
      json(response, 500, { ok: false, error: 'Unified WebUI controller is missing.' });
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(response);
    return;
  }
  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    json(response, 404, { ok: false, error: 'Not found.' });
    return;
  }
  const file = path.join(root, 'index.html');
  if (!existsSync(file)) {
    json(response, 500, { ok: false, error: 'Unified WebUI is incomplete.' });
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(response);
});

server.listen(port, host, () => console.log(`Unified WebUI: http://${host}:${port}`));
