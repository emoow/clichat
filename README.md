<sub>**English** · [中文](README.zh-CN.md)</sub>

# clichat

A small command-line chat tool that looks like a 404 page from the outside.

Everyone joining the same room number lands in the same chat. There's no GUI, no app, no login — just a terminal command.

```
$ clichat 404
* connected to room "404" as emoo
[14:23] <neighbor> boss is out
[14:23] <emoo> noted, milk-tea poll incoming
> _
```

---

## How it works

There are two commands:

| Command | Who runs it | What it does |
| --- | --- | --- |
| `clichat-server` | One person, once | Starts the chat server and exposes it through Cloudflare Tunnel. Prints a URL to share. |
| `clichat <room>` | Everyone | Joins the given room number. Same number = same chat. |

Different room numbers are isolated — people in room `101` can't see room `202`.

---

## Install

```sh
git clone <repo> clichat
cd clichat
npm install
npm link            # makes `clichat` and `clichat-server` available globally
```

The person running the server also needs cloudflared:

```sh
brew install cloudflared
```

---

## Usage

### 1. One person starts the server

```sh
clichat-server
```

You'll see something like:

```
✓ Server is up

  Send this line to the people you want to chat with:

    export CHAT_SERVER=wss://random-words.trycloudflare.com

  Then they can join with:

    clichat 404
```

Copy that `export ...` line and send it to the others. Press `Ctrl+C` to shut everything down.

### 2. Everyone else joins

Run the `export` line once (or add it to your `~/.zshrc` so you don't have to retype it):

```sh
export CHAT_SERVER=wss://random-words.trycloudflare.com
```

Then join any room:

```sh
clichat 404            # join room 404
clichat 101            # join room 101 (a different chat)
clichat 404 --name jay # use a custom display name
```

The default name is your system username.

---

## In-chat commands

| Action | What it does |
| --- | --- |
| Type text + Enter | Send a message |
| `Ctrl+L` | Clear the screen |
| `/clear` `/refresh` `/404` | Same as Ctrl+L |
| `/new` | Spin up a fresh local server and jump to a random room |
| `Ctrl+C` | Quit |

If the connection drops, the client retries up to 5 times with exponential backoff before giving up.

---

## Configuration

| Setting | Where to set it | Default |
| --- | --- | --- |
| Server URL | `CHAT_SERVER` env var or `--server` | `ws://127.0.0.1:8080` |
| Room number | First argument, or `CHAT_ROOM` env, or `--room` | (asks if missing) |
| Display name | `CHAT_NAME` env or `--name` | system username |
| Server port | `PORT` env (server side) | `8080` |
| Server host | `HOST` env (server side) | `127.0.0.1` |

---

## Local testing (no Cloudflare needed)

If you just want to try it on one machine:

```sh
# Terminal 1
npm run server

# Terminal 2
clichat 404

# Terminal 3
clichat 404
```

The default `CHAT_SERVER` already points at localhost.

---

## Long-term setup

The Cloudflare Quick Tunnel that `clichat-server` uses is temporary — when the host's machine sleeps or shuts down, the URL stops working.

For something more stable, run the server on an always-on machine and expose it through Tailscale Funnel or a Cloudflare named tunnel:

```sh
# On the always-on machine
cd ~/clichat && npm install
npm i -g pm2
pm2 start server.js --name clichat
pm2 save
pm2 startup           # follow the printed instructions

tailscale funnel --bg 8080
tailscale funnel status   # gives you a stable https URL
```

Change `https://...` to `wss://...` and that's your `CHAT_SERVER` from now on. Other people don't need to install Tailscale — only the host does.

---

## FAQ

**The host's laptop keeps sleeping.**
Open another terminal and run `caffeinate -i &`. Run `kill %1` to undo it.

**I don't want to install globally.**
Use `npm run tunnel` instead of `clichat-server`, and `npm run chat -- 404` instead of `clichat 404`.

**Is it encrypted?**
The connection uses TLS (the `wss://`). Cloudflare can see message contents at the edge. There's no end-to-end encryption — treat it like any other URL-based chat. Don't send anything you wouldn't drop into a public Slack channel.

**No one's in the room. Can I still leave?**
Yes — `Ctrl+C` always shuts down cleanly, even when the room is empty.

---

## Limits

- No accounts, no passwords. Anyone with the server URL and a room number can join. Use a hard-to-guess room number for anything sensitive.
- No message history. If you weren't online, you didn't see it.
- Messages over 4000 characters get truncated.

---

## License

MIT
