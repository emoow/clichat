import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';

const wss = new WebSocketServer({ port: PORT, host: HOST });
const clients = new Map();

function broadcast(payload, exceptWs = null) {
  const data = JSON.stringify(payload);
  for (const ws of clients.keys()) {
    if (ws === exceptWs) continue;
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

const now = () => Date.now();

wss.on('connection', (ws, req) => {
  let name;
  try {
    const url = new URL(req.url, 'http://localhost');
    name = url.searchParams.get('name')?.trim();
  } catch {}
  if (!name) {
    ws.close(4001, 'name required');
    return;
  }

  clients.set(ws, { name });
  console.log(`[+] ${name} connected (${clients.size} online)`);
  broadcast({ type: 'sys', content: `${name} joined`, ts: now() });

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg?.type !== 'msg' || typeof msg.content !== 'string') return;
    const content = msg.content.slice(0, 4000);
    if (!content) return;
    broadcast({ type: 'msg', from: name, content, ts: now() }, ws);
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[-] ${name} disconnected (${clients.size} online)`);
    broadcast({ type: 'sys', content: `${name} left`, ts: now() });
  });

  ws.on('error', (err) => {
    console.error(`error from ${name}:`, err.message);
  });
});

// Heartbeat: any client that didn't pong within 30s gets terminated.
const interval = setInterval(() => {
  for (const ws of clients.keys()) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

wss.on('close', () => clearInterval(interval));

console.log(`clichat server listening on ${HOST}:${PORT}`);
