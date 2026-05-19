// 入口：注册命令并把它们 dispatch 到 handler 模块
// 之所以拆 handler，是为了将来 B 路线（webview 面板）能直接复用这些命令的语义，
// 只需在 handler 里多一个分支或者整体替换实现，不动 manifest 和命令注册。

const vscode = require('vscode');
const { joinRoom, startServer } = require('./src/handlers');

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('clichat.join', () => joinRoom(vscode)),
    vscode.commands.registerCommand('clichat.startServer', () => startServer(vscode)),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
