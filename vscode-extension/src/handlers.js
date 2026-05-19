// 命令 handler。当前 A 路线：在集成终端调用 clichat / clichat-server CLI。
// 将来 B 路线：把 join 改成打开 webview 面板（保留命令名和配置项）。

const TERMINAL_CHAT = 'clichat';
const TERMINAL_SERVER = 'clichat-server';

function readConfig(vscode) {
  const c = vscode.workspace.getConfiguration('clichat');
  return {
    serverUrl: c.get('serverUrl', '').trim(),
    defaultRoom: c.get('defaultRoom', '').trim(),
    defaultName: c.get('defaultName', '').trim(),
    cliPath: c.get('cliPath', 'clichat').trim() || 'clichat',
    serverCliPath: c.get('serverCliPath', 'clichat-server').trim() || 'clichat-server',
  };
}

function getOrCreateTerminal(vscode, name, env) {
  const existing = vscode.window.terminals.find(t => t.name === name);
  if (existing) return existing;
  const opts = { name };
  if (env && Object.keys(env).length) opts.env = env;
  return vscode.window.createTerminal(opts);
}

// 简单 shell 转义：仅允许 [\w.-]，否则用单引号包起来
function shellEscape(s) {
  if (/^[\w.-]+$/.test(s)) return s;
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

async function joinRoom(vscode) {
  const cfg = readConfig(vscode);

  const room = await vscode.window.showInputBox({
    prompt: 'Room number',
    value: cfg.defaultRoom,
    placeHolder: 'e.g. 404, 101, mooyu-x9k2',
    ignoreFocusOut: true,
    validateInput: v => (v && v.trim() ? null : 'Room number cannot be empty'),
  });
  if (!room) return; // 用户取消

  const env = {};
  if (cfg.serverUrl) env.CHAT_SERVER = cfg.serverUrl;
  if (cfg.defaultName) env.CHAT_NAME = cfg.defaultName;

  const terminal = getOrCreateTerminal(vscode, TERMINAL_CHAT, env);
  terminal.show();
  terminal.sendText(`${shellEscape(cfg.cliPath)} ${shellEscape(room.trim())}`);
}

async function startServer(vscode) {
  const cfg = readConfig(vscode);
  const terminal = getOrCreateTerminal(vscode, TERMINAL_SERVER);
  terminal.show();
  terminal.sendText(shellEscape(cfg.serverCliPath));
  vscode.window.showInformationMessage(
    'clichat-server starting in terminal. Look for the wss:// URL it prints.'
  );
}

module.exports = { joinRoom, startServer };
