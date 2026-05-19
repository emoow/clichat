#!/usr/bin/env node
// 一键启动: 本机 server + cloudflared quick tunnel
// 自动抓取 trycloudflare.com URL，转成 wss:// 给同事用

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, '..', 'server.js');
const PORT = process.env.PORT || '8080';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[90m';
const RESET = '\x1b[0m';

function which(cmd) {
  const dirs = (process.env.PATH || '').split(':');
  for (const d of dirs) {
    const p = join(d, cmd);
    if (existsSync(p)) return p;
  }
  return null;
}

if (!which('cloudflared')) {
  console.error(`${YELLOW}× 没找到 cloudflared${RESET}`);
  console.error(`  安装: ${CYAN}brew install cloudflared${RESET}`);
  process.exit(1);
}

if (!existsSync(SERVER_PATH)) {
  console.error(`× server.js not found at ${SERVER_PATH}`);
  process.exit(1);
}

console.log(`${DIM}启动 server (port ${PORT})...${RESET}`);
const server = spawn('node', [SERVER_PATH], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, PORT, HOST: '127.0.0.1' },
});

console.log(`${DIM}启动 cloudflared tunnel...${RESET}`);
const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let urlPrinted = false;
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

function handleTunnelOutput(buf) {
  const text = buf.toString();
  process.stderr.write(`${DIM}${text}${RESET}`);
  if (urlPrinted) return;
  const m = text.match(URL_RE);
  if (m) {
    urlPrinted = true;
    const wss = m[0].replace(/^https/, 'wss');
    const sample = `clichat 101`;
    console.log('');
    console.log(`${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}`);
    console.log(`${GREEN}║${RESET}  ${CYAN}🐟 摸鱼频道已上线${RESET}                                          ${GREEN}║${RESET}`);
    console.log(`${GREEN}╠══════════════════════════════════════════════════════════════╣${RESET}`);
    console.log(`${GREEN}║${RESET}  把下面这行发给同事 (复制一整行):                            ${GREEN}║${RESET}`);
    console.log(`${GREEN}║${RESET}                                                              ${GREEN}║${RESET}`);
    console.log(`    ${YELLOW}export CHAT_SERVER=${wss}${RESET}`);
    console.log(`${GREEN}║${RESET}                                                              ${GREEN}║${RESET}`);
    console.log(`${GREEN}║${RESET}  之后他们就能直接:                                           ${GREEN}║${RESET}`);
    console.log(`${GREEN}║${RESET}                                                              ${GREEN}║${RESET}`);
    console.log(`    ${YELLOW}${sample}${RESET}     ${DIM}# 进 101 房间${RESET}`);
    console.log(`${GREEN}║${RESET}                                                              ${GREEN}║${RESET}`);
    console.log(`${GREEN}║${RESET}  ${DIM}Ctrl+C 关闭 server 和 tunnel${RESET}                                ${GREEN}║${RESET}`);
    console.log(`${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}`);
    console.log('');

    // 也帮自己 export 到当前进程，让本机直接用 clichat 也能连上 wss
    process.env.CHAT_SERVER = wss;
  }
}

tunnel.stdout.on('data', handleTunnelOutput);
tunnel.stderr.on('data', handleTunnelOutput);

function shutdown() {
  console.log(`\n${DIM}收摊，关闭 server + tunnel...${RESET}`);
  try { tunnel.kill('SIGTERM'); } catch {}
  try { server.kill('SIGTERM'); } catch {}
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('exit', (code) => {
  console.error(`${YELLOW}server 退出 (code=${code})${RESET}`);
  shutdown();
});
tunnel.on('exit', (code) => {
  console.error(`${YELLOW}tunnel 退出 (code=${code})${RESET}`);
  shutdown();
});
