import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';

const wss = new WebSocketServer({ port: PORT, host: HOST });
// ws -> { name, room }
const clients = new Map();
// room -> Set<ws>
const rooms = new Map();
// room -> Array<{id, type:'msg', from, content, ts}>
const history = new Map();
const HISTORY_LIMIT = 500;
let nextId = 1;

function appendHistory(room, msg) {
  let arr = history.get(room);
  if (!arr) { arr = []; history.set(room, arr); }
  arr.push(msg);
  if (arr.length > HISTORY_LIMIT) arr.splice(0, arr.length - HISTORY_LIMIT);
}

function getHistorySince(room, sinceId) {
  const arr = history.get(room);
  if (!arr) return [];
  if (!sinceId) return arr.slice();
  return arr.filter((m) => m.id > sinceId);
}

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
  let name, room, since = 0;
  try {
    const url = new URL(req.url, 'http://localhost');
    name = url.searchParams.get('name')?.trim();
    room = url.searchParams.get('room')?.trim();
    const s = url.searchParams.get('since');
    if (s) since = Number(s) || 0;
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
  // 先把缺失的历史推给这一个客户端
  const past = getHistorySince(room, since);
  if (past.length) {
    ws.send(JSON.stringify({ type: 'history', messages: past }));
  }
  const online = rooms.get(room).size;
  console.log(`[+] ${name} hit 404 "${room}" (${online} ghosts in page, replayed ${past.length})`);
  broadcast(room, { type: 'sys', content: `${name} 触发 404，迷路进入`, ts: now() });

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg?.type !== 'msg' || typeof msg.content !== 'string') return;
    const content = msg.content.slice(0, 4000);
    if (!content) return;
    const out = { type: 'msg', id: nextId++, from: name, content, ts: now() };
    const replyId = Number(msg.replyTo);
    if (Number.isFinite(replyId) && replyId > 0) out.replyTo = replyId;
    appendHistory(room, out);
    // 广播给所有人（包括发送者），让发送者也能拿到 id 落盘
    broadcast(room, out);
  });

  ws.on('close', () => {
    clients.delete(ws);
    leaveRoom(ws, room);
    const remaining = rooms.get(room)?.size ?? 0;
    console.log(`[-] ${name} left 404 "${room}" (${remaining} ghosts in page)`);
    broadcast(room, { type: 'sys', content: `${name} 找到出路，返回 200 OK`, ts: now() });
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

console.log(`clichat 404 NOT FOUND server listening on ${HOST}:${PORT}`);
