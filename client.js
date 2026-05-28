#!/usr/bin/env node
import WebSocket from 'ws';
import readline from 'node:readline';
import process from 'node:process';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encrypt, decrypt, parsePskFromUrl } from './crypto.js';

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
let KEY_BYTES = null;

function applyServerUrl(raw) {
  try {
    const { cleanUrl, keyBytes } = parsePskFromUrl(raw);
    SERVER = cleanUrl;
    KEY_BYTES = keyBytes;
  } catch (err) {
    console.error(`× ${err.message}`);
    console.error(`  跑 clichat-server 拿一条带 #k=... 的 export CHAT_SERVER 行，再试。`);
    process.exit(1);
  }
}

applyServerUrl(SERVER);

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

function cowsay(text) {
  const MAX = 40;
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= MAX) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (!lines.length) lines.push('');

  const width = Math.max(...lines.map((l) => l.length));
  const top = ' ' + '_'.repeat(width + 2);
  const bot = ' ' + '-'.repeat(width + 2);
  let body;
  if (lines.length === 1) {
    body = `< ${lines[0].padEnd(width)} >`;
  } else {
    body = lines.map((l, i) => {
      const p = l.padEnd(width);
      if (i === 0) return `/ ${p} \\`;
      if (i === lines.length - 1) return `\\ ${p} /`;
      return `| ${p} |`;
    }).join('\n');
  }
  const cow = [
    '        \\   ^__^',
    '         \\  (oo)\\_______',
    '            (__)\\       )\\/\\',
    '                ||----w |',
    '                ||     ||',
  ].join('\n');
  return `${top}\n${body}\n${bot}\n${cow}`;
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

function printIncoming(line, msg) {
  if (mode === 'picker' || mode === 'chess-picker') {
    incomingQueue.push({ line, msg });
    return;
  }
  process.stdout.write(CLEAR_LINE + line + '\n');
  trackRender(line, msg);
  rl.prompt(true);
}

function printOwnEcho(line) {
  process.stdout.write(UP_ONE + CLEAR_LINE + line + '\n');
  trackRender(line, null);
  rl.prompt();
}

function renderMsg(m) {
  if (m.type === 'msg') {
    const main = `[${fmtTime(m.ts)}] <${m.from}> ${m.content}`;
    if (m.replyToQuote) {
      const r = m.replyToQuote;
      const quote = `${DIM}  ┌ <${r.from}> ${r.snippet}${RESET}`;
      return `${quote}\n${main}`;
    }
    return main;
  }
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
    let resolved = false;

    // Spinner animation while waiting for tunnel
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIdx = 0;
    const spinnerInterval = setInterval(() => {
      if (resolved) return;
      const frame = frames[frameIdx % frames.length];
      process.stderr.write(`\r${DIM}${frame} Launching server...${RESET}`);
      frameIdx++;
    }, 80);

    function handleOutput(buf) {
      const text = buf.toString();
      // Suppress raw cloudflare output; spinner handles user feedback
      if (resolved) return;
      const m1 = text.match(EXPORT_RE);
      if (m1) {
        resolved = true;
        clearInterval(spinnerInterval);
        process.stderr.write(`\r\x1b[K`);
        return resolve(m1[1].replace(/^"|"$/g, ''));
      }
      const m2 = text.match(URL_RE);
      if (m2) {
        resolved = true;
        clearInterval(spinnerInterval);
        process.stderr.write(`\r\x1b[K`);
        return resolve(m2[0].replace(/^https/, 'wss'));
      }
    }

    serverProcess.stdout.on('data', handleOutput);
    serverProcess.stderr.on('data', handleOutput);

    serverProcess.on('exit', (code) => {
      clearInterval(spinnerInterval);
      process.stderr.write(`\r\x1b[K`);
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
    printIncoming(`${DIM}* 文字回车发送 | /r 引用 | /cowsay | /chess 五子棋 | Ctrl+L 清屏 | Ctrl+C 退出${RESET}`);
    // 从本地历史恢复进行中的五子棋（应付服务端没下发 history 的场景）
    try {
      const localPast = loadLocalHistory(ROOM);
      if (localPast.some((m) => m && m.game)) replayChessFromHistory(localPast);
    } catch {}
  });

  // 解密一条服务端来的 msg：把 ciphertext 替换成明文，挂上 replyToQuote。
  // 解密失败也返回，但 content 用占位文案，避免崩。
  async function decryptInPlace(m) {
    if (m.type !== 'msg' || typeof m.content !== 'string') return m;
    try {
      const plaintext = await decrypt(m.content, KEY_BYTES);
      const parsed = JSON.parse(plaintext);
      m.content = typeof parsed.text === 'string' ? parsed.text : '';
      if (parsed.quote && typeof parsed.quote === 'object') m.replyToQuote = parsed.quote;
      if (parsed.game && typeof parsed.game === 'object') m.game = parsed.game;
    } catch {
      m.content = '<密钥不匹配，无法解密>';
    }
    return m;
  }

  let chain = Promise.resolve();
  ws.on('message', (raw) => {
    chain = chain.then(async () => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'history') {
        const incoming = Array.isArray(msg.messages) ? msg.messages : [];
        for (const m of incoming) await decryptInPlace(m);
        // 用 id 做 key 合并去重，按 ts 排序后整文件重写
        const local2 = loadLocalHistory(ROOM);
        const byId = new Map();
        for (const m of local2) if (m && m.id) byId.set(m.id, m);
        for (const m of incoming) if (m && m.id) byId.set(m.id, m);
        const merged = Array.from(byId.values()).sort((a, b) => (a.ts || 0) - (b.ts || 0));
        rewriteLocalHistory(ROOM, merged);

        if (incoming.length) {
          printIncoming(`${DIM}--- 离线期间 ${incoming.length} 条留言 ---${RESET}`);
          // 按 server id 顺序处理，让 chess reducer 看到正确序列
          const inOrder = incoming.slice().sort((a, b) => (a.id || 0) - (b.id || 0));
          for (const m of inOrder) {
            if (m.game && m.game.kind === 'chess') {
              applyGameEvent(m, false);
              continue;
            }
            const line = renderMsg(m);
            if (line) printIncoming(line, m);
          }
          printIncoming(`${DIM}--- 历史回放结束，以下是实时 ---${RESET}`);
        }
        return;
      }

      if (msg.type === 'msg') {
        await decryptInPlace(msg);
        appendLocalMessage(ROOM, msg);
        // 游戏控制消息：交给 reducer，不当聊天行渲染
        if (msg.game && msg.game.kind === 'chess') {
          applyGameEvent(msg, false);
          return;
        }
        // 自己发的消息已经乐观回显过了，不再重复打印
        if (msg.from === NAME) {
          // 给 echo 时压入的占位条目补上服务端分配的 id
          const pending = pendingOwn.shift();
          if (pending) {
            pending.id = msg.id;
            pending.selectable = true;
          }
          return;
        }
        const line = renderMsg(msg);
        if (line) printIncoming(line, msg);
        return;
      }

      // sys 之类
      const line = renderMsg(msg);
      if (line) printIncoming(line);
    }).catch((err) => {
      console.error(`message handler error: ${err.message}`);
    });
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

const PROMPT_NORMAL = '> ';
const RENDERED_LIMIT = 50;
const REPLY_SNIP_LEN = 80;
const REVERSE = '\x1b[7m';

let mode = 'normal'; // 'normal' | 'picker'
let pendingReplyTo = null; // { id, from, content }
const rendered = []; // 已显示在屏幕上的条目（按顺序），元素 { formatted, height, selectable, id?, from?, content? }
const pendingOwn = []; // 自己发了但还没拿到服务端 id 的条目（按发送顺序）
const incomingQueue = [];
let pickerIndex = -1;
let savedKeypressListeners = [];

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function trackRender(formatted, msg) {
  if (!formatted) return;
  const entry = { formatted, height: formatted.split('\n').length };
  if (msg && msg.type === 'msg' && msg.id) {
    entry.selectable = true;
    entry.id = msg.id;
    entry.from = msg.from;
    entry.content = msg.content;
  }
  rendered.push(entry);
  if (rendered.length > RENDERED_LIMIT) rendered.shift();
}

function markLastAsPendingOwn(content) {
  const own = rendered[rendered.length - 1];
  if (!own) return;
  own.from = NAME;
  own.content = content;
  pendingOwn.push(own);
}

// anchor = picker 状态下 cursor 停泊位置（紧跟在最后一条渲染条目下面）
function rowsToTopOf(idx) {
  let h = 0;
  for (let i = idx; i < rendered.length; i++) h += rendered[i].height;
  return h;
}

function rowsBelowBottomOf(idx) {
  let h = 1; // anchor 比最后一条的底端再下一行
  for (let i = idx + 1; i < rendered.length; i++) h += rendered[i].height;
  return h;
}

function highlightFormat(formatted) {
  return formatted
    .split('\n')
    .map((line) => REVERSE + stripAnsi(line) + RESET)
    .join('\n');
}

function redrawAt(idx, highlighted) {
  const r = rendered[idx];
  const up = rowsToTopOf(idx);
  process.stdout.write(`\x1b[${up}A\r`);
  const text = highlighted ? highlightFormat(r.formatted) : r.formatted;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    process.stdout.write('\x1b[K' + lines[i]);
    if (i < lines.length - 1) process.stdout.write('\n');
  }
  process.stdout.write('\r');
  const down = rowsBelowBottomOf(idx);
  if (down > 0) process.stdout.write(`\x1b[${down}B`);
}

function navigablePrev(from) {
  const rows = process.stdout.rows || 24;
  for (let i = from - 1; i >= 0; i--) {
    if (!rendered[i].selectable) continue;
    if (rowsToTopOf(i) >= rows - 1) return -1; // 翻不上去了
    return i;
  }
  return -1;
}

function navigableNext(from) {
  for (let i = from + 1; i < rendered.length; i++) {
    if (rendered[i].selectable) return i;
  }
  return -1;
}

function pickerKeypress(_, key) {
  if (!key) return;
  if (key.name === 'up') {
    const next = navigablePrev(pickerIndex);
    if (next >= 0) {
      redrawAt(pickerIndex, false);
      pickerIndex = next;
      redrawAt(pickerIndex, true);
    }
  } else if (key.name === 'down') {
    const next = navigableNext(pickerIndex);
    if (next >= 0) {
      redrawAt(pickerIndex, false);
      pickerIndex = next;
      redrawAt(pickerIndex, true);
    }
  } else if (key.name === 'return') {
    exitPicker(true);
  } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
    exitPicker(false);
  }
}

function enterPicker() {
  let start = -1;
  for (let i = rendered.length - 1; i >= 0; i--) {
    if (rendered[i].selectable) { start = i; break; }
  }
  if (start < 0) {
    printIncoming(`${DIM}* 还没消息可以引用${RESET}`);
    return;
  }
  const rows = process.stdout.rows || 24;
  if (rowsToTopOf(start) >= rows - 1) {
    printIncoming(`${DIM}* 屏幕里看不到可引用的消息了${RESET}`);
    return;
  }
  // 抹掉 "> /r" 输入回显，并清掉它下面 readline 重画的空 prompt
  process.stdout.write(UP_ONE + CLEAR_LINE + '\x1b[J');
  mode = 'picker';
  pickerIndex = start;
  savedKeypressListeners = process.stdin.listeners('keypress').slice();
  process.stdin.removeAllListeners('keypress');
  process.stdin.on('keypress', pickerKeypress);
  redrawAt(pickerIndex, true);
}

function exitPicker(confirmed) {
  if (pickerIndex >= 0 && pickerIndex < rendered.length) {
    redrawAt(pickerIndex, false);
  }
  process.stdin.removeListener('keypress', pickerKeypress);
  for (const l of savedKeypressListeners) process.stdin.on('keypress', l);
  savedKeypressListeners = [];
  mode = 'normal';
  if (confirmed && pickerIndex >= 0) {
    const sel = rendered[pickerIndex];
    pendingReplyTo = { id: sel.id, from: sel.from, content: sel.content.slice(0, REPLY_SNIP_LEN) };
    rl.setPrompt(`${CYAN}(回复 ${sel.from})${RESET}> `);
  } else {
    rl.setPrompt(PROMPT_NORMAL);
  }
  pickerIndex = -1;
  while (incomingQueue.length) {
    const item = incomingQueue.shift();
    process.stdout.write(item.line + '\n');
    trackRender(item.line, item.msg);
  }
  rl.prompt();
}

async function sendEncrypted(text, replyTo, game) {
  const payload = {
    text,
    quote: replyTo ? { from: replyTo.from, snippet: replyTo.content } : null,
  };
  if (game) payload.game = game;
  const ciphertext = await encrypt(JSON.stringify(payload), KEY_BYTES);
  const wire = { type: 'msg', content: ciphertext };
  if (replyTo) wire.replyTo = replyTo.id;
  ws.send(JSON.stringify(wire));
}

async function sendGame(game) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    printIncoming(`${DIM}* 没连上 (503)，操作没发出去${RESET}`);
    return;
  }
  try {
    await sendEncrypted('', null, game);
  } catch (err) {
    printIncoming(`${DIM}* 加密失败: ${err.message}${RESET}`);
  }
}

// =================== chess (五子棋) ===================
const BOARD_SIZE = 16;
const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
const COL_LABELS = 'ABCDEFGHIJKLMNOP';
const COLOR_BLACK = 1;
const COLOR_WHITE = 2;
const STONE_BLACK = '●'; // ●
const STONE_WHITE = '○'; // ○
const STONE_EMPTY = '·'; // ·

let chess = null;
// chess shape: { gameId, black, white, board:Uint8Array(256), moves:[{x,y,by,id}],
//   turn:'black'|'white', status:'pending'|'playing'|'finished',
//   winner, winLine, lastBoardIdx, cursor:{x,y} }

const idxOf = (x, y) => y * BOARD_SIZE + x;

function checkWin(board, x, y, color) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dx, dy] of dirs) {
    const line = [{ x, y }];
    for (const s of [-1, 1]) {
      let i = 1;
      while (true) {
        const nx = x + dx * i * s;
        const ny = y + dy * i * s;
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) break;
        if (board[idxOf(nx, ny)] !== color) break;
        line.push({ x: nx, y: ny });
        i++;
      }
    }
    if (line.length >= 5) {
      // Sort along axis so the highlighted line looks nice
      line.sort((a, b) => (a.y - b.y) || (a.x - b.x));
      return line.slice(0, 5);
    }
  }
  return null;
}

function renderChessBoard(g, cursor) {
  if (!g) return '';
  const winSet = new Set();
  if (g.winLine) for (const p of g.winLine) winSet.add(idxOf(p.x, p.y));
  const lines = [];
  // Header
  let header = '   ';
  for (let x = 0; x < BOARD_SIZE; x++) header += ' ' + COL_LABELS[x];
  lines.push(`${DIM}${header}${RESET}`);
  for (let y = 0; y < BOARD_SIZE; y++) {
    const rowLabel = String(y + 1).padStart(2, ' ');
    let row = `${DIM}${rowLabel}${RESET} `;
    for (let x = 0; x < BOARD_SIZE; x++) {
      const v = g.board[idxOf(x, y)];
      let cell = v === COLOR_BLACK ? STONE_BLACK : v === COLOR_WHITE ? STONE_WHITE : STONE_EMPTY;
      if (winSet.has(idxOf(x, y))) cell = `${CYAN}${cell}${RESET}`;
      else if (v === 0) cell = `${DIM}${cell}${RESET}`;
      const isCursor = cursor && cursor.x === x && cursor.y === y;
      if (isCursor) cell = `${REVERSE}${cell}${RESET}`;
      row += (x === 0 ? '' : ' ') + cell;
    }
    lines.push(row);
  }
  // Status footer
  const blackTag = `${STONE_BLACK} ${g.black}`;
  const whiteTag = g.white ? `${STONE_WHITE} ${g.white}` : `${DIM}${STONE_WHITE} 待加入${RESET}`;
  let footer;
  if (g.status === 'pending') {
    footer = `${blackTag}  vs  ${whiteTag}     ${DIM}/join 加入${RESET}`;
  } else if (g.status === 'playing') {
    const turnName = g.turn === 'black' ? `${STONE_BLACK} ${g.black}` : `${STONE_WHITE} ${g.white}`;
    footer = `${blackTag}  vs  ${whiteTag}     轮到 ${turnName}`;
  } else {
    let result;
    if (g.winner) {
      const stone = g.winner === g.black ? STONE_BLACK : STONE_WHITE;
      result = `${CYAN}${stone} ${g.winner} 胜！${RESET}`;
    } else {
      result = `${DIM}平局${RESET}`;
    }
    footer = `${blackTag}  vs  ${whiteTag}     ${result}`;
  }
  lines.push('');
  lines.push(footer);
  return lines.join('\n');
}

function printChessBoard() {
  if (!chess) return;
  const cursor = mode === 'chess-picker' ? chess.cursor : null;
  const formatted = renderChessBoard(chess, cursor);
  if (mode === 'picker') {
    // reply-picker 占着屏幕，不能直接打印（会打乱光标定位）；排队
    incomingQueue.push({ line: formatted, msg: null });
    return;
  }
  // Push as a new rendered entry so it scrolls naturally with the chat log.
  process.stdout.write(CLEAR_LINE + formatted + '\n');
  trackRender(formatted, null);
  chess.lastBoardIdx = rendered.length - 1;
  rl.prompt(true);
}

function redrawBoardInPlace() {
  if (!chess || chess.lastBoardIdx == null) return;
  const idx = chess.lastBoardIdx;
  if (idx < 0 || idx >= rendered.length) return;
  const cursor = mode === 'chess-picker' ? chess.cursor : null;
  const formatted = renderChessBoard(chess, cursor);
  const r = rendered[idx];
  r.formatted = formatted;
  r.height = formatted.split('\n').length;
  const up = rowsToTopOf(idx);
  process.stdout.write(`\x1b[${up}A\r`);
  const lines = formatted.split('\n');
  for (let i = 0; i < lines.length; i++) {
    process.stdout.write('\x1b[K' + lines[i]);
    if (i < lines.length - 1) process.stdout.write('\n');
  }
  process.stdout.write('\r');
  const down = rowsBelowBottomOf(idx);
  if (down > 0) process.stdout.write(`\x1b[${down}B`);
}

function sysLine(text) {
  printIncoming(`${DIM}${text}${RESET}`);
}

function applyGameEvent(msg, silent = false) {
  const g = msg.game;
  if (!g || g.kind !== 'chess') return;
  const by = msg.from;
  const id = msg.id;

  if (g.action === 'invite') {
    if (chess && chess.status !== 'finished') return; // already running, ignore
    chess = {
      gameId: id,
      black: by,
      white: null,
      board: new Uint8Array(BOARD_CELLS),
      moves: [],
      turn: 'black',
      status: 'pending',
      winner: null,
      winLine: null,
      lastBoardIdx: null,
      cursor: { x: 7, y: 7 },
    };
    if (!silent) {
      sysLine(`* ${by} 开了一局五子棋 (id=${id})，输入 /join 加入`);
      sysLine(`*   /join 加入对局 | /m 落子（方向键移动光标，回车确认，Esc 取消）`);
      sysLine(`*   /resign 认输 | /cancel 取消邀请（仅发起者） | 五连即胜`);
    }
    return;
  }

  if (!chess || chess.gameId !== g.gameId) return;

  if (g.action === 'join') {
    if (chess.status !== 'pending') return;
    if (by === chess.black) return;
    chess.white = by;
    chess.status = 'playing';
    chess.turn = 'black';
    if (!silent) {
      sysLine(`* ${by} 加入！${STONE_BLACK} ${chess.black}  vs  ${STONE_WHITE} ${chess.white}，黑先`);
      printChessBoard();
    }
    return;
  }

  if (g.action === 'move') {
    if (chess.status !== 'playing') return;
    const expectedColor = chess.turn === 'black' ? COLOR_BLACK : COLOR_WHITE;
    const expectedName = chess.turn === 'black' ? chess.black : chess.white;
    if (by !== expectedName) return; // not their turn
    const x = Number(g.x);
    const y = Number(g.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return;
    if (chess.board[idxOf(x, y)] !== 0) return;
    chess.board[idxOf(x, y)] = expectedColor;
    chess.moves.push({ x, y, by, id });
    const win = checkWin(chess.board, x, y, expectedColor);
    if (win) {
      chess.winner = by;
      chess.winLine = win;
      chess.status = 'finished';
    } else if (chess.moves.length >= BOARD_CELLS) {
      chess.status = 'finished';
    } else {
      chess.turn = chess.turn === 'black' ? 'white' : 'black';
      // Move cursor near last move for the next player's convenience
      chess.cursor = { x, y };
    }
    if (mode === 'chess-picker') exitChessPicker(false);
    if (!silent) {
      const stone = expectedColor === COLOR_BLACK ? STONE_BLACK : STONE_WHITE;
      const coord = `${COL_LABELS[x]}${y + 1}`;
      sysLine(`* ${stone} ${by} 落子 ${coord}`);
      printChessBoard();
      if (chess.status === 'finished') {
        if (chess.winner) sysLine(`* 五子棋: ${chess.winner} 胜！`);
        else sysLine(`* 五子棋: 平局`);
        chess = null;
      }
    } else if (chess.status === 'finished') {
      // Replay path: keep chess set so caller can render final board, but we won't print here.
    }
    return;
  }

  if (g.action === 'resign') {
    if (chess.status !== 'playing') return;
    if (by !== chess.black && by !== chess.white) return;
    chess.winner = by === chess.black ? chess.white : chess.black;
    chess.status = 'finished';
    if (mode === 'chess-picker') exitChessPicker(false);
    if (!silent) {
      printChessBoard();
      sysLine(`* ${by} 认输，${chess.winner} 胜`);
      chess = null;
    }
    return;
  }

  if (g.action === 'cancel') {
    if (chess.status !== 'pending') return;
    if (by !== chess.black) return;
    if (!silent) sysLine(`* ${by} 取消了五子棋邀请`);
    chess = null;
    return;
  }
}

function replayChessFromHistory(messages) {
  // Reset any current game; messages is the merged sorted history.
  chess = null;
  const sorted = messages
    .filter((m) => m && m.game && m.game.kind === 'chess' && Number.isFinite(m.id))
    .sort((a, b) => a.id - b.id);
  for (const m of sorted) applyGameEvent(m, true);
  if (chess) {
    if (chess.status === 'pending') {
      sysLine(`* 进行中: ${chess.black} 等待对手 /join`);
    } else if (chess.status === 'playing') {
      printChessBoard();
      const turnName = chess.turn === 'black' ? chess.black : chess.white;
      sysLine(`* 五子棋进行中，轮到 ${turnName}`);
    } else if (chess.status === 'finished') {
      printChessBoard();
      if (chess.winner) sysLine(`* 上一局: ${chess.winner} 胜`);
      chess = null;
    }
  }
}

// =================== chess picker (方向键走子) ===================
function enterChessPicker() {
  if (!chess || chess.status !== 'playing') {
    printIncoming(`${DIM}* 当前没有进行中的五子棋${RESET}`);
    return;
  }
  const me = NAME;
  const myTurn = chess.turn === 'black' ? chess.black : chess.white;
  if (myTurn !== me) {
    printIncoming(`${DIM}* 还没轮到你${RESET}`);
    return;
  }
  if (chess.lastBoardIdx == null || chess.lastBoardIdx >= rendered.length) {
    // Board not on screen — print one fresh
    printChessBoard();
  }
  const rows = process.stdout.rows || 24;
  if (rowsToTopOf(chess.lastBoardIdx) >= rows - 1) {
    // Board scrolled off; print fresh one at the bottom
    printChessBoard();
  }
  // Erase the "> /m" echo line and any stray prompt
  process.stdout.write(UP_ONE + CLEAR_LINE + '\x1b[J');
  mode = 'chess-picker';
  savedKeypressListeners = process.stdin.listeners('keypress').slice();
  process.stdin.removeAllListeners('keypress');
  process.stdin.on('keypress', chessPickerKeypress);
  redrawBoardInPlace();
}

function exitChessPicker(confirmed) {
  process.stdin.removeListener('keypress', chessPickerKeypress);
  for (const l of savedKeypressListeners) process.stdin.on('keypress', l);
  savedKeypressListeners = [];
  mode = 'normal';
  // Repaint board without cursor so it sits cleanly above the prompt.
  redrawBoardInPlace();
  if (confirmed && chess && chess.cursor) {
    const { x, y } = chess.cursor;
    sendGame({ kind: 'chess', action: 'move', gameId: chess.gameId, x, y });
  }
  while (incomingQueue.length) {
    const item = incomingQueue.shift();
    process.stdout.write(item.line + '\n');
    trackRender(item.line, item.msg);
  }
  rl.setPrompt(PROMPT_NORMAL);
  rl.prompt();
}

function chessPickerKeypress(_, key) {
  if (!key || !chess) return;
  const c = chess.cursor;
  if (key.name === 'up' && c.y > 0) { c.y--; redrawBoardInPlace(); return; }
  if (key.name === 'down' && c.y < BOARD_SIZE - 1) { c.y++; redrawBoardInPlace(); return; }
  if (key.name === 'left' && c.x > 0) { c.x--; redrawBoardInPlace(); return; }
  if (key.name === 'right' && c.x < BOARD_SIZE - 1) { c.x++; redrawBoardInPlace(); return; }
  if (key.name === 'return') {
    if (chess.board[idxOf(c.x, c.y)] !== 0) return; // occupied: ignore
    exitChessPicker(true);
    return;
  }
  if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
    exitChessPicker(false);
    return;
  }
}
// =================== /chess ===================

rl.on('line', (raw) => {
  const content = raw.trim();

  // /r 进入回复选择模式
  if (content === '/r' || content === '/reply') {
    enterPicker();
    return;
  }

  // 五子棋命令
  if (content === '/chess') {
    if (chess && chess.status !== 'finished') {
      printIncoming(`${DIM}* 已经有一局五子棋在进行（${chess.status}）${RESET}`);
      rl.prompt();
      return;
    }
    sendGame({ kind: 'chess', action: 'invite', gameId: 0 });
    rl.prompt();
    return;
  }
  if (content === '/join') {
    if (!chess || chess.status !== 'pending') {
      printIncoming(`${DIM}* 没有等待加入的五子棋${RESET}`);
      rl.prompt();
      return;
    }
    if (chess.black === NAME) {
      printIncoming(`${DIM}* 你是发起者，不用 /join${RESET}`);
      rl.prompt();
      return;
    }
    sendGame({ kind: 'chess', action: 'join', gameId: chess.gameId });
    rl.prompt();
    return;
  }
  if (content === '/m' || content === '/move') {
    enterChessPicker();
    return;
  }
  if (content === '/resign') {
    if (!chess || chess.status !== 'playing') {
      printIncoming(`${DIM}* 没有正在进行的对局${RESET}`);
      rl.prompt();
      return;
    }
    if (NAME !== chess.black && NAME !== chess.white) {
      printIncoming(`${DIM}* 只有对局双方能认输${RESET}`);
      rl.prompt();
      return;
    }
    sendGame({ kind: 'chess', action: 'resign', gameId: chess.gameId });
    rl.prompt();
    return;
  }
  if (content === '/cancel') {
    if (!chess || chess.status !== 'pending') {
      printIncoming(`${DIM}* 没有可取消的邀请${RESET}`);
      rl.prompt();
      return;
    }
    if (NAME !== chess.black) {
      printIncoming(`${DIM}* 只有发起者能取消${RESET}`);
      rl.prompt();
      return;
    }
    sendGame({ kind: 'chess', action: 'cancel', gameId: chess.gameId });
    rl.prompt();
    return;
  }
  if (content === '/help' || content === '/?') {
    printIncoming(`${DIM}* 命令: /chess /join /m /resign /cancel | /r 引用 | /cowsay | /new | /clear${RESET}`);
    rl.prompt();
    return;
  }

  if (!content) {
    if (pendingReplyTo) {
      pendingReplyTo = null;
      rl.setPrompt(PROMPT_NORMAL);
      printIncoming(`${DIM}* 已取消引用${RESET}`);
      return;
    }
    rl.prompt();
    return;
  }
  if (content === '/new') {
    printIncoming(`${DIM}* 本地部署一个 404 页面，随机分配编号...${RESET}`);
    startLocalServer().then((wss) => {
      applyServerUrl(wss);
      ROOM = String(Math.floor(Math.random() * 900) + 100); // 100-999
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      printIncoming(`${DIM}* 拿到 404 域名 ${SERVER}，进入页面 ${ROOM} ...${RESET}`);
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
  if (content === '/cowsay' || content.startsWith('/cowsay ')) {
    const text = content.slice('/cowsay'.length).trim();
    if (!text) {
      printIncoming(`${DIM}* /cowsay 后面要带句子，比如: /cowsay hello${RESET}`);
      rl.prompt();
      return;
    }
    const bubble = '\n' + cowsay(text);
    if (ws?.readyState === WebSocket.OPEN) {
      sendEncrypted(bubble, null).catch((err) =>
        printIncoming(`${DIM}* 加密失败: ${err.message}${RESET}`)
      );
      printOwnEcho(`[${fmtTime(Date.now())}] <${NAME}>${bubble}`);
      markLastAsPendingOwn(bubble);
    } else {
      printOwnEcho(`${DIM}* 没连上 (503)，消息没发出去${RESET}`);
    }
    return;
  }
  if (ws?.readyState === WebSocket.OPEN) {
    const replySnap = pendingReplyTo;
    sendEncrypted(content, replySnap).catch((err) =>
      printIncoming(`${DIM}* 加密失败: ${err.message}${RESET}`)
    );

    let echo = `[${fmtTime(Date.now())}] <${NAME}> ${content}`;
    if (replySnap) {
      echo = `${DIM}  ┌ <${replySnap.from}> ${replySnap.content}${RESET}\n${echo}`;
      pendingReplyTo = null;
      rl.setPrompt(PROMPT_NORMAL);
    }
    printOwnEcho(echo);
    markLastAsPendingOwn(content);
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
