<sub>[English](README.md) · **中文**</sub>

```
   _  _    ___  _  _
  | || |  / _ \| || |
  | || |_| | | | || |_
  |__   _| | | |__   _|
     | | | |_| |  | |
     |_|  \___/   |_|
       NOT  FOUND
```

# clichat — `HTTP/1.1 404 Not Found`

> 一个伪装成 404 页面的隐蔽 WebSocket 聊天工具。
> 外表 RFC 7231 §6.5.4，内核 RFC 6455。

只走 `stdin → stdout`，没有 GUI，没有 electron，没有遥测。同事 / sysadmin 抓你的包，看到的也只是一条到 Cloudflare edge 的 `wss://`。

```sh
$ clichat 404
HTTP/1.1 404 Not Found
The requested URL /chat/404 was not found on this server.

* GET /404 → joined ghost path "404", uid=emoo
[14:23] <neighbor> 老板出去了
[14:23] <emoo> 收到，奶茶投票启动
> _
```

---

## tl;dr

两个二进制，仅此而已。

| 二进制 | 谁来跑 | 干啥 |
| --- | --- | --- |
| `clichat-server` | sysop（一个人） | 起本地 ws server + cloudflared quick tunnel；输出一个 `wss://` |
| `clichat <path>` | 每个 peer | 打开 ws 到 `${CHAT_SERVER}?room=<path>&name=<uid>` |

**path 一致 ⇒ 同一个广播域。** path 不同则互相隔离，多个小组可并行。

---

## install (一次性)

```sh
git clone <repo> clichat
cd clichat
npm install
npm link            # 把 ./client.js → /usr/local/bin/clichat
                    #    ./bin/clichat-server.js → ...-server
```

`npm link` 不需要 sudo，可逆（`npm unlink`）。

sysop 还需要 cloudflared：

```sh
brew install cloudflared
```

---

## protocol (日常循环)

### step 1 — sysop 部署 void

```sh
clichat-server
```

stdout 会吐：

```
🚫 404 NOT FOUND  已部署

  把下面这行发给同事 (复制一整行):

    export CHAT_SERVER=wss://xxxxx-yyyyy-zzzzz.trycloudflare.com

  之后他们就能直接:

    clichat 404     # GET /404
```

把那行 `export ...` 通过你信得过的 side channel 发出去。`^C` 拆掉。

### step 2 — peers 加入

shell 一次性配置：

```sh
echo 'export CHAT_SERVER=wss://xxxxx-yyyyy-zzzzz.trycloudflare.com' >> ~/.zshrc
source ~/.zshrc
```

之后任意终端：

```sh
clichat 404                    # GET /404
clichat 996                    # GET /996（不同的广播域）
clichat 404 --name phantom     # 覆盖 uid（默认是 $USER）
```

完。终端一开就像在看 404 页面，实际在群聊。

---

## interface

| 输入 | 副作用 |
| --- | --- |
| 任意非 `/` 开头的行 + `\n` | `send {type:msg, content}` |
| `Ctrl+L` | 刷新页面（清屏，等同于 `clear(1)` 的 ANSI） |
| `/refresh` `/404` `/clear` | 上面的别名 |
| `/new` | 当场起本地 server + tunnel，跳到一个随机 `<path>` |
| `Ctrl+C` | `SIGINT` → 关 ws → exit 0 |

掉线 ⇒ 指数退避重试至多 5 次，然后 `410 Gone`。

---

## 状态码语义

我们认真的：

| 状态 | 码 |
| --- | --- |
| client 加入 | `404`（你"找不到"我们的时候找到了我们） |
| client 离开 | `200 OK`（egress 成功） |
| 重连耗尽 | `410 Gone` |
| 断线时发消息 | `503 Service Unavailable` |
| 握手没带 `name=` | close `4001` |
| 握手没带 `room=` | close `4002` |

---

## faq

**sysop 的机器挂了怎么办？**
Cloudflare quick tunnel 是临时的。换一个 sysop，重跑 `clichat-server`，广播新的 `CHAT_SERVER`。或者参见下面的"长期部署"。

**怎么防 macOS 中途休眠？**
另一个终端 `caffeinate -i &`，下班 `kill %1`。

**不想全局软链？**
`npm run tunnel`（即 `clichat-server`）和 `npm run chat -- 404`。

**有没有加密？**
`wss://` 是 TLS。Cloudflare edge 解 TLS。内层是 WS 上的 JSON —— 安全模型等价于"靠 URL 共享加入聊天"。**不是端到端**。不要传任何你不会丢到公开 Slack 里的内容。

---

## 长期部署 (给在意稳定性的 sysop)

如果你有一台常开的机器，把 quick tunnel 换成 Tailscale Funnel 或 Cloudflare named tunnel，能买来一个稳定 hostname。

```sh
ssh always-on-box
cd ~/clichat && npm install

npm i -g pm2
pm2 start server.js --name clichat
pm2 save
pm2 startup        # 粘贴它打印的 sudo 命令

tailscale funnel --bg 8080
tailscale funnel status   # → https://<host>.<tail>.ts.net
```

把 `https://...ts.net` 改成 `wss://...ts.net`，烧到 peers 的 `CHAT_SERVER` 里。peer 们**不需要** Tailscale；只有 sysop 的机器需要。

---

## 本机 loopback (无需 tunnel)

纯 dev 模式，三个终端：

```sh
# t1
npm run server

# t2
clichat 404

# t3
clichat 404
```

`CHAT_SERVER` 没设时默认 `ws://127.0.0.1:8080`，开箱即用。

---

## config 表

| knob | 来源 | 默认 |
| --- | --- | --- |
| 监听端口 | `PORT` | `8080` |
| 监听地址 | `HOST` | `127.0.0.1` |
| ws endpoint | `CHAT_SERVER` / `--server` | `ws://127.0.0.1:8080` |
| 404 path | 位置参数 / `CHAT_ROOM` / `--room` | 必填（缺则交互问） |
| uid | `CHAT_NAME` / `--name` | `$USER`（`os.userInfo().username`） |

---

## wire format

WS 上跑 JSON。握手必须带 `?name=<uid>&room=<path>`。

```js
// client → server
{ type: "msg", content: "hello" }

// server → client
{ type: "msg", from: "alice", content: "hello", ts: 1779000000000 }
{ type: "sys", content: "alice 触发 404，迷路进入", ts: 1779000000000 }
```

广播范围：仅同 path。发送方**不会**收到自己的包 —— 客户端本地 echo 以保持低延迟体感。

心跳：server 每 30s ping 一次；丢 pong 直接 terminate。

---

## 已知边界

- 没有认证 —— 知道 `(CHAT_SERVER, path)` 即可访问。path 取得有 entropy 一点：`x9k2-ghost-404` 远胜 `404`。
- path 在 TLS 隧道内仍是明文，不要把秘密塞进 path。
- 没有历史/回滚 —— 离线消息直接丢进 `/dev/null`。
- 单条消息 4000 字节上限（server 截断）。
- **404 ahead at speed limits**。作者不为任何 HR 后果负责。

---

## license

MIT
