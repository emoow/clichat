#!/usr/bin/env node
import WebSocket from 'ws';
import readline from 'node:readline';
import process from 'node:process';
import os from 'node:os';

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
  console.log('Usage: clichat <房间号> [--name <代号>]');
  console.log('       clichat 101                  # 进 101 房间, 代号取系统用户名');
  console.log('       clichat 101 --name 摸鱼小王子');
  console.log('');
  console.log('环境变量: CHAT_SERVER (默认 ws://127.0.0.1:8080)');
  process.exit(0);
}

const DEFAULT_SERVER = 'ws://127.0.0.1:8080';
const SERVER = args.server || process.env.CHAT_SERVER || DEFAULT_SERVER;
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
    console.log(`${CYAN}=== 摸鱼频道 (clichat) ===${RESET}`);
    while (!ROOM) {
      ROOM = await ask(tmp, '房间号 (大家约好用同一个): ');
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

let ws = null;
let attempt = 0;
let stopped = false;
const MAX_ATTEMPTS = 5;

function connect() {
  const url = new URL(SERVER);
  url.searchParams.set('name', NAME);
  url.searchParams.set('room', ROOM);
  ws = new WebSocket(url.toString());

  ws.on('open', () => {
    attempt = 0;
    printIncoming(`${DIM}* 已连接到摸鱼室「${ROOM}」，代号 ${NAME}${RESET}`);
    printIncoming(`${DIM}* 输入文字回车发送  |  Ctrl+L 老板键清屏  |  Ctrl+C 退出${RESET}`);
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
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
      printIncoming(`${DIM}* 重连 ${MAX_ATTEMPTS} 次都没成功，鱼塘关门了${RESET}`);
      process.exit(1);
    }
    const delay = Math.min(8000, 1000 * 2 ** (attempt - 1));
    const reasonStr = reason?.toString() || '';
    printIncoming(`${DIM}* 掉线了${reasonStr ? ` (${reasonStr})` : ''}，${delay / 1000}s 后重连...${RESET}`);
    setTimeout(() => { if (!stopped) connect(); }, delay);
  });

  ws.on('error', () => { /* close handler runs after */ });
}

rl.on('line', (raw) => {
  const content = raw.trim();
  if (!content) { rl.prompt(); return; }
  if (content === '/clear' || content === '/boss') {
    process.stdout.write(CLEAR_SCREEN);
    rl.prompt();
    return;
  }
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'msg', content }));
    printOwnEcho(`[${fmtTime(Date.now())}] <${NAME}> ${content}`);
  } else {
    printOwnEcho(`${DIM}* 没连上，消息没发出去${RESET}`);
  }
});

// 老板键: Ctrl+L 一键清屏
process.stdin.on('keypress', (_, key) => {
  if (key && key.ctrl && key.name === 'l') {
    process.stdout.write(CLEAR_SCREEN);
    rl.prompt();
  }
});

rl.on('close', () => {
  stopped = true;
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  process.exit(0);
});

bootstrap().then(() => {
  connect();
  rl.prompt();
});
