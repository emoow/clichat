import WebSocket from 'ws';
import readline from 'node:readline';
import process from 'node:process';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--server') out.server = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv);
if (args.help) {
  console.log('Usage: node client.js --server <ws-url> --name <name>');
  console.log('   or: CHAT_SERVER=<ws-url> CHAT_NAME=<name> node client.js');
  process.exit(0);
}

const SERVER = args.server || process.env.CHAT_SERVER;
const NAME = args.name || process.env.CHAT_NAME;

if (!SERVER || !NAME) {
  console.error('Missing config. Provide --server / --name (or CHAT_SERVER / CHAT_NAME env vars).');
  process.exit(1);
}

const DIM = '\x1b[90m';
const RESET = '\x1b[0m';
const CLEAR_LINE = '\r\x1b[K';
const UP_ONE = '\x1b[1A';

const fmtTime = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

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
  ws = new WebSocket(url.toString());

  ws.on('open', () => {
    attempt = 0;
    printIncoming(`${DIM}* connected to ${SERVER} as ${NAME}${RESET}`);
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
    attempt++;
    if (attempt > MAX_ATTEMPTS) {
      printIncoming(`${DIM}* giving up after ${MAX_ATTEMPTS} retries${RESET}`);
      process.exit(1);
    }
    const delay = Math.min(8000, 1000 * 2 ** (attempt - 1));
    const reasonStr = reason?.toString() || '';
    printIncoming(`${DIM}* disconnected${reasonStr ? ` (${reasonStr})` : ''}, retrying in ${delay / 1000}s...${RESET}`);
    setTimeout(() => { if (!stopped) connect(); }, delay);
  });

  ws.on('error', () => { /* close handler runs after */ });
}

rl.on('line', (raw) => {
  const content = raw.trim();
  if (!content) { rl.prompt(); return; }
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'msg', content }));
    printOwnEcho(`[${fmtTime(Date.now())}] <${NAME}> ${content}`);
  } else {
    printOwnEcho(`${DIM}* not connected, message dropped${RESET}`);
  }
});

rl.on('close', () => {
  stopped = true;
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  process.exit(0);
});

connect();
rl.prompt();
