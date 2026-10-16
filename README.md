# IDX Editor

A lightweight desktop code editor by JJDev Studio, built with Electron + Monaco Editor + xterm.js.

## Features

- **Multi-platform**: Runs on Windows, macOS, and Linux
- **Advanced Code Editor**: Monaco Editor with syntax highlighting, theming (Twilight/Clouds), minimap, and formatting
- **Large File Support**: Files larger than 2 MB open in streaming/range mode without blocking RAM
- **Integrated Terminal**: Full-featured terminal with xterm.js
- **Language Servers**: Uses LSPs already installed on the device (tsserver, pylsp, etc.) with diagnostics in the Problems panel
- **Cache & RAM Management**: Bounded file cache (12 files / 100 MB) with auto-eviction and a RAM status bar
- **Git Integration**: Built-in Git operations (status, add, commit, push, pull)
- **Offline Support**: Service Worker caches CDN resources for offline use
- **Dark/Light Theme**: Toggle between dark and light modes
- **File Explorer**: Sidebar file browsing and management
- **Search**: Integrated file search
- **AGENTS.md**: Project agent-directives panel in the Extensions sidebar

## Installation

```bash
# Clone the repository
git clone https://github.com/Juanoto2012/IDX.git
cd IDX

# Install dependencies
npm install
```

## Development

```bash
# Start the application
npm start
```

## Build

```bash
# Build for your platform
npm run dist
```

The built application will be available in the `dist/` directory.

## Usage

- **Ctrl+O**: Open folder
- **Ctrl+S**: Save current file
- **Shift+Alt+F**: Format code
- **Ctrl+J**: Toggle terminal
- **Ctrl+Z**: Undo / **Ctrl+Y**: Redo
- **Ctrl+F**: Find

## Project Structure

```
IDX/
├── AGENTS.md           # Agent directives for this repository
├── RELEASE_NOTES.md    # Release notes
├── index.html          # Main application window
├── main.js             # Electron main process
├── preload.js          # Preload script for security (contextBridge IPC)
├── splash.html         # Splash screen
├── src/
│   ├── app.js          # Frontend application logic
│   └── app.css         # Application styles
├── assets/
│   ├── logo.svg        # Application logo
│   └── logo.ico        # Application icon
├── docs/
│   └── index.html      # Docs site
└── package.json
```

## Technologies

- [Electron](https://www.electronjs.org/) - Desktop app framework
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - Code editor component
- [xterm.js](https://xtermjs.org/) - Terminal emulator
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- Device-installed Language Servers (LSP) - IntelliSense and diagnostics

## License

MIT License
