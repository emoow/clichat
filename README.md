# 🐟 clichat · 打工人摸鱼终端

> 在 IDE 终端里和同事偷偷聊天。约一个房间号，一行命令，进入鱼塘。

```
$ clichat 101
* 已连接到摸鱼室「101」，代号 emoo
[14:23] <隔壁工位> 老板出门了
[14:23] <emoo> 收到，奶茶投票
> _
```

## 核心命令只有两个

| 命令 | 谁来跑 | 作用 |
| --- | --- | --- |
| `clichat-server` | 鱼塘塘主 (一个人) | 开服 + Cloudflare 隧道，拿到 wss URL |
| `clichat <房间号>` | 所有摸鱼人 | 进对应房间号的鱼塘 |

房间号一致 = 同一个鱼塘。不同房间号互相看不到，可以多个小圈子并行。

---

## 安装（一次性）

```bash
git clone <repo> clichat
cd clichat
npm install
npm link            # 让 clichat / clichat-server 全局可用
```

> `npm link` 把 bin 软链到全局，不需要 sudo 也能用。如果你装了 cloudflared 全套就跳过下一步。

塘主额外装 cloudflared（只需要一次，0 配置）：

```bash
brew install cloudflared
```

---

## 用法（每天就这两步）

### 第 1 步：塘主开服（一个人做一次）

```bash
clichat-server
```

跑起来会看到：

```
🐟 摸鱼频道已上线

  把下面这行发给同事 (复制一整行):

    export CHAT_SERVER=wss://xxxxx-yyyyy-zzzzz.trycloudflare.com

  之后他们就能直接:

    clichat 101     # 进 101 房间
```

把那行 `export ...` 发到摸鱼群里就完了。`Ctrl+C` 关闭。

### 第 2 步：所有人加入

第一次配置（写到 `~/.zshrc` / `~/.bashrc` 一次就好）：

```bash
echo 'export CHAT_SERVER=wss://xxxxx-yyyyy-zzzzz.trycloudflare.com' >> ~/.zshrc
source ~/.zshrc
```

之后任意 IDE 终端里：

```bash
clichat 101         # 进 101 房间
clichat 996         # 换房间，进 996 房间
clichat 101 --name 摸鱼小王子   # 自定义代号（默认取系统用户名）
```

完事。

---

## 摸鱼操作要点

| 操作 | 说明 |
| --- | --- |
| 输入文字回车 | 发送消息 |
| `Ctrl+L` | **老板键**，一键清屏伪装 |
| `/clear` 或 `/boss` | 同上 |
| `Ctrl+C` | 退出 |

掉线会自动指数退避重连（最多 5 次）。

---

## 常见问题

**Q: 塘主关电脑了怎么办？**
A: Cloudflare Quick Tunnel 是临时的，关机/睡眠就断。换一个塘主重新 `clichat-server`，把新 URL 发群里更新 `CHAT_SERVER` 即可。

**Q: 想要长期稳定的服务？**
A: 把 server 部署到一台常开的 macOS / 云机，用 Tailscale Funnel 或 Cloudflare Named Tunnel 拿到固定域名，写进 `CHAT_SERVER` 一劳永逸。详见下面"高级部署"。

**Q: 防止 macOS 自动睡眠把塘主电脑搞掉线？**
A: 另起一个终端 `caffeinate -i &`，下班记得 `kill`。

**Q: 不想全局安装 / 不想 npm link？**
A: 可以直接 `npm run tunnel`（=clichat-server）和 `npm run chat -- 101`。

---

## 高级部署（长期稳定的塘主方案）

把 server 跑在一台常开的远程 macOS：

```bash
ssh 你的远程机
cd ~/clichat && npm install

npm i -g pm2
pm2 start server.js --name clichat
pm2 save
pm2 startup        # 按提示复制粘贴它给的 sudo 命令

tailscale funnel --bg 8080
tailscale funnel status   # 拿到 https://<host>.<tail>.ts.net
```

把 `https://...ts.net` 改成 `wss://...ts.net`，写进所有摸鱼人的 `CHAT_SERVER` 即可。同事**不需要**装 Tailscale。

---

## 本机自测

不需要 cloudflared，纯本机两个终端：

```bash
# 终端 1: 起 server
npm run server

# 终端 2: 用户 A
clichat 101

# 终端 3: 用户 B
clichat 101
```

`CHAT_SERVER` 没设的时候默认连 `ws://127.0.0.1:8080`。

---

## 配置一览

| 项 | 来源 | 默认值 |
| --- | --- | --- |
| 服务器监听端口 | `PORT` | `8080` |
| 服务器监听地址 | `HOST` | `127.0.0.1` |
| 客户端目标 URL | `CHAT_SERVER` / `--server` | `ws://127.0.0.1:8080` |
| 房间号 | 位置参数 / `CHAT_ROOM` / `--room` | 必填 (没填会问) |
| 用户名 | `CHAT_NAME` / `--name` | 系统用户名 |

---

## 消息协议

WebSocket 上跑 JSON。握手时必须带 `?name=xxx&room=yyy`，缺 `name` 关闭码 `4001`，缺 `room` 关闭码 `4002`。

```
client → server:  { "type": "msg", "content": "hello" }
server → client:  { "type": "msg", "from": "alice", "content": "hello", "ts": ... }
                  { "type": "sys", "content": "alice 划水进入摸鱼室",   "ts": ... }
```

广播仅限同房间，且不回传给发送者（客户端本地立即 echo）。

---

## 已知限制 & 安全提示

- 没有认证 —— 知道 server URL + 房间号就能进，建议房间号取得复杂一点（`mooyu-x9k2-fish` 比 `101` 安全）
- 房间号是明文传输的，不要在公司监控面前裸聊
- 无历史消息 —— 没在线时发的看不到
- 单条消息上限 4000 字符
- **摸鱼有风险，使用需谨慎**：本工具不对任何工位事故负责

## 许可

MIT
