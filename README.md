<sub>**English** · [中文](README.zh-CN.md)</sub>

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

> A covert WebSocket chat that masquerades as a 404 page.
> RFC 7231 §6.5.4 on the outside, RFC 6455 on the inside.

`stdin → stdout` only. No GUI, no electron, no telemetry. If your sysadmin greps your packet capture, all they see is `wss://` to a Cloudflare edge.

```sh
$ clichat 404
HTTP/1.1 404 Not Found
The requested URL /chat/404 was not found on this server.

* GET /404 → joined ghost path "404", uid=emoo
[14:23] <neighbor> boss out of range
[14:23] <emoo> ack, milk-tea ballot incoming
> _
```

---

## tl;dr

Two binaries. That's it.

| binary | run by | does |
| --- | --- | --- |
| `clichat-server` | sysop (one human) | spawn local ws server + cloudflared quick tunnel; emit a `wss://` |
| `clichat <path>` | every peer | open ws to `${CHAT_SERVER}?room=<path>&name=<uid>` |

**Same `<path>` ⇒ same broadcast domain.** Different paths are isolated. Multiple cells can coexist.

---

## install (once)

```sh
git clone <repo> clichat
cd clichat
npm install
npm link            # symlinks ./client.js → /usr/local/bin/clichat
                    #          ./bin/clichat-server.js → ...-server
```

`npm link` doesn't need sudo and is reversible (`npm unlink`).

The sysop also needs cloudflared:

```sh
brew install cloudflared
```

---

## protocol (the daily loop)

### step 1 — sysop deploys the void

```sh
clichat-server
```

stdout will spit:

```
🚫 404 NOT FOUND  已部署

  把下面这行发给同事 (复制一整行):

    export CHAT_SERVER=wss://xxxxx-yyyyy-zzzzz.trycloudflare.com

  之后他们就能直接:

    clichat 404     # GET /404
```

ship that `export ...` line over whatever side channel you trust. `^C` to tear it down.

### step 2 — peers join

one-time shell config:

```sh
echo 'export CHAT_SERVER=wss://xxxxx-yyyyy-zzzzz.trycloudflare.com' >> ~/.zshrc
source ~/.zshrc
```

then, from any terminal:

```sh
clichat 404                    # GET /404
clichat 996                    # GET /996 (different broadcast domain)
clichat 404 --name phantom     # override uid (default = $USER)
```

done.

---

## interface

| input | side effect |
| --- | --- |
| any non-`/` line + `\n` | `send {type:msg, content}` |
| `Ctrl+L` | refresh the page (i.e. clear screen — same ANSI as `clear(1)`) |
| `/refresh` `/404` `/clear` | aliases for the above |
| `/new` | spawn local server + tunnel inline, hop to a random `<path>` |
| `Ctrl+C` | `SIGINT` → close ws → exit 0 |

Disconnect ⇒ exponential backoff up to 5 attempts, then `410 Gone`.

---

## status code semantics

We commit to the bit:

| state | code |
| --- | --- |
| client joins | `404` (you found us by not finding us) |
| client leaves | `200 OK` (egress successful) |
| max retries hit | `410 Gone` |
| ws send while disconnected | `503 Service Unavailable` |
| handshake without `name=` | close `4001` |
| handshake without `room=` | close `4002` |

---

## faq

**sysop's box dies. now what?**
Cloudflare quick tunnels are ephemeral. Elect a new sysop, re-run `clichat-server`, broadcast the new `CHAT_SERVER`. Or read "stable deployment" below.

**how do I keep macOS from suspending mid-shift?**
`caffeinate -i &` in a side terminal. `kill %1` when EOD.

**don't want global symlinks?**
`npm run tunnel` (alias of `clichat-server`) and `npm run chat -- 404`.

**is it encrypted?**
`wss://` is TLS. The Cloudflare edge terminates it. Inside, your messages are JSON over WS — same security model as joining any chat by URL share. Not E2E. Don't transmit anything you wouldn't drop into a public Slack.

---

## stable deployment (for sysops who care)

If you have an always-on box, swap quick tunnel for either Tailscale Funnel or a Cloudflare named tunnel. This buys a stable hostname.

```sh
ssh always-on-box
cd ~/clichat && npm install

npm i -g pm2
pm2 start server.js --name clichat
pm2 save
pm2 startup        # paste the sudo line it prints

tailscale funnel --bg 8080
tailscale funnel status   # → https://<host>.<tail>.ts.net
```

Rewrite `https://...ts.net` → `wss://...ts.net` and bake into peers' `CHAT_SERVER`. They don't need Tailscale; only the sysop's box does.

---

## local loopback (no tunnel needed)

Pure dev mode, two terminals:

```sh
# t1
npm run server

# t2
clichat 404

# t3
clichat 404
```

Default `CHAT_SERVER` is `ws://127.0.0.1:8080` — works out of the box.

---

## config surface

| knob | source | default |
| --- | --- | --- |
| listen port | `PORT` | `8080` |
| listen host | `HOST` | `127.0.0.1` |
| ws endpoint | `CHAT_SERVER` / `--server` | `ws://127.0.0.1:8080` |
| 404 path | positional / `CHAT_ROOM` / `--room` | required (will prompt if absent) |
| uid | `CHAT_NAME` / `--name` | `$USER` (`os.userInfo().username`) |

---

## wire format

JSON over WS. Handshake requires `?name=<uid>&room=<path>`.

```js
// client → server
{ type: "msg", content: "hello" }

// server → client
{ type: "msg", from: "alice", content: "hello", ts: 1779000000000 }
{ type: "sys", content: "alice 触发 404，迷路进入", ts: 1779000000000 }
```

Broadcast scope: same room only. Sender does **not** receive its own packet — the client echoes locally for latency parity.

Heartbeat: server pings every 30s; missed pong ⇒ terminate.

---

## known limits

- no auth — knowing `(CHAT_SERVER, path)` ⇒ access. Pick a path with entropy: `x9k2-ghost-404` ≫ `404`.
- path travels in clear text inside the TLS pipe. Don't put secrets in path names.
- no scrollback / history — offline messages are dropped on the floor (`/dev/null`).
- 4000-byte message ceiling (server-side truncate).
- **404 ahead at speed limits**. The author accepts no liability for HR fallout.

---

## license

MIT
