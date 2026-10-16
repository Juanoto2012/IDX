# Release Notes — JJDev Studio IDX Editor

## v2.0.0 — JJDev Studio Edition

### Rebranding
- Renamed `JNTX Studio` → `JJDev Studio` across the app, splash screen, package metadata, and docs.
- Application product name: `JJDev Studio - IDX Editor`.
- App ID: `com.jjdevstudio.idx`.

### Removed
- **Ventarys AI helper removed**: AI panel, inline AI edits, AI context-menu option, API key providers (AquaDevs/Agnes), custom providers, Puter.js cloud sync, and chat history were removed by design. The editor is now a local-first code editor.

### Large file support
- Files larger than 2 MB are no longer read entirely into RAM. They open in streaming/range mode (first 2 MB loaded, rest on demand) with a toast notification.
- Large files open with minimap disabled and word wrap off to keep the editor responsive.

### Cache & RAM management
- LRU-style cache: at most 12 open files and 100 MB of file contents kept in RAM.
- Oldest inactive files are evicted automatically and shown as "(unloaded)" in tabs; reopen reloads the first chunk.
- RAM monitor in the status bar shows process RSS vs total system memory, with a low-memory warning below 512 MB free.

### Language servers (LSP)
- Detects and spawns language servers already installed on the device over stdio (tsserver / typescript-language-server for JS/TS, pylsp / python-lsp-server / jedi-language-server for Python, plus HTML/CSS/JSON servers).
- LSP `initialize`/`initialized`, `didOpen`/`didChange` notifications and `publishDiagnostics` are handled; diagnostics appear in the Problems panel and status bar.

### UI / Polish
- UI text font switched to **Google Sans** (Ubuntu Sans fallback).
- Status bar: RAM indicator, encoding, language, git branch, update indicator.
- Explorer shows file sizes (KB); tabs show size and dirty/loaded state.
- `AGENTS.md` governance panel: edit/save project agent directives from the Extensions sidebar.
- Splash screen and window titles updated to JJDev Studio.

### Under the hood
- `read-file` supports range reads (`start`/`end`) and reports file size so callers can avoid loading huge files.
- IPC handlers for LSP lifecycle (`lsp-spawn`, `lsp-send`, `lsp-stop`) and memory info (`get-memory-info`).
- Removed dead code: `aceEditor` references, unused activity icons.

## v1.0.1 (previous)
- Fix compiling bugs, HTTP server dev/packaged path fixes, localhost server for assets.
