<sub>[English](README.md) · **中文**</sub>

# clichat

一个命令行聊天工具，从外面看就像一个 404 页面。

约好同一个房间号，大家用同一条命令就进同一个聊天室。没有图形界面，不用注册账号，一行命令就行。

```
$ clichat 404
* 已连接到房间「404」，代号 emoo
[14:23] <隔壁工位> 老板出去了
[14:23] <emoo> 收到，奶茶投票启动
> _
```

---

## 怎么用的

只有两个命令：

| 命令 | 谁跑 | 干什么 |
| --- | --- | --- |
| `clichat-server` | 一个人开一次服 | 起聊天服务器，并通过 Cloudflare Tunnel 暴露到公网，打印一个 URL 让大家用 |
| `clichat <房间号>` | 所有人 | 进对应房间号的聊天室。房间号一样就是同一个聊天 |

不同房间号互相看不到。`101` 房间的人看不到 `202` 房间。

---

## 安装

```sh
git clone <repo> clichat
cd clichat
npm install
npm link            # 把 clichat / clichat-server 软链到全局
```

开服那个人还需要装 cloudflared：

```sh
brew install cloudflared
```

---

## 用法

### 1. 一个人开服

```sh
clichat-server
```

跑起来会看到：

```
✓ 服务器已启动

  把下面这行发给其他人:

    export CHAT_SERVER=wss://一串随机词.trycloudflare.com

  之后他们就能这样进:

    clichat 404
```

复制 `export ...` 那行发给同事就行。`Ctrl+C` 关闭。

### 2. 其他人加入

执行那条 `export` 命令一次（或者写到 `~/.zshrc` 里就不用每次都敲）：

```sh
export CHAT_SERVER=wss://一串随机词.trycloudflare.com
```

之后任意进房间：

```sh
clichat 404              # 进 404 房间
clichat 101              # 进 101 房间（另一个聊天）
clichat 404 --name 老王   # 自定义显示名字
```

不指定 `--name` 时默认用你系统的用户名。

---

## 聊天里的快捷操作

| 操作 | 效果 |
| --- | --- |
| 输入文字回车 | 发送消息 |
| `Ctrl+L` | 清屏 |
| `/clear` `/refresh` `/404` | 同上 |
| `/new` | 当场起一个本地服务并跳到一个随机房间 |
| `Ctrl+C` | 退出 |

掉线会自动重试最多 5 次（间隔指数递增），还连不上就放弃。

---

## 配置项

| 项 | 在哪里设 | 默认值 |
| --- | --- | --- |
| 服务器地址 | `CHAT_SERVER` 环境变量 / `--server` | `ws://127.0.0.1:8080` |
| 房间号 | 命令行第一个参数 / `CHAT_ROOM` / `--room` | 不填会问 |
| 显示名字 | `CHAT_NAME` / `--name` | 系统用户名 |
| 服务器监听端口 | `PORT`（开服那台机器） | `8080` |
| 服务器监听地址 | `HOST`（开服那台机器） | `127.0.0.1` |

---

## 本机测试（不用 Cloudflare）

只在一台机器上玩玩：

```sh
# 终端 1
npm run server

# 终端 2
clichat 404

# 终端 3
clichat 404
```

`CHAT_SERVER` 默认就指向 localhost，开箱即用。

---

## 长期方案

`clichat-server` 用的是 Cloudflare 临时隧道——开服那台机器一旦睡眠或关机，URL 就失效了。

想要稳定的话，把服务器跑在一台常开的机器上，用 Tailscale Funnel 或 Cloudflare 命名隧道暴露：

```sh
# 在常开的机器上
cd ~/clichat && npm install
npm i -g pm2
pm2 start server.js --name clichat
pm2 save
pm2 startup           # 按提示粘贴它给的 sudo 命令

tailscale funnel --bg 8080
tailscale funnel status   # 拿到一个稳定的 https URL
```

把 `https://...` 改成 `wss://...`，这就是大家以后用的 `CHAT_SERVER`。其他人**不需要**装 Tailscale，只有开服的那台需要。

---

## 常见问题

**开服那台 Mac 老是自动休眠？**
另起一个终端跑 `caffeinate -i &`，下班记得 `kill %1` 关掉。

**不想全局安装？**
用 `npm run tunnel` 代替 `clichat-server`，用 `npm run chat -- 404` 代替 `clichat 404`。

**消息加密吗？**
连接走的是 TLS（`wss://`）。Cloudflare 边缘能看到消息内容。没有端到端加密——和"靠 URL 共享加入聊天"是同一种安全级别。别发任何不能丢到公开 Slack 里的内容。

**房间里没人时能正常退出吗？**
能，`Ctrl+C` 始终能干净关闭，即使房间是空的。

---

## 已知限制

- 没有账号、密码。知道服务器 URL 和房间号就能进，重要场合用复杂一点的房间号。
- 没有历史消息。不在线的时候发的消息收不到。
- 单条消息超过 4000 字会被截断。

---

## 许可

MIT
