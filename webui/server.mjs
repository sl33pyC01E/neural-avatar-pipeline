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
  { id: 'a2f', name: 'Audio2Face', port: 8798 },
];

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

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${host}:${port}`);
  if (url.pathname === '/api/status') {
    const status = await Promise.all(services.map(async (service) => ({ ...service, online: await portOpen(service.port, service.host || host) })));
    json(response, 200, { ok: true, root: process.env.UNIFIED_LAB_ROOT || path.dirname(root), services: status });
    return;
  }
  if (url.pathname === '/unified-character.js') {
    const file = path.join(root, 'unified-character.js');
    if (!existsSync(file)) {
      json(response, 500, { ok: false, error: 'Unified Character controller is missing.' });
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
