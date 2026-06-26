# IDX Editor

A modern desktop code editor powered by Ventarys AI, built with Electron.

## Features

- **Multi-platform**: Runs on Windows, macOS, and Linux
- **Advanced Code Editor**: Built with ACE editor for syntax highlighting and code editing
- **Integrated Terminal**: Full-featured terminal with xterm.js
- **Ventarys AI Integration**: AI-powered code assistance via Puter.js
- **Git Integration**: Built-in Git operations (status, add, commit, push, pull)
- **Offline Support**: Service Worker caches CDN resources for offline use
- **Dark/Light Theme**: Toggle between dark and light modes
- **File Explorer**: Sidebar file browsing and management
- **Search**: Integrated file search functionality

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
- **Ctrl+Z**: Undo
- **Ctrl+Y**: Redo

## Project Structure

```
IDX/
├── index.html          # Main application window
├── main.js             # Electron main process
├── preload.js          # Preload script for security
├── splash.html         # Splash screen
├── src/
│   ├── app.js          # Frontend application logic
│   └── app.css         # Application styles
├── assets/
│   ├── logo.svg        # Application logo
│   └── ventarys.png    # AI panel logo
└── package.json
```

## Technologies

- [Electron](https://www.electronjs.org/) - Desktop app framework
- [ACE Editor](https://ace.c9.io/) - Code editor component
- [xterm.js](https://xtermjs.org/) - Terminal emulator
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Puter.js](https://puter.com/) - AI integration

## License

MIT License