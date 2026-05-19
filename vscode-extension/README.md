# clichat — VS Code extension

A thin VS Code wrapper around the [clichat](../README.md) command-line tool.
Adds two commands so you can join a room without leaving the editor.

## Prerequisites

This extension shells out to the `clichat` and `clichat-server` CLI binaries —
it does **not** bundle them. Install them first by going to the parent project
and running `npm link`:

```sh
cd ..
npm install
npm link
```

After that, `clichat` and `clichat-server` should be on your `$PATH`. Verify:

```sh
which clichat
which clichat-server
```

If you keep the CLI somewhere non-standard, set `clichat.cliPath` and
`clichat.serverCliPath` in the extension settings.

## Commands

Run from the Command Palette (`Cmd+Shift+P`):

| Command | What it does |
| --- | --- |
| `clichat: Join a room` | Asks for a room number, then runs `clichat <room>` in a terminal |
| `clichat: Start server` | Runs `clichat-server` in a terminal (you'll need cloudflared installed) |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `clichat.serverUrl` | `""` | WebSocket URL (`wss://...`). Empty = use CLI default (`ws://127.0.0.1:8080`). |
| `clichat.defaultRoom` | `""` | Pre-filled in the room prompt. Empty = always ask. |
| `clichat.defaultName` | `""` | Display name. Empty = system username. |
| `clichat.cliPath` | `clichat` | Path to the `clichat` binary. |
| `clichat.serverCliPath` | `clichat-server` | Path to the `clichat-server` binary. |

## Local development

```sh
cd vscode-extension
npm install
```

Open this folder in VS Code, press `F5` to launch an Extension Development
Host. In the new window, open the Command Palette and run `clichat: Join a
room`.

## Packaging and publishing

We use [vsce](https://github.com/microsoft/vscode-vsce).

```sh
# build a .vsix
npm run package
# → clichat-0.1.0.vsix
```

To publish to the VS Code Marketplace:

1. Create a publisher at https://marketplace.visualstudio.com/manage (Microsoft account required).
2. Replace `"publisher": "your-publisher"` in `package.json` with your publisher ID.
3. Generate a Personal Access Token in Azure DevOps with **Marketplace > Manage** scope.
4. Log in: `npx vsce login <your-publisher>`. Paste the token when asked.
5. Publish: `npm run publish`.

That uploads the version in `package.json` and makes it visible on the Marketplace within a few minutes.

## License

MIT
