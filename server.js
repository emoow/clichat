import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';

const wss = new WebSocketServer({ port: PORT, host: HOST });
// ws -> { name, room }
const clients = new Map();
// room -> Set<ws>
const rooms = new Map();

function joinRoom(ws, room) {
  let set = rooms.get(room);
  if (!set) {
    set = new Set();
    rooms.set(room, set);
  }
  set.add(ws);
}

function leaveRoom(ws, room) {
  const set = rooms.get(room);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) rooms.delete(room);
}

function broadcast(room, payload, exceptWs = null) {
  const set = rooms.get(room);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws === exceptWs) continue;
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

const now = () => Date.now();

wss.on('connection', (ws, req) => {
  let name, room;
  try {
    const url = new URL(req.url, 'http://localhost');
    name = url.searchParams.get('name')?.trim();
    room = url.searchParams.get('room')?.trim();
  } catch {}
  if (!name) {
    ws.close(4001, 'name required');
    return;
  }
  if (!room) {
    ws.close(4002, 'room required');
    return;
  }

  clients.set(ws, { name, room });
  joinRoom(ws, room);
  const online = rooms.get(room).size;
  console.log(`[+] ${name} joined room "${room}" (${online} online in room)`);
  broadcast(room, { type: 'sys', content: `${name} 划水进入摸鱼室`, ts: now() });

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg?.type !== 'msg' || typeof msg.content !== 'string') return;
    const content = msg.content.slice(0, 4000);
    if (!content) return;
    broadcast(room, { type: 'msg', from: name, content, ts: now() }, ws);
  });

  ws.on('close', () => {
    clients.delete(ws);
    leaveRoom(ws, room);
    const remaining = rooms.get(room)?.size ?? 0;
    console.log(`[-] ${name} left room "${room}" (${remaining} online in room)`);
    broadcast(room, { type: 'sys', content: `${name} 假装去开会了`, ts: now() });
  });

  ws.on('error', (err) => {
    console.error(`error from ${name}@${room}:`, err.message);
  });
});

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

console.log(`clichat (摸鱼版) server listening on ${HOST}:${PORT}`);
