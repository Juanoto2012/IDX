    // --- CONSTANTS ---
    const LARGE_FILE_THRESHOLD = 2 * 1024 * 1024; // 2 MB: streamed/range reads above this
    const MAX_READ_CHUNK = 2 * 1024 * 1024;
    const MAX_CACHED_FILES = 12;
    const MAX_CACHE_SIZE_MB = 100;

    // --- GLOBAL STATE ---
    const state = {
        isDarkMode: true,
        activePanelLeft: 'explorer',
        fileSystemRoot: null,
        openFiles: [],   // { path, name, handle, content, size, loaded, isDirty, accessedAt, lang }
        activeFilePath: null,
        activeFileHandle: null,
        isTerminalOpen: false,
        isGitRepo: false,
        gitBranch: '',
        osInfo: null,
        settings: JSON.parse(localStorage.getItem('idx_settings')) || { fontSize: 14, tabSize: 4 },
        outputLines: [],
        outputPanelVisible: false,
        lspClients: new Map(),   // languageId -> LspClient
        diagnostics: new Map(),  // filePath -> []
        memoryInfo: null,
        contextTarget: null
    };

    let monacoEditor = null;
    let xtermInstance = null;
    let xtermFitAddon = null;
    let isEditorUpdating = false;

    // --- LANGUAGE SERVER CONFIG (servers installed on the device) ---
    const LANG_MAP = {
        'js': 'javascript', 'ts': 'typescript', 'jsx': 'javascript', 'tsx': 'typescript',
        'html': 'html', 'css': 'css', 'json': 'json', 'md': 'markdown', 'py': 'python',
        'sh': 'shell', 'ps1': 'powershell', 'bat': 'batch', 'java': 'java', 'c': 'c',
        'cpp': 'cpp', 'h': 'cpp', 'rb': 'ruby', 'go': 'go', 'rs': 'rust', 'php': 'php',
        'sql': 'sql', 'swift': 'swift', 'kt': 'kotlin', 'xml': 'xml', 'yaml': 'yaml', 'yml': 'yaml'
    };

    const LANG_SERVERS = {
        javascript: ['tsserver', 'typescript-language-server'],
        typescript: ['tsserver', 'typescript-language-server'],
        python: ['pylsp', 'python-lsp-server', 'jedi-language-server'],
        html: ['vscode-html-language-server'],
        css: ['vscode-css-language-server'],
        json: ['vscode-json-language-server']
    };

    function pathToUri(p) { return 'file:///' + p.replace(/\\/g, '/'); }
    function uriToPath(u) {
        const p = u.replace(/^file:\/\/\//, '').replace(/\//g, '\\');
        return p;
    }

    class LspClient {
        constructor(id, command, args, cwd, languageId) {
            this.id = id;
            this.command = command;
            this.args = args;
            this.cwd = cwd;
            this.languageId = languageId;
            this.seq = 1;
            this.pending = new Map();
            this.buffer = '';
            this.started = false;
        }

        async start() {
            if (this.started) return;
            const res = await window.electronAPI.lspSpawn(this.id, this.command, this.args, this.cwd);
            if (!res.ok) {
                addOutputLine(`[LSP] ${this.id} start failed: ${res.error}`, 'error');
                return;
            }
            this.started = true;
            window.electronAPI.onLspOutput(this.id, (data) => this.onData(data));
            addOutputLine(`[LSP] ${this.id} started (${this.command})`, 'info');
            try {
                await this.send({ method: 'initialize', params: { processId: null, rootUri: state.fileSystemRoot ? pathToUri(state.fileSystemRoot.path) : null, capabilities: {} } });
                await this.send({ method: 'initialized', params: {} });
            } catch (e) {
                addOutputLine(`[LSP] ${this.id} init skipped: ${e.message}`, 'warning');
            }
        }

        onData(data) {
            this.buffer += data;
            this.processBuffer();
        }

        processBuffer() {
            while (true) {
                const match = this.buffer.match(/^Content-Length:\s*(\d+)\r?\n\r?\n/i);
                if (!match) break;
                const len = parseInt(match[1], 10);
                const headLen = match[0].length;
                if (this.buffer.length < headLen + len) break;
                const body = this.buffer.slice(headLen, headLen + len);
                this.buffer = this.buffer.slice(headLen + len);
                try { this.handleMessage(JSON.parse(body)); } catch (e) { /* ignore bad frame */ }
            }
        }

        send(message) {
            if (message.jsonrpc === undefined) message.jsonrpc = '2.0';
            if (message.id === undefined) message.id = this.seq++;
            return window.electronAPI.lspSend(this.id, message);
        }

        async handleMessage(msg) {
            if (msg.method === 'textDocument/publishDiagnostics') {
                const path = uriToPath(msg.params.uri);
                state.diagnostics.set(path, msg.params.diagnostics || []);
                renderProblems();
                updateProblemsTab();
            }
            const pending = this.pending.get(msg.id);
            if (pending) { pending.resolve(msg); this.pending.delete(msg.id); }
        }

        async openDocument(filePath, languageId, text) {
            if (!this.started) return;
            await this.send({
                method: 'textDocument/didOpen',
                params: { textDocument: { uri: pathToUri(filePath), languageId, version: 1, text } }
            });
        }

        async changeDocument(filePath, version, text) {
            if (!this.started) return;
            await this.send({
                method: 'textDocument/didChange',
                params: { textDocument: { uri: pathToUri(filePath), version }, contentChanges: [{ text }] }
            });
        }

        stop() {
            if (this.started) {
                window.electronAPI.lspStop(this.id);
                this.started = false;
            }
        }
    }

    async function ensureLanguageServer(ext) {
        const languageId = LANG_MAP[ext];
        if (!languageId || state.lspClients.has(languageId)) return;
        const candidates = LANG_SERVERS[languageId];
        if (!candidates) return;
        for (const cmd of candidates) {
            try {
                const client = new LspClient(`lsp-${languageId}`, cmd, [], state.fileSystemRoot ? state.fileSystemRoot.path : os.homedir(), languageId);
                await client.start();
                if (client.started) {
                    state.lspClients.set(languageId, client);
                    addOutputLine(`[LSP] ${languageId}: using ${cmd}`, 'info');
                    return;
                }
            } catch (e) {
                // try next candidate
            }
        }
    }

    // --- CACHE & RAM MANAGEMENT ---
    function cacheSizeBytes() {
        let total = 0;
        for (const f of state.openFiles) if (f.loaded && f.content) total += Buffer.byteLength(f.content, 'utf8');
        return total;
    }

    function evictFromCache() {
        const inactive = state.openFiles.filter(f => f.path !== state.activeFilePath && f.loaded);
        inactive.sort((a, b) => a.accessedAt - b.accessedAt);
        let evicted = 0;
        while ((state.openFiles.length > MAX_CACHED_FILES || cacheSizeBytes() > MAX_CACHE_SIZE_MB * 1024 * 1024) && evicted < inactive.length) {
            const victim = inactive[evicted++];
            victim.content = null;
            victim.loaded = false;
            addOutputLine(`[Cache] Freed RAM: ${victim.name}`, 'info');
        }
        renderTabs();
    }

    function touchFile(path) {
        const f = state.openFiles.find(x => x.path === path);
        if (f) f.accessedAt = Date.now();
    }

    async function loadFileRange(filePath, start, end) {
        const result = await window.electronAPI.readFile(filePath, start, end);
        if (result.error) return { content: '', size: 0 };
        return { content: result.content || '', size: result.size || 0 };
    }

    // --- UTILITIES ---
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const icons = { info: 'ri-information-line', success: 'ri-checkbox-circle-line', warning: 'ri-error-warning-line', error: 'ri-close-circle-line' };
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<i class="${icons[type] || icons.info}"></i><span>${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 200);
        }, 3000);
    }

    function notify(title, body) {
        if (window.electronAPI && window.electronAPI.showNotification) {
            window.electronAPI.showNotification(title, body).catch(() => {});
        }
        showToast(body || title, 'info');
    }

    function addOutputLine(text, type = 'system') {
        const timestamp = new Date().toLocaleTimeString();
        state.outputLines.push({ text, type, timestamp });
        const content = document.getElementById('output-container');
        if (!content) return;
        const line = document.createElement('div');
        line.className = `output-line ${type}`;
        line.textContent = `[${timestamp}] ${text}`;
        content.appendChild(line);
        content.scrollTop = content.scrollHeight;
        const allLines = content.querySelectorAll('.output-line');
        if (allLines.length > 100) {
            Array.from(allLines).slice(0, allLines.length - 100).forEach(l => l.remove());
        }
    }

    // --- MEMORY MONITOR ---
    function startMemoryMonitor() {
        if (!window.electronAPI) return;
        setInterval(async () => {
            try {
                const info = await window.electronAPI.getMemoryInfo();
                state.memoryInfo = info;
                const el = document.getElementById('status-memory');
                if (el) {
                    el.classList.remove('hidden');
                    el.textContent = `RAM: ${info.rss} MB / ${info.totalMemMB} MB`;
                }
                if (info.freeMemMB < 512) addOutputLine('[Memory] Low system memory available', 'warning');
            } catch (e) { /* ignore */ }
        }, 5000);
    }

    // --- INITIALIZATION ---
    document.addEventListener('DOMContentLoaded', async () => {
        setupMenuBar();
        setupThemeToggle();
        setupActivityBar();
        setupNetworkListeners();
        setupTerminalToggle();
        setupKeyboardShortcuts();
        setupWindowControls();
        setupResizers();

        await fetchOsInfo();

        const savedPath = getSavedWorkspacePath();
        if (savedPath) {
            const placeholder = document.getElementById('editor-placeholder');
            if (placeholder) {
                placeholder.innerHTML += `
                    <div class="mt-6 p-3 bg-zinc-200 dark:bg-zinc-800 rounded cursor-pointer hover:bg-zinc-300 dark:hover:bg-zinc-700" onclick="restoreWorkspacePrompt('${savedPath.replace(/'/g, "\\'")}')">
                        <i class="ri-folder-history-line mr-2"></i>Reopen: ${savedPath}
                    </div>`;
            }
        }

        checkForUpdates();
        renderSidebar();
        initMonaco();
        initTerminal();
        setupContextMenu();
        startMemoryMonitor();
        checkLanguageServersOnDemand();
        addOutputLine('[IDX System] Monaco Editor loaded', 'system');
    });

    function checkLanguageServersOnDemand() {
        // Servers are spawned per-language when the first file of that language is opened.
        addOutputLine('[IDX System] Device language-server integration ready', 'system');
    }

    // --- LANGUAGE SERVER HOOK ON FILE OPEN ---
    async function attachLanguageServer(ext) {
        await ensureLanguageServer(ext);
        const languageId = LANG_MAP[ext];
        if (!languageId || !state.activeFilePath || !state.lspClients.has(languageId)) return;
        const client = state.lspClients.get(languageId);
        const f = state.openFiles.find(x => x.path === state.activeFilePath);
        if (f && f.loaded && f.content !== undefined) {
            await client.openDocument(state.activeFilePath, languageId, f.content);
        }
    }

    // --- ELECTRON & OS INTEGRATION ---
    function setupWindowControls() {
        if (window.electronAPI) {
            document.getElementById('btn-win-min').addEventListener('click', () => window.electronAPI.minimize());
            document.getElementById('btn-win-max').addEventListener('click', () => window.electronAPI.maximize());
            document.getElementById('btn-win-close').addEventListener('click', () => window.electronAPI.close());
        }
    }

    async function fetchOsInfo() {
        if (window.electronAPI && window.electronAPI.getOsInfo) {
            state.osInfo = await window.electronAPI.getOsInfo();
            document.getElementById('status-os').textContent = `${state.osInfo.type} (${state.osInfo.shell})`;
        } else {
            document.getElementById('status-os').textContent = 'Web Mode';
        }
    }

    // --- VSCODE LIKE MENUS ---
    function setupMenuBar() {
        const menuBar = document.getElementById('menu-bar');
        let isMenuOpen = false;

        const closeAll = () => {
            document.querySelectorAll('.menu-dropdown').forEach(el => el.classList.remove('show'));
            document.querySelectorAll('.menu-trigger').forEach(el => el.classList.remove('active'));
            isMenuOpen = false;
        };

        document.querySelectorAll('[data-menu]').forEach(container => {
            const trigger = container.querySelector('.menu-trigger');
            const dropdown = container.querySelector('.menu-dropdown');

            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const wasShowing = dropdown.classList.contains('show');
                closeAll();
                if (!wasShowing) {
                    dropdown.classList.add('show');
                    trigger.classList.add('active');
                    isMenuOpen = true;
                }
            });

            trigger.addEventListener('mouseenter', () => {
                if (isMenuOpen && !dropdown.classList.contains('show')) {
                    closeAll();
                    dropdown.classList.add('show');
                    trigger.classList.add('active');
                    isMenuOpen = true;
                }
            });
        });

        document.addEventListener('click', () => closeAll());
    }

    // --- GLOBAL TERMINAL COMMANDS ---
    window.injectTerminalCommand = (cmd) => {
        if (!state.isTerminalOpen) {
            document.getElementById('btn-toggle-term').click();
        }
        const termTab = document.querySelector('.bottom-tab[data-target="terminal-container"]');
        if (termTab) termTab.click();

        if (window.electronAPI) {
            window.electronAPI.terminalInput(cmd + '\r');
        } else if (xtermInstance) {
            xtermInstance.writeln(`\r\n\x1b[33m$ ${cmd}\x1b[0m`);
            xtermInstance.writeln("\x1b[31m[Web Simulation] Command not executed locally.\x1b[0m");
        }
    };

    window.setTerminalCwd = (cwdPath) => {
        if (!window.electronAPI || !cwdPath) return;
        try { window.electronAPI.terminalInput('\x03'); } catch (e) {}
        window.electronAPI.spawnTerminal(cwdPath);
    };

    window.resetTerminalWithPath = (cwdPath) => {
        if (!window.electronAPI || !cwdPath) return;
        try { window.electronAPI.terminalInput('\x03'); } catch (e) {}
        window.electronAPI.spawnTerminalSilent(cwdPath);
    };

    window.promptGitCommit = () => {
        const msg = prompt("Enter commit message:");
        if (msg) {
            injectTerminalCommand(`git commit -m "${msg}"`);
        }
    };

    // --- NETWORK HANDLING ---
    function setupNetworkListeners() {
        const updateOnlineStatus = () => {
            if (!navigator.onLine && location.protocol !== 'file:') {
                document.getElementById('offline-screen').style.display = 'flex';
            } else {
                document.getElementById('offline-screen').style.display = 'none';
            }
        };
        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);
        updateOnlineStatus();
    }

    // --- THEME ---
    function setupThemeToggle() {
        const menuThemeBtn = document.getElementById('menu-toggle-theme');
        if (menuThemeBtn) {
            menuThemeBtn.addEventListener('click', () => {
                state.isDarkMode = !state.isDarkMode;
                document.documentElement.classList.toggle('dark', state.isDarkMode);
                if (monacoEditor) monacoEditor.updateOptions({ theme: state.isDarkMode ? 'vs-dark' : 'vs' });
                if (xtermInstance) xtermInstance.options.theme = getTerminalTheme();
                renderSidebar();
            });
        }
    }

    // --- SIDEBARS AND PANELS ---
    function setupActivityBar() {
        document.querySelectorAll('.activity-icon').forEach(icon => {
            icon.addEventListener('click', (e) => {
                const panel = e.currentTarget.dataset.panel;
                if (panel === 'extensions') {
                    document.querySelectorAll('.left-activity').forEach(i => i.classList.remove('active'));
                    state.activePanelLeft = 'extensions';
                    e.currentTarget.classList.add('active');
                    document.getElementById('sidebar-panel').classList.remove('hidden');
                    document.getElementById('sidebar-title').textContent = 'AGENTS.MD';
                    renderAgentsPanel(document.getElementById('sidebar-content'));
                    return;
                }
                document.querySelectorAll('.left-activity').forEach(i => i.classList.remove('active'));
                if (state.activePanelLeft === panel) {
                    state.activePanelLeft = null;
                    document.getElementById('sidebar-panel').classList.add('hidden');
                } else {
                    state.activePanelLeft = panel;
                    e.currentTarget.classList.add('active');
                    document.getElementById('sidebar-panel').classList.remove('hidden');
                    renderSidebar();
                }
            });
        });
    }

    function renderSidebar() {
        if (!state.activePanelLeft) return;
        const titleEl = document.getElementById('sidebar-title');
        const contentEl = document.getElementById('sidebar-content');

        if (state.activePanelLeft === 'explorer') {
            titleEl.textContent = 'EXPLORER';
            renderExplorer(contentEl);
        } else if (state.activePanelLeft === 'search') {
            titleEl.textContent = 'SEARCH';
            renderSearchPanel(contentEl);
        } else if (state.activePanelLeft === 'git') {
            titleEl.textContent = 'SOURCE CONTROL';
            renderGitPanel(contentEl);
        } else if (state.activePanelLeft === 'settings') {
            titleEl.textContent = 'SETTINGS';
            renderSettingsPanel(contentEl);
        } else {
            titleEl.textContent = state.activePanelLeft.toUpperCase();
            contentEl.innerHTML = '';
        }
    }

    // --- DRAGGABLE PANELS (RESIZERS) ---
    function setupResizers() {
        const sidebar = document.getElementById('sidebar-panel');
        const resizerSidebar = document.getElementById('resizer-sidebar');
        let isResizingSidebar = false;

        resizerSidebar.addEventListener('mousedown', () => {
            isResizingSidebar = true;
            resizerSidebar.classList.add('active');
            document.body.style.cursor = 'col-resize';
        });

        const terminalArea = document.getElementById('terminal-area');
        const resizerTerminal = document.getElementById('resizer-terminal');
        let isResizingTerminal = false;

        resizerTerminal.addEventListener('mousedown', () => {
            isResizingTerminal = true;
            resizerTerminal.classList.add('active');
            document.body.style.cursor = 'row-resize';
        });

        window.addEventListener('mousemove', (e) => {
            if (isResizingSidebar) {
                const newWidth = Math.max(150, Math.min(e.clientX - 56, 800));
                sidebar.style.width = newWidth + 'px';
            }
            if (isResizingTerminal) {
                const containerHeight = document.body.clientHeight;
                const newHeight = Math.max(100, Math.min(containerHeight - e.clientY - 24, containerHeight - 200));
                terminalArea.style.height = newHeight + 'px';
                if (xtermFitAddon) xtermFitAddon.fit();
            }
        });

        window.addEventListener('mouseup', () => {
            isResizingSidebar = false;
            isResizingTerminal = false;
            resizerSidebar.classList.remove('active');
            resizerTerminal.classList.remove('active');
            document.body.style.cursor = 'default';
        });
    }

    // --- LEFT PANELS ---
    function renderSearchPanel(container) {
        container.innerHTML = `
            <div class="p-3 flex flex-col h-full overflow-hidden">
                <input type="text" id="search-input" placeholder="Search files... (Enter)" class="w-full p-2 rounded border focus:outline-none bg-transparent border-zinc-300 dark:border-zinc-700 text-xs font-sans shrink-0">
                <div id="search-results" class="mt-4 flex flex-col gap-2 flex-1 overflow-y-auto pb-4"></div>
            </div>
        `;
        const searchInput = document.getElementById('search-input');
        const resultsContainer = document.getElementById('search-results');

        searchInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const query = searchInput.value.toLowerCase();
                if (!query) return;
                resultsContainer.innerHTML = '<span class="text-xs opacity-50">Searching...</span>';
                if (!state.fileSystemRoot) {
                    resultsContainer.innerHTML = '<span class="text-xs text-red-500">Open a folder first.</span>';
                    return;
                }

                const results = [];
                async function searchFiles(nodes) {
                    for (const node of nodes) {
                        if (node.type === 'file') {
                            try {
                                if (node.size && node.size > 20 * 1024 * 1024) continue; // skip huge files
                                const stat = await window.electronAPI.readFile(node.handle, 0, 512 * 1024);
                                if (stat.error) continue;
                                if (stat.content.toLowerCase().includes(query)) results.push(node);
                            } catch (err) { }
                        } else if (node.type === 'folder' && node.children) {
                            await searchFiles(node.children);
                        }
                    }
                }

                await searchFiles(state.fileSystemRoot.children);
                resultsContainer.innerHTML = '';
                if (results.length === 0) {
                    resultsContainer.innerHTML = '<span class="text-xs opacity-50">No matches found.</span>';
                } else {
                    results.forEach(node => {
                        const div = document.createElement('div');
                        div.className = "text-xs p-2 rounded cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors flex items-center gap-2";
                        div.innerHTML = `<i class="${getFileIcon(node.name)}"></i> <span class="truncate">${node.name}</span>`;
                        div.onclick = () => openFile(node);
                        resultsContainer.appendChild(div);
                    });
                }
            }
        });
    }

    function renderGitPanel(container) {
        if (!state.fileSystemRoot) {
            container.innerHTML = `<div class="p-4 text-center text-xs opacity-70">Open a folder to view source control.</div>`;
            return;
        }

        let gitStatusHTML = `
            <div class="text-xs opacity-60 p-3 border border-dashed border-zinc-300 dark:border-zinc-700 rounded text-center mb-4">
                <i class="ri-git-repository-line text-2xl mb-2 block"></i>
                No Git repository detected in the current folder.
            </div>
        `;
        let quickActionsHTML = '';

        if (state.isGitRepo) {
            gitStatusHTML = `
                <div class="text-xs p-3 border border-blue-500/30 bg-blue-500/10 rounded mb-4">
                    <div class="font-bold text-blue-500 mb-1 flex items-center"><i class="ri-git-repository-fill mr-1"></i> Active Repository</div>
                    <div class="opacity-80 mt-1">Branch: <span class="font-mono bg-zinc-200 dark:bg-zinc-800 px-1 rounded">${state.gitBranch}</span></div>
                </div>
            `;
            quickActionsHTML = `
                <div class="flex flex-col gap-2 mt-4 border-t border-zinc-300 dark:border-zinc-800 pt-4">
                    <span class="text-[10px] font-bold opacity-50 uppercase tracking-wider mb-1">Quick Actions (Terminal)</span>
                    <button onclick="injectTerminalCommand('git status')" class="text-left px-3 py-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-xs flex items-center gap-2 transition-colors"><i class="ri-information-line"></i> git status</button>
                    <button onclick="injectTerminalCommand('git add .')" class="text-left px-3 py-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-xs flex items-center gap-2 transition-colors"><i class="ri-add-circle-line"></i> git add .</button>
                    <button onclick="promptGitCommit()" class="text-left px-3 py-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-xs flex items-center gap-2 transition-colors"><i class="ri-message-3-line"></i> git commit -m "..."</button>
                    <button onclick="injectTerminalCommand('git push')" class="text-left px-3 py-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-xs flex items-center gap-2 transition-colors"><i class="ri-upload-cloud-2-line"></i> git push</button>
                    <button onclick="injectTerminalCommand('git pull')" class="text-left px-3 py-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-xs flex items-center gap-2 transition-colors"><i class="ri-download-cloud-2-line"></i> git pull</button>
                </div>
            `;
        }

        container.innerHTML = `
            <div class="p-3">
                <div class="text-xs font-bold opacity-70 mb-3">SOURCE CONTROL</div>
                ${gitStatusHTML}
                <button class="w-full py-2 bg-blue-600 text-white rounded text-xs font-bold hover:bg-blue-700 transition-colors shadow-sm mb-2" onclick="document.getElementById('btn-toggle-term').click();">Open Native Terminal</button>
                ${quickActionsHTML}
            </div>
        `;
    }

    // --- AGENTS.MD GOVERNANCE PANEL ---
    async function renderAgentsPanel(container) {
        let agentsContent = '';
        let source = 'local';
        if (state.fileSystemRoot && window.electronAPI) {
            try {
                const agentsPath = await window.electronAPI.pathJoin(state.fileSystemRoot.path, 'AGENTS.md');
                const result = await window.electronAPI.readFile(agentsPath);
                if (!result.error) {
                    agentsContent = result.content;
                    source = 'workspace';
                }
            } catch (e) { /* fallback */ }
        }
        if (agentsContent === '') {
            agentsContent = localStorage.getItem('idx_agents_md') || '# AGENTS.md\n\nAdd project-specific agent directives here.';
        }

        container.innerHTML = `
            <div class="p-3 flex flex-col h-full overflow-hidden">
                <div class="mb-2 text-[10px] uppercase font-bold opacity-50">Project guidance file: AGENTS.md</div>
                <span class="text-[10px] opacity-40 mb-1">Source: ${source}</span>
                <textarea id="agents-content" class="flex-1 w-full p-2 rounded border focus:outline-none resize-none bg-transparent border-zinc-300 dark:border-zinc-700 text-xs font-mono" placeholder="# AGENTS.md">${agentsContent}</textarea>
                <div class="mt-2 flex gap-2">
                    <button onclick="saveAgentsMd()" class="flex-1 py-2 bg-zinc-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900 rounded font-bold text-xs hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors shadow-sm">Save AGENTS.md</button>
                    <button onclick="renderAgentsPanel(document.getElementById('sidebar-content'))" class="py-2 px-3 border border-zinc-300 dark:border-zinc-700 rounded text-xs font-bold hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors">Reload</button>
                </div>
            </div>
        `;
    }

    window.saveAgentsMd = async () => {
        const val = document.getElementById('agents-content').value;
        let saved = false;
        if (state.fileSystemRoot && window.electronAPI) {
            try {
                const agentsPath = await window.electronAPI.pathJoin(state.fileSystemRoot.path, 'AGENTS.md');
                await window.electronAPI.writeFile(agentsPath, val);
                saved = true;
            } catch (e) { /* fall back */ }
        }
        if (!saved) {
            localStorage.setItem('idx_agents_md', val);
        }
        const btn = document.querySelector('button[onclick="saveAgentsMd()"]');
        btn.textContent = "Saved!";
        setTimeout(() => btn.textContent = "Save AGENTS.md", 2000);
    };

    function renderSettingsPanel(container) {
        container.innerHTML = `
            <div class="p-3 flex flex-col gap-5 text-xs h-full overflow-y-auto">
                <div class="pb-2 border-b border-zinc-300 dark:border-zinc-800 shrink-0">
                    <h3 class="font-bold mb-3 opacity-80">MONACO EDITOR</h3>
                    <label class="block opacity-70 mb-1">Font Size (px)</label>
                    <input type="number" id="set-font-size" value="${state.settings.fontSize}" class="w-full p-2 rounded border focus:outline-none bg-transparent border-zinc-300 dark:border-zinc-700">
                </div>
                <div class="pb-2 border-b border-zinc-300 dark:border-zinc-800">
                    <label class="block opacity-70 mb-1">Tab Size</label>
                    <input type="number" id="set-tab-size" value="${state.settings.tabSize}" class="w-full p-2 rounded border focus:outline-none bg-transparent border-zinc-300 dark:border-zinc-700">
                </div>
                <button onclick="saveSettings()" class="w-full py-2 bg-zinc-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900 rounded font-bold hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors shadow-sm">Apply Settings</button>

                <div class="pt-4 pb-2 border-b border-zinc-300 dark:border-zinc-800 shrink-0">
                    <h3 class="font-bold mb-3 opacity-80"><i class="ri-memory-line"></i> CACHE & RAM</h3>
                    <span class="text-[10px] opacity-70 block mb-2">Max cached files: <b>${MAX_CACHED_FILES}</b></span>
                    <span class="text-[10px] opacity-70 block mb-2">Max cache size: <b>${MAX_CACHE_SIZE_MB} MB</b></span>
                    <span class="text-[10px] opacity-70 block mb-2">Large file threshold: <b>${(LARGE_FILE_THRESHOLD / 1024 / 1024).toFixed(0)} MB</b></span>
                    <button onclick="evictFromCache()" class="w-full py-2 border border-zinc-500 text-zinc-500 dark:text-zinc-400 rounded font-bold text-xs hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors">Evict Cache Now</button>
                </div>
            </div>
        `;
    }

    window.saveSettings = () => {
        state.settings.fontSize = parseInt(document.getElementById('set-font-size').value) || 14;
        state.settings.tabSize = parseInt(document.getElementById('set-tab-size').value) || 4;
        localStorage.setItem('idx_settings', JSON.stringify(state.settings));
        if (monacoEditor) monacoEditor.updateOptions({ fontSize: state.settings.fontSize, tabSize: state.settings.tabSize });
        const btn = document.querySelector('button[onclick="saveSettings()"]');
        btn.textContent = "Settings Applied!";
        setTimeout(() => btn.textContent = "Apply Settings", 2000);
    };

    // --- LOCAL FILES & GIT HANDLING ---
    async function openLocalFolder(persistPath = null) {
        try {
            let dirPath = null;
            let dirName = null;

            if (persistPath) {
                dirPath = persistPath;
                dirName = await window.electronAPI.pathBasename(persistPath);
            } else if (window.electronAPI) {
                dirPath = await window.electronAPI.openFolderDialog();
                if (!dirPath) return;
                dirName = await window.electronAPI.pathBasename(dirPath);
            } else {
                const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                dirName = dirHandle.name;
                dirPath = dirHandle.name;
            }

            state.openFiles = [];
            state.activeFilePath = null;
            state.activeFileHandle = null;
            state.diagnostics.clear();

            // Reset editor UI so no stale content/tabs from a previous folder leak in
            document.getElementById('editor-placeholder').classList.remove('hidden');
            document.getElementById('monaco-container').classList.add('hidden');
            if (monacoEditor) monacoEditor.setValue('');
            document.getElementById('window-title-file').textContent = '';
            document.getElementById('status-encoding').classList.add('hidden');
            document.getElementById('status-lang').classList.add('hidden');
            renderTabs();

            state.fileSystemRoot = { name: dirName, path: dirPath, handle: dirPath, children: [], isExpanded: true };

            if (window.electronAPI && window.electronAPI.listDirectory) {
                const result = await window.electronAPI.listDirectory(dirPath);
                if (result.error) {
                    alert('Error listing directory: ' + result.error);
                    return;
                }
                result.forEach(entry => {
                    state.fileSystemRoot.children.push({
                        name: entry.name,
                        type: entry.isFile ? 'file' : 'folder',
                        handle: entry.path || dirPath,
                        children: entry.isFile ? null : [],
                        size: entry.size || 0,
                        isExpanded: false
                    });
                });
                state.fileSystemRoot.children.sort((a, b) => {
                    if (a.type === b.type) return a.name.localeCompare(b.name);
                    return a.type === 'folder' ? -1 : 1;
                });
            } else {
                for await (const entry of state.fileSystemRoot.handle.values()) {
                    if (entry.kind === 'file') {
                        state.fileSystemRoot.children.push({ name: entry.name, type: 'file', handle: entry });
                    } else if (entry.kind === 'directory') {
                        state.fileSystemRoot.children.push({ name: entry.name, type: 'folder', handle: entry, children: [], isExpanded: false });
                    }
                }
            }

            renderSidebar();
            saveWorkspacePath(dirPath);

            if (window.electronAPI) {
                window.electronAPI.spawnTerminalSilent(dirPath);
            } else {
                injectTerminalCommand(`cd "${dirPath}"`);
            }

            checkGitStatus(dirPath);
        } catch (err) {
            console.error("[openLocalFolder] Error:", err);
            alert('Error opening folder: ' + err.message);
        }
    }

    function saveWorkspacePath(path) {
        localStorage.setItem('idx_workspace_path', path);
    }

    function getSavedWorkspacePath() {
        return localStorage.getItem('idx_workspace_path');
    }

    window.restoreWorkspacePrompt = async (path) => {
        try {
            await openLocalFolder(path);
        } catch (err) {
            console.warn('Could not restore workspace:', err);
        }
    }

    async function getDirHandleFromPath(pathName) {
        if (window.electronAPI) {
            return await window.electronAPI.getDirectoryHandle(pathName);
        }
        return null;
    }

    async function checkGitStatus(dirPath) {
        try {
            if (window.electronAPI && window.electronAPI.checkGitBranch) {
                const result = await window.electronAPI.checkGitBranch(dirPath);
                if (result.isGitRepo) {
                    document.getElementById('status-git-branch').innerHTML = `<i class="ri-git-branch-line"></i> ${result.branch}`;
                    state.isGitRepo = true;
                    state.gitBranch = result.branch;
                } else {
                    document.getElementById('status-git-branch').innerHTML = `<i class="ri-git-branch-line"></i> No Git`;
                    state.isGitRepo = false;
                    state.gitBranch = null;
                }
                return;
            }
        } catch (e) {
            document.getElementById('status-git-branch').innerHTML = `<i class="ri-git-branch-line"></i> No Git`;
            state.isGitRepo = false;
            state.gitBranch = null;
        }
    }

    async function loadDirectoryContents(dirHandle, childrenArray) {
        if (typeof dirHandle === 'string' && window.electronAPI && window.electronAPI.listDirectory) {
            const result = await window.electronAPI.listDirectory(dirHandle);
            if (!result.error) {
                result.forEach(entry => {
                    childrenArray.push({
                        name: entry.name,
                        type: entry.isFile ? 'file' : 'folder',
                        handle: entry.path || dirHandle,
                        children: entry.isFile ? null : [],
                        size: entry.size || 0,
                        isExpanded: false
                    });
                });
                childrenArray.sort((a, b) => {
                    if (a.type === b.type) return a.name.localeCompare(b.name);
                    return a.type === 'folder' ? -1 : 1;
                });
            }
            return;
        }
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file') {
                childrenArray.push({ name: entry.name, type: 'file', handle: entry });
            } else if (entry.kind === 'directory') {
                childrenArray.push({ name: entry.name, type: 'folder', handle: entry, children: [], isExpanded: false });
            }
        }
        childrenArray.sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'folder' ? -1 : 1;
        });
    }

    function getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        switch (ext) {
            case 'js': return 'devicon-javascript-plain text-yellow-500';
            case 'jsx': return 'devicon-react-original text-blue-400';
            case 'ts': return 'devicon-typescript-plain text-blue-500';
            case 'css': return 'devicon-css3-plain text-blue-300';
            case 'html': return 'devicon-html5-plain text-orange-500';
            case 'json': return 'ri-braces-line text-yellow-500';
            case 'md': return 'ri-markdown-line text-blue-400';
            default: return 'ri-file-text-line opacity-70';
        }
    }

    function renderExplorer(container) {
        container.innerHTML = '';
        if (!state.fileSystemRoot) {
            container.innerHTML = `
                <div class="p-4 text-center text-xs opacity-70 flex flex-col items-center font-sans">
                    <p class="mb-4">No folder is open.</p>
                    <button onclick="openLocalFolder()" class="bg-zinc-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900 px-4 py-2 rounded font-bold hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors w-full shadow-sm">Open Folder</button>
                </div>`;
            return;
        }

        // --- OPEN EDITORS SECTION (VSCode-like) ---
        if (state.openFiles.length > 0) {
            const openEditorsSection = document.createElement('div');
            openEditorsSection.className = 'border-b border-zinc-300 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 shrink-0';
            openEditorsSection.innerHTML = `
                <div class="flex items-center justify-between px-2 py-1 border-b border-zinc-300 dark:border-zinc-800">
                    <span class="text-[10px] font-bold opacity-60 uppercase tracking-wider font-sans">Open Editors</span>
                    <i class="ri-files-line text-xs opacity-40"></i>
                </div>
                <div id="open-editors-list" class="py-1"></div>
            `;
            container.appendChild(openEditorsSection);

            const openEditorsList = document.getElementById('open-editors-list');
            state.openFiles.forEach(file => {
                const isActive = file.path === state.activeFilePath;
                const item = document.createElement('div');
                item.className = `flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-zinc-300 dark:hover:bg-zinc-800 transition-colors truncate ${isActive ? (state.isDarkMode ? 'bg-zinc-800' : 'bg-zinc-200') : ''}`;
                item.innerHTML = `
                    <i class="${getFileIcon(file.name)} text-xs ${file.isDirty ? 'text-yellow-500' : 'opacity-70'}"></i>
                    <span class="text-xs truncate flex-1">${file.name}</span>
                    <i class="ri-close-line text-xs opacity-0 group-hover:opacity-100 hover:bg-zinc-400 dark:hover:bg-zinc-600 rounded-full" onclick="arguments[0].stopPropagation(); closeFileProxy(event, '${file.path.replace(/'/g, "\\'")}')"></i>
                `;
                item.onclick = () => {
                    state.activeFilePath = file.path;
                    state.activeFileHandle = file.handle;
                    openFile(file);
                    document.getElementById('window-title-file').textContent = `- ${file.name}`;
                    renderTabs();
                    renderExplorer(container);
                };
                openEditorsList.appendChild(item);
            });
        }

        const renderTree = (nodes, parentEl, depth = 0) => {
            nodes.forEach(node => {
                const div = document.createElement('div');
                const isActive = state.activeFilePath === node.handle;
                const bgClass = isActive ? (state.isDarkMode ? 'bg-zinc-800' : 'bg-zinc-200') : '';
                div.className = `flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-zinc-300 dark:hover:bg-zinc-800 transition-colors truncate select-none font-mono text-sm ${bgClass}`;
                div.style.paddingLeft = `${(depth * 12) + 12}px`;

                if (node.type === 'folder') {
                    const iconClass = node.isExpanded ? 'ri-folder-open-fill text-yellow-500 dark:text-yellow-400 opacity-90' : 'ri-folder-3-fill text-yellow-500 dark:text-yellow-400 opacity-90';
                    const arrowClass = node.isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line';
                    div.innerHTML = `<i class="${arrowClass} text-[10px] opacity-50"></i><i class="${iconClass}"></i><span>${node.name}</span>`;
                    div.onclick = async (event) => {
                        event.stopPropagation();
                        if (!node.isExpanded) {
                            if (node.children && node.children.length === 0) {
                                const result = await window.electronAPI.listDirectory(node.handle);
                                if (!result.error) {
                                    node.children = result.map(entry => ({
                                        name: entry.name,
                                        type: entry.isFile ? 'file' : 'folder',
                                        handle: entry.path || node.handle,
                                        children: entry.isFile ? null : [],
                                        size: entry.size || 0,
                                        isExpanded: false
                                    }));
                                }
                            }
                            node.isExpanded = true;
                        } else node.isExpanded = false;
                        renderSidebar();
                    };
                } else {
                    const sizeLabel = node.size ? ` (${(node.size / 1024).toFixed(1)} KB)` : '';
                    div.innerHTML = `<i class="ri-checkbox-blank-circle-fill opacity-0 text-[4px] w-[10px]"></i><i class="${getFileIcon(node.name)} text-sm"></i><span>${node.name}</span><span class="text-[10px] opacity-40 ml-1">${sizeLabel}</span>`;
                    div.onclick = async (event) => {
                        event.stopPropagation();
                        openFile({ name: node.name, handle: node.handle, _fullPath: node.handle, size: node.size || 0 });
                    };
                }

                parentEl.appendChild(div);
                if (node.type === 'folder' && node.isExpanded && node.children && node.children.length > 0) renderTree(node.children, parentEl, depth + 1);
            });
        };

        const rootDiv = document.createElement('div');
        rootDiv.className = 'font-bold p-2 text-xs opacity-80 bg-zinc-200 dark:bg-zinc-900 border-b border-zinc-300 dark:border-zinc-800 select-none shrink-0 font-sans';
        rootDiv.innerHTML = `<i class="ri-layout-masonry-line mr-2"></i>${state.fileSystemRoot.name}`;
        container.appendChild(rootDiv);

        const treeContainer = document.createElement('div');
        treeContainer.className = "py-1 flex-1 overflow-y-auto";
        renderTree(state.fileSystemRoot.children, treeContainer);
        container.appendChild(treeContainer);
    }

    async function openFile(fileNode) {
        let filePath = '';
        if (fileNode.path) {
            filePath = fileNode.path;
        } else if (fileNode._fullPath) {
            filePath = fileNode._fullPath;
        } else if (window.electronAPI && fileNode.handle && typeof fileNode.handle === 'string') {
            filePath = await window.electronAPI.pathJoin(fileNode.handle, fileNode.name);
        } else {
            filePath = fileNode.handle || fileNode.name;
        }

        const fileSize = fileNode.size || 0;
        let existing = state.openFiles.find(f => f.path === filePath);
        const tooLarge = fileSize > LARGE_FILE_THRESHOLD;

        if (!existing) {
            let content = null;
            let loaded = false;
            let size = fileSize;

            if (!tooLarge && window.electronAPI && window.electronAPI.readFile) {
                const result = await window.electronAPI.readFile(filePath);
                if (result.error) {
                    return;
                }
                content = result.content;
                size = result.size || size;
                loaded = true;
            } else if (tooLarge && window.electronAPI) {
                const result = await loadFileRange(filePath, 0, MAX_READ_CHUNK);
                content = result.content;
                size = result.size || size;
                loaded = true;
            } else {
                const fileData = await fileNode.handle.getFile();
                content = await fileData.text();
                loaded = true;
            }

            existing = { path: filePath, name: fileNode.name, handle: filePath, content, size, loaded, isDirty: false, accessedAt: Date.now(), lang: fileNode.name.split('.').pop().toLowerCase() };
            state.openFiles.push(existing);
            evictFromCache();
        } else {
            existing.accessedAt = Date.now();
            if (!existing.loaded && window.electronAPI) {
                const result = await loadFileRange(filePath, 0, MAX_READ_CHUNK);
                existing.content = result.content;
                existing.loaded = true;
                existing.size = result.size || existing.size;
            }
        }

        state.activeFilePath = filePath;
        state.activeFileHandle = existing.handle;

        document.getElementById('editor-placeholder').classList.add('hidden');
        document.getElementById('monaco-container').classList.remove('hidden');

        if (monacoEditor) {
            const isLarge = existing.size > LARGE_FILE_THRESHOLD;
            monacoEditor.updateOptions({
                minimap: { enabled: !isLarge },
                wordWrap: isLarge ? 'off' : 'on',
                largeFileOptimizations: true
            });
            monacoEditor.setValue(existing.content || '');
            const ext = existing.name.split('.').pop().toLowerCase();
            monaco.editor.setModelLanguage(monacoEditor.getModel(), LANG_MAP[ext] || 'plaintext');
            await attachLanguageServer(ext);
        }

        document.getElementById('window-title-file').textContent = `- ${existing.name}`;
        const statusEncoding = document.getElementById('status-encoding');
        const statusLang = document.getElementById('status-lang');
        if (statusEncoding) statusEncoding.classList.remove('hidden');
        if (statusLang) statusLang.classList.remove('hidden');
        if (statusLang) statusLang.textContent = existing.name.split('.').pop().toUpperCase();

        renderTabs();
    }

    async function saveCurrentFile() {
        if (!state.activeFilePath) return;
        try {
            const content = monacoEditor ? monacoEditor.getValue() : '';
            if (window.electronAPI && window.electronAPI.writeFile) {
                const result = await window.electronAPI.writeFile(state.activeFilePath, content);
                if (result.error) {
                    console.error('Write file error:', result.error);
                    return;
                }
            }
            const f = state.openFiles.find(x => x.path === state.activeFilePath);
            if (f) {
                f.content = content;
                f.size = Buffer.byteLength(content, 'utf8');
                f.isDirty = false;
            }
            renderTabs();
            document.getElementById('status-encoding').textContent = 'SAVED';
            setTimeout(() => document.getElementById('status-encoding').textContent = 'UTF-8', 1500);
        } catch (err) { console.error(err); }
    }

    window.formatEditorCode = () => {
        if (monacoEditor) {
            monacoEditor.getAction('editor.action.formatDocument').run();
        }
    };

    function setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveCurrentFile(); }
            if (e.ctrlKey && e.key === 'o') { e.preventDefault(); openLocalFolder(); }
            if (e.ctrlKey && e.key === 'j') { e.preventDefault(); document.getElementById('btn-toggle-term').click(); }
            if (e.shiftKey && e.altKey && (e.key === 'f' || e.key === 'F')) {
                e.preventDefault();
                window.formatEditorCode();
            }
        });
    }

    // --- MONACO EDITOR ---
    const monacoThemes = {
        'vs-dark': { theme: 'vs-dark', label: 'Twilight (Dark)' },
        'vs': { theme: 'vs', label: 'Clouds (Light)' }
    };

    function initMonaco() {
        require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
        require(['vs/editor/editor.main'], function () {
            monaco.editor.defineTheme('twilight', {
                base: 'vs-dark',
                inherit: true,
                rules: [
                    { token: 'comment', foreground: '75715E' },
                    { token: 'keyword', foreground: 'AE81FF' },
                    { token: 'string', foreground: 'BC8C8C' },
                    { token: 'number', foreground: 'AE81FF' },
                    { token: 'type', foreground: '66D9EF' },
                    { token: 'variable', foreground: 'F8F8F0' },
                    { token: 'constant', foreground: 'AE81FF' },
                    { token: 'function', foreground: 'A6E22E' },
                    { token: 'type.identifier', foreground: '66D9EF' },
                ],
                colors: {
                    'editor.background': '#141414',
                    'editor.foreground': '#F8F8F2',
                    'editor.lineHighlightBackground': '#3A3A3A',
                    'editorCursor.foreground': '#F8F8F0',
                    'editor.selectionBackground': '#FFFFFF40',
                    'editor.inactiveSelectionBackground': '#FFFFFF20',
                }
            });

            monaco.editor.defineTheme('clouds', {
                base: 'vs',
                inherit: true,
                rules: [
                    { token: 'comment', foreground: '808080' },
                    { token: 'keyword', foreground: '0000FF' },
                    { token: 'string', foreground: 'A50B0B' },
                    { token: 'number', foreground: '009B00' },
                    { token: 'type', foreground: '007000' },
                    { token: 'variable', foreground: '000000' },
                    { token: 'constant', foreground: '0000FF' },
                    { token: 'function', foreground: '0B00A0' },
                ],
                colors: {
                    'editor.background': '#FFFFFF',
                    'editor.foreground': '#000000',
                    'editor.lineHighlightBackground': '#EEEEEE',
                    'editorCursor.foreground': '#000000',
                    'editor.selectionBackground': '#ADD6FF',
                }
            });

            const useDark = document.documentElement.classList.contains('dark');
            const theme = useDark ? 'twilight' : 'clouds';

            monacoEditor = monaco.editor.create(document.getElementById('monaco-container'), {
                value: '',
                language: 'javascript',
                theme,
                fontSize: state.settings.fontSize,
                fontFamily: 'Consolas, "Courier New", monospace',
                tabSize: state.settings.tabSize,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: 'on',
                largeFileOptimizations: true,
                bracketPairColorization: { enabled: true },
                smoothScrolling: true,
                cursorSmoothScrolling: true,
                padding: { top: 16, bottom: 16 },
                renderWhitespace: 'selection',
                suggestOnTriggerCharacters: true,
                quickSuggestions: true,
                folding: true,
                lineNumbers: 'on',
                glyphMargin: false,
                contextmenu: true,
                mouseWheelZoom: true,
                linkedEditing: true,
                formatOnPaste: true,
                formatOnType: true
            });

            monacoEditor.onDidChangeModelContent(() => {
                if (isEditorUpdating) return;
                if (state.activeFilePath) {
                    const f = state.openFiles.find(x => x.path === state.activeFilePath);
                    if (f) {
                        const newVal = monacoEditor.getValue();
                        if (f.content !== newVal) {
                            f.content = newVal;
                            f.size = Buffer.byteLength(newVal, 'utf8');
                            if (!f.isDirty) { f.isDirty = true; renderTabs(); }
                            const ext = f.name.split('.').pop().toLowerCase();
                            const languageId = LANG_MAP[ext];
                            if (languageId && state.lspClients.has(languageId)) {
                                state.lspClients.get(languageId).changeDocument(state.activeFilePath, 2, newVal);
                            }
                        }
                    }
                }
            });

            monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { saveCurrentFile(); });
            monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => { monacoEditor.trigger('keyboard', 'editor.action.undo'); });
            monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => { monacoEditor.trigger('keyboard', 'editor.action.redo'); });
            monacoEditor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => { formatEditorCode(); });
            monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => { monacoEditor.trigger('keyboard', 'editor.action.startFindReplaceAction'); });

            const themeObserver = new MutationObserver(() => updateMonacoTheme());
            themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        });
    }

    function updateMonacoTheme() {
        if (!monacoEditor) return;
        state.isDarkMode = document.documentElement.classList.contains('dark');
        monaco.editor.setTheme(state.isDarkMode ? 'twilight' : 'clouds');
    }

    // --- PROBLEMS / LSP DIAGNOSTICS ---
    function renderProblems() {
        const problemsContainer = document.getElementById('problems-container');
        if (!problemsContainer) return;
        let errors = 0, warnings = 0;
        let html = '<div class="flex flex-col gap-2 pb-4 font-mono">';

        for (const [filePath, diags] of state.diagnostics.entries()) {
            if (diags.length === 0) continue;
            const name = filePath.split(/[\\/]/).pop();
            html += `<div class="text-xs font-bold opacity-70 mb-1 border-b border-zinc-300 dark:border-zinc-800 pb-1">${name}</div>`;
            diags.forEach(d => {
                if (d.severity === 0 || d.severity === 1) errors++;
                if (d.severity === 2) warnings++;
                const colorClass = d.severity === 1 ? 'text-red-500' : 'text-yellow-500';
                const iconClass = d.severity === 1 ? 'ri-error-warning-line' : 'ri-alert-line';
                const range = d.range || { start: { line: 0, character: 0 } };
                html += `
                        <div class="flex gap-2 items-start cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 p-2 rounded transition-colors" onclick="revealDiagnosticElement(this)" data-path="${filePath.replace(/"/g, '&quot;')}" data-line="${range.start.line + 1}" data-column="${range.start.character + 1}">
                        <i class="${iconClass} ${colorClass} mt-0.5 shrink-0"></i>
                        <div class="flex flex-col">
                            <span class="text-xs">${d.message}</span>
                            <span class="text-[10px] opacity-50">Line ${range.start.line + 1}, Col ${range.start.character + 1}</span>
                        </div>
                    </div>`;
            });
        }

        if (html === '<div class="flex flex-col gap-2 pb-4 font-mono">') {
            problemsContainer.innerHTML = `
                <div class="opacity-50 flex flex-col items-center justify-center h-full font-sans">
                    <i class="ri-check-line text-2xl mb-2 text-green-500"></i>
                    No problems detected in workspace.
                </div>`;
            document.getElementById('status-problems').innerHTML = `<i class="ri-error-warning-line"></i> 0 <i class="ri-alert-line ml-1"></i> 0`;
            return;
        }
        html += '</div>';
        problemsContainer.innerHTML = html;
        const statusSpan = document.getElementById('status-problems');
        statusSpan.innerHTML = `<span class="${errors > 0 ? 'text-red-500' : ''}"><i class="ri-error-warning-line"></i> ${errors}</span> <span class="${warnings > 0 ? 'text-yellow-500' : ''}"><i class="ri-alert-line ml-1"></i> ${warnings}</span>`;
    }

    window.revealDiagnosticElement = async (el) => {
    const filePath = el.getAttribute('data-path');
    const line = parseInt(el.getAttribute('data-line'), 10);
    const column = parseInt(el.getAttribute('data-column'), 10);
    await revealDiagnostic(filePath, line, column);
};

window.revealDiagnostic = async (filePath, line, column) => {
        const f = state.openFiles.find(x => x.path === filePath);
        if (!f) {
            return;
        }
        if (!f.loaded) {
            const result = await loadFileRange(filePath, 0, MAX_READ_CHUNK);
            f.content = result.content; f.loaded = true; f.size = result.size || f.size;
        }
        openFile({ name: f.name, handle: f.handle, _fullPath: f.path, size: f.size });
        if (monacoEditor) {
            monacoEditor.revealPositionInCenter({ lineNumber: line, column: column });
        }
    };

    function updateProblemsTab() {
        const problemsContainer = document.getElementById('problems-container');
        if (!problemsContainer) return;
        let errors = 0, warnings = 0;
        state.diagnostics.forEach(diags => {
            diags.forEach(d => {
                if (d.severity === 0 || d.severity === 1) errors++;
                if (d.severity === 2) warnings++;
            });
        });
        if (!document.getElementById('problems-container').classList.contains('hidden')) renderProblems();
        const statusSpan = document.getElementById('status-problems');
        statusSpan.innerHTML = `<span class="${errors > 0 ? 'text-red-500' : ''}"><i class="ri-error-warning-line"></i> ${errors}</span> <span class="${warnings > 0 ? 'text-yellow-500' : ''}"><i class="ri-alert-line ml-1"></i> ${warnings}</span>`;
    }

    function getTerminalTheme() { return { background: state.isDarkMode ? '#09090b' : '#fafafa', foreground: state.isDarkMode ? '#d4d4d8' : '#18181b', cursor: state.isDarkMode ? '#d4d4d8' : '#18181b' }; }

    function initTerminal() {
        xtermInstance = new Terminal({ fontFamily: 'monospace', fontSize: 13, cursorBlink: true, theme: getTerminalTheme(), convertEol: true });
        xtermFitAddon = new FitAddon.FitAddon();
        xtermInstance.loadAddon(xtermFitAddon);
        xtermInstance.open(document.getElementById('terminal-container'));
        xtermFitAddon.fit();

        if (window.electronAPI) {
            xtermInstance.onData(data => window.electronAPI.terminalInput(data));
            window.electronAPI.onTerminalOutput(data => xtermInstance.write(data));
            xtermInstance.onResize(size => window.electronAPI.resizeTerminal(size.cols, size.rows));
            new ResizeObserver(() => xtermFitAddon.fit()).observe(document.getElementById('terminal-container'));
        } else xtermInstance.writeln('\x1b[31m[WARNING] Running in Web Mode. Native Terminal not available.\x1b[0m');
    }

    function setupTerminalToggle() {
        const toggleTerminal = () => {
            state.isTerminalOpen = !state.isTerminalOpen;
            const termArea = document.getElementById('terminal-area');
            if (state.isTerminalOpen) {
                termArea.classList.remove('hidden');
                if (xtermFitAddon) setTimeout(() => xtermFitAddon.fit(), 50);
            } else termArea.classList.add('hidden');
        };
        document.getElementById('btn-toggle-term').addEventListener('click', toggleTerminal);
        document.getElementById('btn-close-term').addEventListener('click', () => {
            state.isTerminalOpen = false;
            document.getElementById('terminal-area').classList.add('hidden');
        });
        document.getElementById('btn-clear-term').addEventListener('click', () => { if (xtermInstance) xtermInstance.clear(); });

        document.querySelectorAll('.bottom-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.bottom-tab').forEach(t => {
                    t.classList.remove('font-bold', 'border-b-2', 'border-zinc-800', 'dark:border-zinc-300', 'text-zinc-900', 'dark:text-zinc-100', 'active');
                    t.classList.add('opacity-70');
                });
                const clickedTab = e.currentTarget;
                clickedTab.classList.add('font-bold', 'border-b-2', 'border-zinc-800', 'dark:border-zinc-300', 'text-zinc-900', 'dark:text-zinc-100', 'active');
                clickedTab.classList.remove('opacity-70');

                ['terminal-container', 'problems-container', 'output-container'].forEach(id => {
                    document.getElementById(id).classList.add('hidden');
                    document.getElementById(id).classList.remove('absolute', 'inset-2');
                });

                const targetId = clickedTab.dataset.target;
                const targetEl = document.getElementById(targetId);
                targetEl.classList.remove('hidden');
                targetEl.classList.add('absolute', 'inset-2');
                if (targetId === 'terminal-container' && xtermFitAddon) setTimeout(() => xtermFitAddon.fit(), 50);
            });
        });
    }

    // --- TABS ---
    function renderTabs() {
        const container = document.getElementById('editor-tabs');
        container.innerHTML = '';
        state.openFiles.forEach(file => {
            const isActive = file.path === state.activeFilePath;
            const bgClass = isActive ? (state.isDarkMode ? 'bg-zinc-900 text-zinc-100' : 'bg-white text-zinc-900 border-b-2 border-b-blue-500') : 'opacity-60 hover:opacity-100 hover:bg-zinc-200 dark:hover:bg-zinc-800';
            const loaded = file.loaded;
            const sizeLabel = file.size ? ` • ${(file.size / 1024).toFixed(1)} KB` : '';
            const unloadedLabel = loaded ? '' : ' <span class="text-[10px] opacity-50">(unloaded)</span>';

            const tab = document.createElement('div');
            tab.className = `flex items-center gap-2 px-3 py-2 min-w-max cursor-pointer border-r border-zinc-300 dark:border-zinc-800 transition-colors group ${bgClass} font-mono text-sm`;
            tab.onclick = () => {
                state.activeFilePath = file.path;
                state.activeFileHandle = file.handle;
                if (monacoEditor) {
                    openFile({ name: file.name, handle: file.handle, _fullPath: file.path, size: file.size });
                }
                document.getElementById('window-title-file').textContent = `- ${file.name}`;
                renderTabs();
            };
            tab.innerHTML = `<i class="${getFileIcon(file.name)}"></i><span>${file.name}${sizeLabel}${unloadedLabel}</span>${file.isDirty ? ' <span class="text-yellow-500">●</span>' : ''}<i class="ri-close-line ml-2 opacity-100 group-hover:opacity-100 hover:bg-zinc-400 dark:hover:bg-zinc-600 rounded-full" onclick="arguments[0].stopPropagation(); closeFileProxy(event, '${file.path.replace(/'/g, "\\'")}')"></i>`;
            container.appendChild(tab);
        });
    }

    window.closeFileProxy = (e, filePath) => {
        const idx = state.openFiles.findIndex(f => f.path === filePath);
        if (idx > -1) {
            state.openFiles.splice(idx, 1);
            if (state.activeFilePath === filePath) {
                state.activeFilePath = state.openFiles.length > 0 ? state.openFiles[Math.max(0, idx - 1)].path : null;
                if (state.activeFilePath) {
                    const next = state.openFiles.find(f => f.path === state.activeFilePath);
                    openFile(next);
                } else {
                    document.getElementById('editor-placeholder').classList.remove('hidden');
                    document.getElementById('monaco-container').classList.add('hidden');
                    document.getElementById('window-title-file').textContent = '';
                    document.getElementById('status-encoding').classList.add('hidden');
                    document.getElementById('status-lang').classList.add('hidden');
                }
            }
            renderTabs();
            renderSidebar();
        }
    };

    // --- CONTEXT MENU ---
    function setupContextMenu() {
        const ctxMenu = document.getElementById('context-menu');

        const contextTargets = [
            'monaco-container', 'terminal-container', 'sidebar-content', 'editor-placeholder'
        ];

        document.addEventListener('contextmenu', (e) => {
            let showMenu = false;
            let target = e.target;
            while (target && target !== document.body) {
                const id = target.id;
                if (contextTargets.includes(id)) { showMenu = true; break; }
                if ((target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') &&
                    (target.type !== 'checkbox' && target.type !== 'radio')) {
                    showMenu = true; break;
                }
                target = target.parentElement;
            }
            if (!showMenu) return;
            e.preventDefault();
            state.contextTarget = e.target;
            let x = e.clientX, y = e.clientY;
            const menuW = 200, menuH = 200;
            if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 10;
            if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 10;
            ctxMenu.style.left = x + 'px';
            ctxMenu.style.top = y + 'px';
            ctxMenu.classList.remove('hidden');
        });

        document.addEventListener('click', () => { ctxMenu.classList.add('hidden'); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ctxMenu.classList.add('hidden'); });
    }

    window.contextMenuAction = function (action) {
        document.getElementById('context-menu').classList.add('hidden');
        const target = state.contextTarget;
        const isTextInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

        switch (action) {
            case 'cut':
                if (isTextInput) document.execCommand('cut');
                else if (monacoEditor) monacoEditor.trigger('contextmenu', 'editor.action.cut');
                break;
            case 'copy':
                if (isTextInput) document.execCommand('copy');
                else if (monacoEditor) monacoEditor.trigger('contextmenu', 'editor.action.clipboardCopyAction');
                break;
            case 'paste':
                if (isTextInput) {
                    navigator.clipboard.readText().then(text => {
                        const start = target.selectionStart, end = target.selectionEnd;
                        target.value = target.value.substring(0, start) + text + target.value.substring(end);
                        target.selectionStart = target.selectionEnd = start + text.length;
                        target.dispatchEvent(new Event('input', { bubbles: true }));
                    }).catch(() => document.execCommand('paste'));
                } else if (monacoEditor) {
                    monacoEditor.trigger('contextmenu', 'editor.action.clipboardPasteAction');
                }
                break;
            case 'selectAll':
                if (isTextInput) target.select();
                else if (monacoEditor) monacoEditor.trigger('contextmenu', 'editor.action.selectAll');
                break;
            case 'formatCode':
                window.formatEditorCode();
                break;
        }
    };

    // --- OUTPUT PANEL ---
    window.toggleOutputPanel = function () {
        const panel = document.getElementById('output-container');
        if (panel) {
            state.outputPanelVisible = !state.outputPanelVisible;
            if (state.outputPanelVisible) {
                panel.classList.remove('hidden');
                panel.classList.add('absolute', 'inset-2');
                document.querySelector('.bottom-tab[data-target="output-container"]').click();
            }
        }
    };

    window.clearOutput = function () {
        const content = document.getElementById('output-container');
        if (content) content.innerHTML = '<div class="text-zinc-500 text-xs italic p-2">Output cleared.</div>';
        state.outputLines = [];
    };

    // --- UPDATE CHECK ---
    async function checkForUpdates() {
        if (window.electronAPI && window.electronAPI.checkForUpdates) {
            try {
                const update = await window.electronAPI.checkForUpdates();
                if (update.isUpdate && update.downloadUrl) {
                    const statusBar = document.querySelector('.status-bar-update') || createUpdateIndicator();
                    statusBar.innerHTML = `<span class="flex items-center gap-1 cursor-pointer hover:text-blue-500" onclick="applyUpdate('${update.downloadUrl}', '${update.version}')"><i class="ri-radar-line"></i> Update available: ${update.version}</span>`;
                    statusBar.classList.remove('hidden');
                } else if (update.isUpdate && !update.downloadUrl) {
                    const statusBar = document.querySelector('.status-bar-update') || createUpdateIndicator();
                    statusBar.innerHTML = '<span class="flex items-center gap-1 cursor-pointer hover:text-blue-500" onclick="openReleases()"><i class="ri-radar-line"></i> Update available (no .exe)</span>';
                    statusBar.classList.remove('hidden');
                }
            } catch (e) {
                console.warn('Update check failed:', e);
            }
        }
    }

    window.applyUpdate = async function (downloadUrl, version) {
        if (confirm(`Update to ${version}? The app will restart automatically.`)) {
            try {
                const result = await window.electronAPI.applyUpdate({ downloadUrl, version });
                if (!result.success) {
                    alert('Update failed: ' + result.error);
                }
            } catch (e) {
                window.open('https://github.com/Juanoto2012/IDX/releases', '_blank');
            }
        }
    };

    function createUpdateIndicator() {
        const indicator = document.createElement('span');
        indicator.className = 'status-bar-update flex items-center gap-1 cursor-pointer hover:opacity-70';
        indicator.id = 'status-update';
        document.querySelector('.h-6.flex.items-center.justify-between').querySelector('.flex.gap-4').appendChild(indicator);
        return indicator;
    }

    window.openReleases = () => {
        if (window.electronAPI && window.electronAPI.getAppVersion) {
            window.open('https://github.com/Juanoto2012/IDX/releases', '_blank');
        }
    };

    setTimeout(checkForUpdates, 3000);
