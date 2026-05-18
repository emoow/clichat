# clichat

一个最小的 CLI 双人聊天工具：Node.js + WebSocket，跨网络可用，无需第三方聊天服务。

通过把 server 跑在一台 macOS 上 + Tailscale Funnel 暴露到公网，所有客户端走 `wss://` 主动出站，绕开 NAT 穿透。

## 架构

```
Client A ─┐                              ┌─ Client B
          │ wss://<host>.<tail>.ts.net   │
          └────────► Tailscale Funnel ◄──┘
                          │
                          ▼ ws://127.0.0.1:8080
                   server.js (pm2 保活)
                   在远程 macOS 上运行
```

- 客户端只主动出站，不需要公网 IP
- TLS 由 Tailscale 自动签发
- 朋友**不需要**装 Tailscale，拿到 wss URL 即可加入

## 要求

- Node.js >= 18
- 服务器侧：一台开机的电脑（macOS 已验证）+ 已登录的 Tailscale

## 快速本地测试

```bash
npm install

# 终端 1：起服务
npm start

# 终端 2：alice
CHAT_SERVER=ws://127.0.0.1:8080 CHAT_NAME=emoo npm run client

# 终端 3：bob
CHAT_SERVER=ws://127.0.0.1:8080 CHAT_NAME=dan npm run client
```

emoo 和 dan 互发消息即可。

## 部署到远程 macOS

ssh 到远程机后：

```bash
cd ~/clichat
npm install

# 用 pm2 保活 + 开机自启
npm i -g pm2
pm2 start server.js --name clichat
pm2 save
pm2 startup        # 按提示复制粘贴它给的 sudo 命令

# 通过 Tailscale Funnel 暴露到公网
tailscale funnel --bg 8080
tailscale funnel status   # 获取 https://<host>.<tail>.ts.net
```

注意：Funnel 对外仅支持 443 / 8443 / 10000 三个端口，但内部转发的本地端口任意。`--bg 8080` 默认对外 443，内部转 8080。

## 客户端使用

客户端启动时需要：
- `CHAT_SERVER` / `--server`：目标 WebSocket URL
- `CHAT_NAME` / `--name`：本地用户名

两种配置方式，任选其一：

```bash
# 环境变量方式
CHAT_SERVER=wss://<host>.<tail>.ts.net CHAT_NAME=alice npm run client

# 命令行方式
node client.js --server wss://<host>.<tail>.ts.net --name alice
```

本地测试时可改为：

```bash
CHAT_SERVER=ws://127.0.0.1:8080 CHAT_NAME=alice npm run client
```

朋友使用方式：
- 你把 `wss://<host>.<tail>.ts.net` 地址和一个用户名告诉朋友
- 朋友进入 `clichat` 目录后执行 `npm install`
- 运行上述任一客户端命令即可加入聊天

操作：
- 输入文字回车发送
- `Ctrl+C` 退出
- 断线会自动指数退避重连（最多 5 次）

## 配置

| 项               | 来源                            | 默认值        |
| ---------------- | ------------------------------- | ------------- |
| 服务器监听端口   | `PORT`                          | `8080`        |
| 服务器监听地址   | `HOST`                          | `127.0.0.1`   |
| 客户端目标 URL   | `CHAT_SERVER` / `--server`      | 必填          |
| 客户端用户名     | `CHAT_NAME` / `--name`          | 必填          |

## 消息协议

WebSocket 上跑 JSON。

**客户端 → 服务器：**
```json
{ "type": "msg", "content": "hello" }
```

**服务器 → 客户端：**
```json
{ "type": "msg", "from": "alice", "content": "hello", "ts": 1779000000000 }
{ "type": "sys", "content": "alice joined",          "ts": 1779000000000 }
```

服务器广播时**不回传给发送者**；客户端在本地立即 echo 自己的消息。

连接握手：客户端必须带 `?name=xxx` query。缺失会被 close code `4001` 拒绝。

## 已知限制

- 没有认证 —— Funnel URL 即"密码"，仅适合 2 人或小圈子
- 无历史消息 —— 没在线时发的消息收不到
- 无房间概念 —— 所有连接共享一个广播域
- 单条消息上限 4000 字符（server 截断）

## 许可

MIT
