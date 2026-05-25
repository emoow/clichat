#!/usr/bin/env node
import WebSocket from 'ws';
import readline from 'node:readline';
import process from 'node:process';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function parseArgs(argv) {
  const out = {};
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--server') out.server = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--room') out.room = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
    else if (!a.startsWith('-')) positional.push(a);
  }
  // 第一个位置参数当作房间号: clichat 101
  if (!out.room && positional[0]) out.room = positional[0];
  return out;
}

const args = parseArgs(process.argv);
if (args.help) {
  console.log('Usage: clichat <404编号> [--name <代号>]');
  console.log('       clichat 101                  # 落入 404 页面 101, 代号取系统用户名');
  console.log('       clichat 101 --name 幽灵访客');
  console.log('');
  console.log('环境变量: CHAT_SERVER (默认 ws://127.0.0.1:8080)');
  process.exit(0);
}

const DEFAULT_SERVER = 'ws://127.0.0.1:8080';
let SERVER = args.server || process.env.CHAT_SERVER || DEFAULT_SERVER;
let ROOM = args.room || process.env.CHAT_ROOM;
let NAME = args.name || process.env.CHAT_NAME;

const DIM = '\x1b[90m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const CLEAR_LINE = '\r\x1b[K';
const UP_ONE = '\x1b[1A';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';

const fmtTime = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));
}

async function bootstrap() {
  // 房间号必须有；没有就交互问
  if (!ROOM) {
    const tmp = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log(`${CYAN}=== 404 NOT FOUND ===${RESET}`);
    console.log(`${DIM}The requested URL was not found on this server.${RESET}`);
    while (!ROOM) {
      ROOM = await ask(tmp, '404 编号 (大家约好用同一个): ');
    }
    tmp.close();
  }
  // 代号没传就用系统用户名，不再追问
  if (!NAME) {
    NAME = os.userInfo().username || 'anon';
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

function printIncoming(line) {
  process.stdout.write(CLEAR_LINE + line + '\n');
  rl.prompt(true);
}

function printOwnEcho(line) {
  process.stdout.write(UP_ONE + CLEAR_LINE + line + '\n');
  rl.prompt();
}

function renderMsg(m) {
  if (m.type === 'msg') return `[${fmtTime(m.ts)}] <${m.from}> ${m.content}`;
  if (m.type === 'sys') return `${DIM}[${fmtTime(m.ts)}] * ${m.content}${RESET}`;
  return null;
}

const HISTORY_DIR = join(os.homedir(), '.clichat');

function ensureHistoryDir() {
  try { fs.mkdirSync(HISTORY_DIR, { recursive: true }); } catch {}
}

function historyFile(room) {
  const safe = String(room).replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(HISTORY_DIR, `${safe}.jsonl`);
}

function loadLocalHistory(room) {
  const file = historyFile(room);
  if (!fs.existsSync(file)) return [];
  const out = [];
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch {}
    }
  } catch {}
  return out;
}

function rewriteLocalHistory(room, messages) {
  const file = historyFile(room);
  const text = messages.length ? messages.map((m) => JSON.stringify(m)).join('\n') + '\n' : '';
  fs.writeFileSync(file, text);
}

function appendLocalMessage(room, msg) {
  try { fs.appendFileSync(historyFile(room), JSON.stringify(msg) + '\n'); } catch {}
}

function maxId(messages) {
  let m = 0;
  for (const x of messages) if (x.id && x.id > m) m = x.id;
  return m;
}

let ws = null;
let attempt = 0;
let stopped = false;
const MAX_ATTEMPTS = 5;
let serverProcess = null;

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_BIN = join(__dirname, 'bin', 'clichat-server.js');

function startLocalServer() {
  return new Promise((resolve, reject) => {
    if (serverProcess) return reject(new Error('local server already started'));
    try {
      serverProcess = spawn('node', [LOCAL_BIN], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      serverProcess = null;
      return reject(err);
    }

    const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
    const EXPORT_RE = /export CHAT_SERVER=(\S+)/;

    function handleOutput(buf) {
      const text = buf.toString();
      process.stderr.write(text);
      const m1 = text.match(EXPORT_RE);
      if (m1) return resolve(m1[1].replace(/^"|"$/g, ''));
      const m2 = text.match(URL_RE);
      if (m2) return resolve(m2[0].replace(/^https/, 'wss'));
    }

    serverProcess.stdout.on('data', handleOutput);
    serverProcess.stderr.on('data', handleOutput);

    serverProcess.on('exit', (code) => {
      serverProcess = null;
      if (code !== 0) reject(new Error(`server exited code=${code}`));
    });
  });
}

function connect() {
  ensureHistoryDir();
  const local = loadLocalHistory(ROOM);
  const lastId = maxId(local);
  const url = new URL(SERVER);
  url.searchParams.set('name', NAME);
  url.searchParams.set('room', ROOM);
  if (lastId) url.searchParams.set('since', String(lastId));
  ws = new WebSocket(url.toString());

  ws.on('open', () => {
    attempt = 0;
    printIncoming(`${DIM}* 已落入 404 页面「${ROOM}」，代号 ${NAME}${RESET}`);
    printIncoming(`${DIM}* 输入文字回车发送  |  Ctrl+L 刷新键清屏  |  Ctrl+C 退出${RESET}`);
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'history') {
      const incoming = Array.isArray(msg.messages) ? msg.messages : [];
      // 用 id 做 key 合并去重，按 ts 排序后整文件重写
      const local2 = loadLocalHistory(ROOM);
      const byId = new Map();
      for (const m of local2) if (m && m.id) byId.set(m.id, m);
      for (const m of incoming) if (m && m.id) byId.set(m.id, m);
      const merged = Array.from(byId.values()).sort((a, b) => (a.ts || 0) - (b.ts || 0));
      rewriteLocalHistory(ROOM, merged);

      if (incoming.length) {
        printIncoming(`${DIM}--- 离线期间 ${incoming.length} 条留言 ---${RESET}`);
        for (const m of incoming) {
          const line = renderMsg(m);
          if (line) printIncoming(line);
        }
        printIncoming(`${DIM}--- 历史回放结束，以下是实时 ---${RESET}`);
      }
      return;
    }

    if (msg.type === 'msg') {
      appendLocalMessage(ROOM, msg);
      // 自己发的消息已经乐观回显过了，不再重复打印
      if (msg.from === NAME) return;
      const line = renderMsg(msg);
      if (line) printIncoming(line);
      return;
    }

    // sys 之类
    const line = renderMsg(msg);
    if (line) printIncoming(line);
  });

  ws.on('close', (code, reason) => {
    if (stopped) return;
    if (code === 4001) {
      console.error('server rejected: name required');
      process.exit(1);
    }
    if (code === 4002) {
      console.error('server rejected: room required');
      process.exit(1);
    }
    attempt++;
    if (attempt > MAX_ATTEMPTS) {
      printIncoming(`${DIM}* 重连 ${MAX_ATTEMPTS} 次都没成功，永久 410 GONE${RESET}`);
      process.exit(1);
    }
    const delay = Math.min(8000, 1000 * 2 ** (attempt - 1));
    const reasonStr = reason?.toString() || '';
    printIncoming(`${DIM}* 连接断开${reasonStr ? ` (${reasonStr})` : ''}，${delay / 1000}s 后重新触发 404...${RESET}`);
    setTimeout(() => { if (!stopped) connect(); }, delay);
  });

  ws.on('error', () => { /* close handler runs after */ });
}

rl.on('line', (raw) => {
  const content = raw.trim();
  if (!content) { rl.prompt(); return; }
  if (content === '/new') {
    printIncoming(`${DIM}* 本地部署一个 404 页面，随机分配编号...${RESET}`);
    startLocalServer().then((wss) => {
      SERVER = wss;
      ROOM = String(Math.floor(Math.random() * 900) + 100); // 100-999
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      printIncoming(`${DIM}* 拿到 404 域名 ${wss}，进入页面 ${ROOM} ...${RESET}`);
      connect();
    }).catch((err) => {
      printIncoming(`${DIM}* 部署 404 失败: ${err.message}${RESET}`);
    }).finally(() => rl.prompt());
    return;
  }
  if (content === '/clear' || content === '/refresh' || content === '/404') {
    process.stdout.write(CLEAR_SCREEN);
    rl.prompt();
    return;
  }
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'msg', content }));
    printOwnEcho(`[${fmtTime(Date.now())}] <${NAME}> ${content}`);
  } else {
    printOwnEcho(`${DIM}* 没连上 (503)，消息没发出去${RESET}`);
  }
});

// 刷新键: Ctrl+L 一键清屏（伪装成空白 404 页面）
process.stdin.on('keypress', (_, key) => {
  if (key && key.ctrl && key.name === 'l') {
    process.stdout.write(CLEAR_SCREEN);
    rl.prompt();
  }
});

rl.on('close', () => {
  stopped = true;
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch {}
    serverProcess = null;
  }
  process.exit(0);
});

bootstrap().then(() => {
  connect();
  rl.prompt();
});
