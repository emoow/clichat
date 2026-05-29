import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(os.homedir(), '.clichat');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const dicts = {
  zh: {
    'language.usage': '用法: /language <zh|en>',
    'language.invalid': '不支持的语言: {locale}（可选: {available}）',
    'language.set': '语言已切换为 {locale}',

    'help.header': '=== 命令一览 ===',
    'help.section.basic': '',
    'help.section.chess': '--- 五子棋 ---',
    'help.section.goldminer': '--- 黄金矿工 ---',
    'help.section.misc': '--- 其他 ---',
    'help.cmd.help': '显示这份清单',
    'help.cmd.reply': '方向键选要引用的消息，Return 确认',
    'help.cmd.cowsay': '用 ASCII 牛把一段话包起来发出去',
    'help.cmd.new': '本机起一个新的 404 页面并跳到随机房间',
    'help.cmd.clear': '清屏（等同 Ctrl+L）',
    'help.cmd.language': '切换界面语言（zh / en）',
    'help.cmd.chess': '发起一局五子棋邀请',
    'help.cmd.join': '加入当前等待中的对局（五子棋 或 黄金矿工）',
    'help.cmd.move': '进入落子模式：方向键挪光标，Return 确认',
    'help.cmd.resign': '认输（对局进行中）',
    'help.cmd.cancel': '取消邀请（仅发起者，pending 状态）',
    'help.cmd.goldminer': '发起一局，等其他人 /join；每人 30s 操作',
    'help.cmd.start': '开始已发起的黄金矿工（仅发起者）',
    'help.cmd.aim': '进入瞄准：钟摆中 Return 放钩，Esc 结束本回合',
    'help.cmd.ctrl_l': '清屏',
    'help.cmd.ctrl_c': '退出',
  },
  en: {
    'language.usage': 'Usage: /language <zh|en>',
    'language.invalid': 'Unsupported locale: {locale} (available: {available})',
    'language.set': 'Language switched to {locale}',

    'help.header': '=== Commands ===',
    'help.section.basic': '',
    'help.section.chess': '--- Gomoku ---',
    'help.section.goldminer': '--- Gold Miner ---',
    'help.section.misc': '--- Misc ---',
    'help.cmd.help': 'Show this list',
    'help.cmd.reply': 'Pick a message to quote with arrow keys, Return to confirm',
    'help.cmd.cowsay': 'Wrap a sentence in an ASCII cow and send it',
    'help.cmd.new': 'Spin up a local 404 page and jump to a random room',
    'help.cmd.clear': 'Clear screen (same as Ctrl+L)',
    'help.cmd.language': 'Switch UI language (zh / en)',
    'help.cmd.chess': 'Start a Gomoku invitation',
    'help.cmd.join': 'Join the pending game (Gomoku or Gold Miner)',
    'help.cmd.move': 'Enter move mode: arrows to move cursor, Return to confirm',
    'help.cmd.resign': 'Resign (during a game)',
    'help.cmd.cancel': 'Cancel the invite (initiator only, pending state)',
    'help.cmd.goldminer': 'Start a session, wait for /join; 30s per player',
    'help.cmd.start': 'Start the pending Gold Miner game (initiator only)',
    'help.cmd.aim': 'Enter aim: Return to drop hook during swing, Esc ends turn',
    'help.cmd.ctrl_l': 'Clear screen',
    'help.cmd.ctrl_c': 'Quit',
  },
};

let current = 'zh';

function loadInitialLocale() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (cfg.locale && dicts[cfg.locale]) current = cfg.locale;
  } catch {}
}

loadInitialLocale();

export function getLocale() {
  return current;
}

export function availableLocales() {
  return Object.keys(dicts);
}

export function setLocale(locale) {
  if (!dicts[locale]) return false;
  current = locale;
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}
    cfg.locale = locale;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  } catch {}
  return true;
}

export function t(key, params) {
  const dict = dicts[current] || dicts.zh;
  let str = dict[key];
  if (str === undefined) str = dicts.zh[key];
  if (str === undefined) str = key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.split(`{${k}}`).join(String(v));
    }
  }
  return str;
}
