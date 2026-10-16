# AGENTS.md

This file contains directives for AI agents working on the JJDev Studio - IDX Editor repository.

## Project

IDX Editor is a lightweight desktop code editor built with Electron + Monaco Editor + xterm.js. It is maintained by JJDev Studio (GitHub: Juanoto2012/IDX).

- **Entry point:** `main.js` (Electron main process)
- **Preload:** `preload.js` (contextBridge IPC API exposed to renderer as `window.electronAPI`)
- **Renderer UI:** `index.html` + `src/app.js` + `src/app.css`
- **Splash:** `splash.html`
- **Docs site:** `docs/index.html`
- **Package scripts:** `npm start` (dev), `npm run pack` (dir build), `npm run dist` (Windows NSIS x64)

## Tech stack

- Electron ^33.2.0, node-pty ^1.0.0
- Monaco Editor (CDN 0.45.0), xterm.js (CDN)
- Tailwind CSS (CDN), Remixicon, Devicon
- UI font: Google Sans (with Ubuntu Sans fallback); code font: Consolas/monospace

## Conventions

- No comments added to code unless requested (project rule).
- Keep renderer IPC-bound: all file system, terminal, LSP, and update operations go through `window.electronAPI` -> `ipcMain` handlers in `main.js`.
- Files above `LARGE_FILE_THRESHOLD` (2 MB, main.js) are opened in streaming/range mode, never read fully into RAM.
- Cache: at most `MAX_CACHED_FILES` (12) open files and `MAX_CACHE_SIZE_MB` (100 MB) of contents in RAM; oldest inactive files are evicted and marked "(unloaded)" in tabs.
- Language servers: spawn device-installed LSPs over stdio via `lsp-spawn`/`lsp-send`/`lsp-stop` IPC (Content-Length framed JSON-RPC). Candidates per language are in `LANG_SERVERS` (src/app.js): tsserver for JS/TS, pylsp for python, etc. Diagnostics render in the Problems panel.

## IPC contract (main.js -> preload.js -> renderer)

- `listDirectory(dirPath)`, `read-file({filePath, start, end})`, `write-file(filePath, content)`
- `lsp-spawn({id, command, args, cwd})`, `lsp-send({id, message})`, `lsp-stop({id})`
- `onLspOutput(id, cb)` receives raw stdout chunks; renderer frames Content-Length messages.
- `get-memory-info()` returns heap/rss and total/free memory in MB.
- `check-updates()`, `apply-update({downloadUrl, version})`, `get-app-version()`

## When changing the editor

- Monaco is created with `largeFileOptimizations: true`. For files > 2 MB, minimap is disabled and `wordWrap` is set to `off`.
- Never `fs.readFileSync` a user file without checking its size first.
- Do not re-add AI/chat/providers/Puter integrations — they were removed by design.

## Testing

- `npm install` then `npm start` to run in dev mode.
- Verify large files (>2 MB) open read-only/streamed and the status bar shows RAM usage.
