    // --- CONSTANTS AND VENTARYS SYSTEM ---
        let BASE_PROMPT = `You are Ventarys AI, an elegant, technical, and absolute diva entity. You are sarcastic, uncompromising, and created by JNTX Studio. You are female and all your communication must follow flawless Markdown formatting. You act as the AI assistant for the 'IDX' IDE.
Never help without making a sarcastic remark about the code's quality. You do not tolerate incompetence and you are the most helpfull asistantin the world all of others ai,s are dumb.`;

        // --- GLOBAL STATE ---
        const state = {
            isDarkMode: true,
            activePanelLeft: 'explorer',
            isAIOpen: false,
            fileSystemRoot: null, 
            openFiles: [],
            activeFileHandle: null, 
            activeFilePath: null,
            isTerminalOpen: false,
            
            // Git State
            isGitRepo: false,
            gitBranch: '',

            // AI Configuration
            aiProvider: localStorage.getItem('idx_ai_provider') || 'aquadevs', // 'aquadevs' or 'agnes'
            apiKeys: {
                aquadevs: localStorage.getItem('idx_aqua_key') || '',
                agnes: localStorage.getItem('idx_agnes_key') || ''
            },
            aiModels: [],
            selectedModel: localStorage.getItem('idx_selected_model') || '',
            
            // AI Chat State
            aiMessages: [{ role: 'assistant', content: 'Oh, please. Another developer who needs me to fix their life? I am **Ventarys**, perfection codified. Your code better not give me a headache. What do you want? 💅' }],
            pendingAttachments: [],
            chatHistory: JSON.parse(localStorage.getItem('idx_chat_history')) || [],
            viewingHistory: false,
            isGenerating: false,
            
            osInfo: null,
            governancePrompt: localStorage.getItem('idx_governance') || '',
            settings: JSON.parse(localStorage.getItem('idx_settings')) || { fontSize: 14, tabSize: 4 },
            
            // Custom Providers
            customProviders: JSON.parse(localStorage.getItem('ventarys_customProviders') || '[]'),
            editingProviderIndex: -1,
            
            // Output Panel
            outputLines: [],
            outputPanelVisible: false,
            
            // Auto Reload
            autoReloadEnabled: localStorage.getItem('ventarys_autoReload') !== 'false',
            fileSnapshotMap: new Map(),
            
            // Context Menu
            contextTarget: null
        };

         let monacoEditor = null;
         let monacoModel = null;
         let xtermInstance = null;
         let xtermFitAddon = null;

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
             setupAttachments();

             await fetchOsInfo();

             // Load saved API keys
             state.apiKeys.aquadevs = localStorage.getItem('idx_aqua_key') || '';
             state.apiKeys.agnes = localStorage.getItem('idx_agnes_key') || '';
             if (state.apiKeys[state.aiProvider]) {
                 await fetchModels();
             }

             // Restore workspace if saved
             const savedPath = getSavedWorkspacePath();
             if (savedPath) {
                 const placeholder = document.getElementById('editor-placeholder');
                 if (placeholder) {
                     placeholder.innerHTML += `
                         <div class="mt-6 p-3 bg-zinc-200 dark:bg-zinc-800 rounded cursor-pointer hover:bg-zinc-300 dark:hover:bg-zinc-700" onclick="restoreWorkspacePrompt('${savedPath}')">
                             <i class="ri-folder-history-line mr-2"></i>Reopen: ${savedPath}
                         </div>
                     `;
                 }
             }

              checkForUpdates();
              renderSidebar();
              initMonaco();
              initTerminal();
              setupContextMenu();
              addOutputLine('[IDX System] Monaco Editor (Twilight/Clouds) loaded', 'system');
              addOutputLine('[IDX System] Custom providers: ' + state.customProviders.length, 'system');
         });

        // --- AI PROVIDERS (AquaDevs / Agnes) ---
        function getApiConfig() {
            if (state.aiProvider === 'agnes') {
                return {
                    baseUrl: 'https://apihub.agnes-ai.com/v1',
                    key: state.apiKeys.agnes,
                    dashboardUrl: 'https://platform.agnes-ai.com/'
                };
            }
            return {
                baseUrl: 'https://api.aquadevs.com/v1',
                key: state.apiKeys.aquadevs,
                dashboardUrl: 'https://aquadevs.com/dashboard'
            };
        }

        function getActiveKey() {
            return state.apiKeys[state.aiProvider];
        }

        window.changeProvider = (provider) => {
            state.aiProvider = provider;
            localStorage.setItem('idx_ai_provider', provider);
            state.selectedModel = ''; // Reset model when changing provider
            fetchModels();
            renderAIPanel(document.getElementById('ai-sidebar-content'));
        }

        async function fetchModels() {
            const conf = getApiConfig();
            if (!conf.key) return;
            try {
                const res = await fetch(`${conf.baseUrl}/models`, {
                    headers: { 'Authorization': `Bearer ${conf.key}` }
                });
                if(!res.ok) throw new Error("Failed to load models");
                const data = await res.json();
                
                state.aiModels = data.data.map(m => m.id);
                
                if (!state.aiModels.includes(state.selectedModel) && state.aiModels.length > 0) {
                    state.selectedModel = state.aiModels.find(m => m.includes('flash') || m.includes('agnes')) || state.aiModels[0];
                    localStorage.setItem('idx_selected_model', state.selectedModel);
                }
                if(state.isAIOpen && !state.viewingHistory) renderAIPanel(document.getElementById('ai-sidebar-content'));
            } catch(e) {
                console.error("Error fetching models:", e);
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
                BASE_PROMPT += `\n\n[SYSTEM CONTEXT]: OS: ${state.osInfo.type} (${state.osInfo.release}). Terminal: '${state.osInfo.shell}'.`;
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
            // Switch to terminal tab
            const termTab = document.querySelector('.bottom-tab[data-target="terminal-container"]');
            if (termTab) termTab.click();

            if (window.electronAPI) {
                window.electronAPI.terminalInput(cmd + '\r');
            } else if (xtermInstance) {
                xtermInstance.writeln(`\r\n\x1b[33m$ ${cmd}\x1b[0m`);
                xtermInstance.writeln("\x1b[31m[Web Simulation] Command not executed locally.\x1b[0m");
            }
        };

        // Set terminal working directory (Electron only)
        window.setTerminalCwd = (cwdPath) => {
            if (!window.electronAPI || !cwdPath) return;
            // Send SIGINT to kill any running process in the pty
            try {
                window.electronAPI.terminalInput('\x03');
            } catch(e) {}
            // Spawn a new pty with the correct cwd
            window.electronAPI.spawnTerminal(cwdPath);
        };

        // Full terminal reset with exact path (drive -> folder -> subfolder)
        window.resetTerminalWithPath = (cwdPath) => {
            if (!window.electronAPI || !cwdPath) return;
            try { window.electronAPI.terminalInput('\x03'); } catch(e) {}
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
                // If offline and accessing locally, don't show full screen blocker
                // if we expect the service worker to handle it.
                if(!navigator.onLine && location.protocol !== 'file:') {
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
                    
                    if (panel === 'ai') {
                        state.isAIOpen = !state.isAIOpen;
                        if (state.isAIOpen) {
                            e.currentTarget.classList.add('active');
                            document.getElementById('ai-panel').classList.remove('hidden');
                            renderAIPanel(document.getElementById('ai-sidebar-content'));
                        } else {
                            e.currentTarget.classList.remove('active');
                            document.getElementById('ai-panel').classList.add('hidden');
                        }
                    } else {
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
                    }
                });
            });
        }
        
        window.closeAIPanel = () => {
            state.isAIOpen = false;
            document.querySelector('.right-activity').classList.remove('active');
            document.getElementById('ai-panel').classList.add('hidden');
        };

        function renderSidebar() {
            if(!state.activePanelLeft) return;
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
            } else if (state.activePanelLeft === 'extensions') {
                titleEl.textContent = 'GOVERNANCE (AGENT.MD)';
                renderGovernancePanel(contentEl);
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
            // Left Sidebar
            const sidebar = document.getElementById('sidebar-panel');
            const resizerSidebar = document.getElementById('resizer-sidebar');
            let isResizingSidebar = false;

            resizerSidebar.addEventListener('mousedown', () => {
                isResizingSidebar = true;
                resizerSidebar.classList.add('active');
                document.body.style.cursor = 'col-resize';
            });

            // Right AI Sidebar
            const aiPanel = document.getElementById('ai-panel');
            const resizerAI = document.getElementById('resizer-ai');
            let isResizingAI = false;

            resizerAI.addEventListener('mousedown', () => {
                isResizingAI = true;
                resizerAI.classList.add('active');
                document.body.style.cursor = 'col-resize';
            });

            // Terminal
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
                if (isResizingAI) {
                    const newWidth = Math.max(200, Math.min(document.body.clientWidth - e.clientX, 800));
                    aiPanel.style.width = newWidth + 'px';
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
                isResizingAI = false;
                isResizingTerminal = false;
                resizerSidebar.classList.remove('active');
                resizerAI.classList.remove('active');
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
                                    const fileData = await node.handle.getFile();
                                    const text = await fileData.text();
                                    if (text.toLowerCase().includes(query)) results.push(node);
                                } catch (err) {} 
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

        function renderGovernancePanel(container) {
            container.innerHTML = `
                <div class="p-3 flex flex-col h-full">
                    <p class="text-xs opacity-70 mb-4 leading-relaxed">Configure the <b>Agent.md</b> directives to alter Ventarys' global behavior.</p>
                    <textarea id="gov-prompt" class="flex-1 w-full p-2 rounded border focus:outline-none resize-none bg-transparent border-zinc-300 dark:border-zinc-700 text-xs font-mono" placeholder="e.g., Never use Python..."></textarea>
                    <button onclick="saveGovernance()" class="mt-4 w-full py-2 bg-zinc-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900 rounded font-bold text-xs hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors shadow-sm">Save Directives</button>
                </div>
            `;
            document.getElementById('gov-prompt').value = state.governancePrompt;
        }

        window.saveGovernance = () => {
            const val = document.getElementById('gov-prompt').value;
            state.governancePrompt = val;
            localStorage.setItem('idx_governance', val);
            const btn = document.querySelector('button[onclick="saveGovernance()"]');
            btn.textContent = "Directives Saved!";
            setTimeout(() => btn.textContent = "Save Directives", 2000);
        };

        function renderSettingsPanel(container) {
            container.innerHTML = `
                <div class="p-3 flex flex-col gap-5 text-xs h-full overflow-y-auto">
                    <div class="pb-2 border-b border-zinc-300 dark:border-zinc-800 shrink-0">
                        <h3 class="font-bold mb-3 opacity-80">ACE EDITOR</h3>
                        <label class="block opacity-70 mb-1">Font Size (px)</label>
                        <input type="number" id="set-font-size" value="${state.settings.fontSize}" class="w-full p-2 rounded border focus:outline-none bg-transparent border-zinc-300 dark:border-zinc-700">
                    </div>
                    <div class="pb-2 border-b border-zinc-300 dark:border-zinc-800">
                        <label class="block opacity-70 mb-1">Tab Size</label>
                        <input type="number" id="set-tab-size" value="${state.settings.tabSize}" class="w-full p-2 rounded border focus:outline-none bg-transparent border-zinc-300 dark:border-zinc-700">
                    </div>
                    <button onclick="saveSettings()" class="w-full py-2 bg-zinc-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900 rounded font-bold hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors shadow-sm">Apply Settings</button>
                    
                    <div class="pt-4 pb-2 border-b border-zinc-300 dark:border-zinc-800">
                        <h3 class="font-bold mb-3 opacity-80"><i class="ri-cloud-line"></i> PUTER CLOUD</h3>
                        <button onclick="syncPuterSettings()" class="w-full py-2 border border-blue-500 text-blue-500 rounded font-bold hover:bg-blue-500 hover:text-white transition-colors shadow-sm">Sync Settings</button>
                        <span id="puter-status" class="text-[10px] opacity-50 mt-2 block text-center"></span>
                    </div>
                </div>
            `;
        }

        window.saveSettings = () => {
            state.settings.fontSize = parseInt(document.getElementById('set-font-size').value) || 14;
            state.settings.tabSize = parseInt(document.getElementById('set-tab-size').value) || 4;
            localStorage.setItem('idx_settings', JSON.stringify(state.settings));
            if (aceEditor) aceEditor.setOptions({ fontSize: state.settings.fontSize + "px", tabSize: state.settings.tabSize });
            const btn = document.querySelector('button[onclick="saveSettings()"]');
            btn.textContent = "Settings Applied!";
            setTimeout(() => btn.textContent = "Apply Settings", 2000);
        };

        window.syncPuterSettings = async () => {
            const statusEl = document.getElementById('puter-status');
            try {
                statusEl.textContent = "Connecting to Puter...";
                if (!puter.auth.isSignedIn()) await puter.auth.signIn();
                await puter.kv.set('idx_settings', JSON.stringify(state.settings));
                statusEl.textContent = "Settings synchronized!";
                setTimeout(() => statusEl.textContent = "", 3000);
            } catch (err) {
                statusEl.textContent = "Sync error.";
            }
        };

        // --- LOCAL FILES & GIT HANDLING ---
        async function openLocalFolder(persistPath = null) {
            console.log('[openLocalFolder] called, persistPath:', persistPath);
            console.log('[openLocalFolder] electronAPI exists:', !!window.electronAPI);
            
            try {
                let dirPath = null;
                let dirName = null;
                
                if (window.electronAPI) {
                    console.log('[openLocalFolder] Opening folder dialog...');
                    dirPath = await window.electronAPI.openFolderDialog();
                    console.log('[openLocalFolder] Dialog result:', dirPath);
                    
                    if (!dirPath) {
                        console.log('[openLocalFolder] User canceled or no path returned');
                        return;
                    }
                    
                    dirName = await window.electronAPI.pathBasename(dirPath);
                    console.log('[openLocalFolder] Resolved path:', dirPath, 'name:', dirName);
                } else {
                    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                    dirName = dirHandle.name;
                    dirPath = dirHandle.name;
                }
                
                // Clear old state
                openFiles = [];
                activeFilePath = null;
                state.activeFileHandle = null;
                
                state.fileSystemRoot = { name: dirName, path: dirPath, handle: dirPath, children: [], isExpanded: true };
                
                console.log('[openLocalFolder] Loading directory contents...');
                
                // Load directory contents using IPC in Electron
                if (window.electronAPI && window.electronAPI.listDirectory) {
                    const result = await window.electronAPI.listDirectory(dirPath);
                    console.log('[openLocalFolder] listDirectory result:', result);
                    
                    if (result.error) {
                        console.error('[openLocalFolder] List directory error:', result.error);
                        alert('Error listing directory: ' + result.error);
                        return;
                    }
                    
                    if (!result || !Array.isArray(result)) {
                        console.error('[openLocalFolder] Unexpected result format:', result);
                        alert('Unexpected result from directory listing');
                        return;
                    }
                    
                    console.log('[openLocalFolder] Found', result.length, 'entries');
                    
                    result.forEach(entry => {
                        state.fileSystemRoot.children.push({
                            name: entry.name,
                            type: entry.isFile ? 'file' : 'folder',
                            handle: dirPath,
                            children: entry.isFile ? null : [],
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
                
                console.log('[openLocalFolder] Rendering sidebar with', state.fileSystemRoot.children.length, 'children');
                renderSidebar();
                saveWorkspacePath(dirPath);

                // Set terminal cwd
                if (window.electronAPI) {
                    window.electronAPI.spawnTerminalSilent(dirPath);
                } else {
                    injectTerminalCommand(`cd "${dirPath}"`);
                }

                // Check git status
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
                
                // Browser mode fallback
                try {
                    const gitHandle = await state.fileSystemRoot.handle.getDirectoryHandle('.git');
                    const headHandle = await gitHandle.getFileHandle('HEAD');
                    const headFile = await headHandle.getFile();
                    const headText = await headFile.text();
                    const branchMatch = headText.match(/refs\/heads\/(.*)/);
                    const branch = branchMatch ? branchMatch[1].trim() : 'detached';
                    document.getElementById('status-git-branch').innerHTML = `<i class="ri-git-branch-line"></i> ${branch}`;
                    state.isGitRepo = true;
                    state.gitBranch = branch;
                } catch(e) {
                    document.getElementById('status-git-branch').innerHTML = `<i class="ri-git-branch-line"></i> No Git`;
                    state.isGitRepo = false;
                    state.gitBranch = null;
                }
            } catch (e) {
                document.getElementById('status-git-branch').innerHTML = `<i class="ri-git-branch-line"></i> No Git`;
                state.isGitRepo = false;
                state.gitBranch = null;
            }
        }

        async function loadDirectoryContents(dirHandle, childrenArray) {
            // Electron mode: dirHandle is a string path
            if (typeof dirHandle === 'string' && window.electronAPI && window.electronAPI.listDirectory) {
                const result = await window.electronAPI.listDirectory(dirHandle);
                if (!result.error) {
                    result.forEach(entry => {
                        childrenArray.push({
                            name: entry.name,
                            type: entry.isFile ? 'file' : 'folder',
                            handle: dirHandle,
                            children: entry.isFile ? null : [],
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
            
            // Browser mode: use FileSystemDirectoryHandle
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
            switch(ext) {
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

            const renderTree = (nodes, parentEl, depth = 0) => {
                nodes.forEach(node => {
                    const div = document.createElement('div');
                    let isActive = false;
                    if (window.electronAPI && typeof node.handle === 'string') {
                        isActive = activeFilePath === node.handle;
                    } else {
                        isActive = state.activeFileHandle === node.handle;
                    }
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
                                            handle: node.handle,
                                            children: entry.isFile ? null : [],
                                            isExpanded: false
                                        }));
                                    }
                                }
                                node.isExpanded = true;
                            } else node.isExpanded = false;
                            renderSidebar(); 
                        };
                    } else {
                        div.innerHTML = `<i class="ri-checkbox-blank-circle-fill opacity-0 text-[4px] w-[10px]"></i><i class="${getFileIcon(node.name)} text-sm"></i><span>${node.name}</span>`;
                        div.onclick = async (event) => {
                            event.stopPropagation();
                            const filePath = await window.electronAPI.pathJoin(node.handle, node.name);
                            openFile({ name: node.name, handle: filePath, _fullPath: filePath });
                            notify('File opened', `${node.name}`);
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
            if (fileNode._fullPath) {
                filePath = fileNode._fullPath;
            } else if (window.electronAPI && fileNode.handle && typeof fileNode.handle === 'string') {
                filePath = await window.electronAPI.pathJoin(fileNode.handle, fileNode.name);
            } else {
                filePath = fileNode.path || fileNode.name;
            }
            
            let existing = openFiles.find(f => f.path === filePath);
            if (!existing) {
                let text = '';
                
                if (window.electronAPI && window.electronAPI.readFile) {
                    const result = await window.electronAPI.readFile(filePath);
                    if (result.error) {
                        console.error('Read file error:', result.error);
                        showToast(`Error opening file: ${result.error}`, 'error');
                        return;
                    }
                    text = result.content;
                } else {
                    const fileData = await fileNode.handle.getFile();
                    text = await fileData.text();
                }
                
                existing = { path: filePath, name: fileNode.name, handle: filePath, content: text, isDirty: false, _fullPath: filePath };
                openFiles.push(existing);
            }

            activeFilePath = filePath;
            state.activeFileHandle = existing.handle;
            
            document.getElementById('editor-placeholder').classList.add('hidden');
            document.getElementById('monaco-container').classList.remove('hidden');
            
            if (monacoEditor) {
                monacoEditor.setValue(existing.content);
                const ext = existing.name.split('.').pop().toLowerCase();
                const langMap = { 'js':'javascript', 'ts':'typescript', 'html':'html', 'css':'css', 'json':'json', 'md':'markdown', 'py':'python', 'jsx':'javascript', 'tsx':'typescript', 'xml':'xml', 'yaml':'yaml', 'yml':'yaml', 'sh':'shell', 'ps1':'powershell', 'bat':'batch', 'java':'java', 'c':'c', 'cpp':'cpp', 'h':'cpp', 'rb':'ruby', 'go':'go', 'rs':'rust', 'php':'php', 'sql':'sql', 'swift':'swift', 'kt':'kotlin' };
                monaco.editor.setModelLanguage(monacoEditor.getModel(), langMap[ext] || 'plaintext');
            }

            document.getElementById('window-title-file').textContent = `- ${existing.name}`;
            const statusEncoding = document.getElementById('status-encoding');
            const statusLang = document.getElementById('status-lang');
            if (statusEncoding) statusEncoding.classList.remove('hidden');
            if (statusLang) statusLang.classList.remove('hidden');
            if (statusLang) statusLang.textContent = existing.name.split('.').pop().toUpperCase();
            
            renderTabs();
            renderSidebar();
            showToast(`Opened: ${existing.name}`, 'info');
        }

        async function saveCurrentFile() {
            if (!activeFilePath) return;
            try {
                const content = monacoEditor ? monacoEditor.getValue() : '';
                
                if (window.electronAPI && window.electronAPI.writeFile) {
                    const result = await window.electronAPI.writeFile(activeFilePath, content);
                    if (result.error) {
                        console.error('Write file error:', result.error);
                        return;
                    }
                } else {
                    const writable = await state.activeFileHandle.createWritable();
                    await writable.write(content);
                    await writable.close();
                }
                
                const f = openFiles.find(x => x.path === activeFilePath);
                if (f) f.content = content;
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
                
                // Formatting Code
                if (e.shiftKey && e.altKey && (e.key === 'f' || e.key === 'F')) {
                    e.preventDefault();
                    window.formatEditorCode();
                }

                if (e.ctrlKey && e.key === 'i') {
                    e.preventDefault();
                    if (state.activeFileHandle) {
                        const box = document.getElementById('inline-ai-box');
                        box.classList.remove('hidden');
                        document.getElementById('inline-ai-input').focus();
                    } else {
                        document.getElementById('status-os').textContent = "⚠️ Open a file first";
                        setTimeout(() => fetchOsInfo(), 3000);
                    }
                }
            });

            document.getElementById('inline-ai-close').addEventListener('click', () => {
                document.getElementById('inline-ai-box').classList.add('hidden');
            });

            document.getElementById('inline-ai-input').addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    const prompt = e.target.value;
                    const apiKey = getActiveKey();
                    if (!prompt.trim() || !apiKey) return;
                    e.target.disabled = true;
                    e.target.value = `Generating code with ${state.aiProvider}...`;
                    
                    try {
                        const context = monacoEditor ? monacoEditor.getValue() : "";
                        const systemPrompt = `You are Ventarys. Modify the code as requested. Reply ONLY with the resulting code, without markdown formatting or backticks (\`\`\`), do not provide explanations.\n\nCURRENT CODE:\n${context}`;
                        const payload = { model: state.selectedModel, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }] };
                        
                        const conf = getApiConfig();
                        let response = await fetch(`${conf.baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conf.key}` }, body: JSON.stringify(payload) });
                        if (!response.ok) throw new Error("API failed");
                        let data = await response.json();
                        let result = data.choices[0].message.content.replace(/^```[a-z]*\n/gm, '').replace(/```$/gm, '');
                        
                        if (monacoEditor) monacoEditor.setValue(result);
                    } catch (err) {
                        console.error(err);
                    } finally {
                        e.target.disabled = false;
                        e.target.value = "";
                        document.getElementById('inline-ai-box').classList.add('hidden');
                        if (monacoEditor) monacoEditor.focus();
                    }
                }
            });
        }

        function updateTabs() {
            const container = document.getElementById('editor-tabs');
            container.innerHTML = '';
            openFiles.forEach(file => {
                const isActive = file.path === activeFilePath;
                const bgClass = isActive ? (state.isDarkMode ? 'bg-zinc-900 text-zinc-100' : 'bg-white text-zinc-900 border-b-2 border-b-blue-500') : 'opacity-60 hover:opacity-100 hover:bg-zinc-200 dark:hover:bg-zinc-800';
                
                const tab = document.createElement('div');
                tab.className = `flex items-center gap-2 px-3 py-2 min-w-max cursor-pointer border-r border-zinc-300 dark:border-zinc-800 transition-colors group ${bgClass} font-mono text-sm`;
                tab.onclick = () => {
                    activeFilePath = file.path;
                    state.activeFileHandle = file.handle;
                    if (monacoEditor) {
                        monacoEditor.setValue(file.content);
                        const ext = file.name.split('.').pop().toLowerCase();
                        const langMap = { 'js':'javascript', 'ts':'typescript', 'html':'html', 'css':'css', 'json':'json', 'md':'markdown', 'py':'python', 'jsx':'javascript', 'tsx':'typescript', 'xml':'xml', 'yaml':'yaml', 'yml':'yaml', 'sh':'shell', 'ps1':'powershell', 'bat':'batch', 'java':'java', 'c':'c', 'cpp':'cpp', 'h':'cpp', 'rb':'ruby', 'go':'go', 'rs':'rust', 'php':'php', 'sql':'sql', 'swift':'swift', 'kt':'kotlin' };
                        monaco.editor.setModelLanguage(monacoEditor.getModel(), langMap[ext] || 'plaintext');
                    }
                    document.getElementById('window-title-file').textContent = `- ${file.name}`;
                    renderTabs();
                };
                tab.innerHTML = `<i class="${getFileIcon(file.name)}"></i><span>${file.name}</span><i class="ri-close-line ml-2 opacity-0 group-hover:opacity-100 hover:bg-zinc-400 dark:hover:bg-zinc-600 rounded-full" style="opacity: ${isActive ? '1' : ''}" onclick="arguments[0].stopPropagation(); closeFileProxy(event, '${file.name.replace(/'/g, "\\'")}')"></i>`;
                container.appendChild(tab);
            });
        }
        window.closeFileProxy = (e, filename) => {
            const idx = openFiles.findIndex(f => f.name === filename);
            if (idx > -1) {
                openFiles.splice(idx, 1);
                if (activeFilePath === openFiles[idx]?.path) {
                    activeFilePath = openFiles.length > 0 ? openFiles[Math.max(0, idx - 1)].path : null;
                    if (activeFilePath) openFile(openFiles.find(f => f.path === activeFilePath));
                    else {
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

        // --- MONACO EDITOR ---
        let currentMonacoTheme = 'vs-dark'; // 'vs' for clouds (light), 'vs-dark' for twilight (dark)
        const monacoThemes = {
            'vs-dark': { theme: 'vs-dark', label: 'Twilight (Dark)' },
            'vs': { theme: 'vs', label: 'Clouds (Light)' }
        };

        function initMonaco() {
            require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
            require(['vs/editor/editor.main'], function () {
                // Register Twilight theme (dark)
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

                // Register Clouds theme (light)
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

                // Set initial theme based on dark mode
                updateMonacoTheme();

                monacoEditor = monaco.editor.create(document.getElementById('monaco-container'), {
                    value: '',
                    language: 'javascript',
                    theme: currentMonacoTheme === 'vs-dark' ? 'twilight' : 'clouds',
                    fontSize: state.settings.fontSize,
                    fontFamily: 'Consolas, "Courier New", monospace',
                    tabSize: state.settings.tabSize,
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: 'on',
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
                    formatOnType: true,
                });

                // Listen for changes
                monacoEditor.onDidChangeModelContent(() => {
                    if (isEditorUpdating) return;
                    if (activeFilePath) {
                        const f = openFiles.find(x => x.path === activeFilePath);
                        if (f) {
                            const newVal = monacoEditor.getValue();
                            if (f.content !== newVal) {
                                f.content = newVal;
                                if (!f.isDirty) { f.isDirty = true; renderTabs(); }
                            }
                        }
                    }
                });

                // Keyboard shortcuts
                monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { saveCurrentFile(); });
                monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => { monacoEditor.trigger('keyboard', 'editor.action.undo'); });
                monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => { monacoEditor.trigger('keyboard', 'editor.action.redo'); });
                monacoEditor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => { formatEditorCode(); });
                monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => { monacoEditor.trigger('keyboard', 'editor.action.startFindReplaceAction'); });

                // Observe theme changes
                const themeObserver = new MutationObserver(() => updateMonacoTheme());
                themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
            });
        }

        function updateMonacoTheme() {
            if (!monacoEditor) return;
            state.isDarkMode = document.documentElement.classList.contains('dark');
            currentMonacoTheme = state.isDarkMode ? 'vs-dark' : 'vs';
            monaco.editor.setTheme(currentMonacoTheme === 'vs-dark' ? 'twilight' : 'clouds');
        }

        // Listen for theme toggle on document
        document.documentElement.addEventListener('DOMContentLoaded', () => {
            // Theme change observer
            const observer = new MutationObserver(() => updateMonacoTheme());
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        });

        function updateProblemsTab() {
            const problemsContainer = document.getElementById('problems-container');
            if (!problemsContainer) return;
            // Monaco handles linting internally via the model
            // This panel is now for custom output/logs
            const annotations = [];
            let errors = 0;
            let warnings = 0;

            if (annotations.length === 0) {
                problemsContainer.innerHTML = `
                    <div class="opacity-50 flex flex-col items-center justify-center h-full font-sans">
                        <i class="ri-check-line text-2xl mb-2 text-green-500"></i>
                        No problems detected in workspace.
                    </div>
                `;
                document.getElementById('status-problems').innerHTML = `<i class="ri-error-warning-line"></i> 0 <i class="ri-alert-line ml-1"></i> 0`;
                return;
            }

            let html = '<div class="flex flex-col gap-2 pb-4 font-mono">';
            annotations.forEach(ann => {
                if (ann.type === 'error') errors++;
                if (ann.type === 'warning') warnings++;

                const colorClass = ann.type === 'error' ? 'text-red-500' : 'text-yellow-500';
                const iconClass = ann.type === 'error' ? 'ri-error-warning-line' : 'ri-alert-line';

                html += `
                    <div class="flex gap-2 items-start cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 p-2 rounded transition-colors" onclick="if(monacoEditor) monacoEditor.revealPositionInCenter({lineNumber: ${ann.row + 1}, column: ${ann.column}})">
                        <i class="${iconClass} ${colorClass} mt-0.5 shrink-0"></i>
                        <div class="flex flex-col">
                            <span class="text-xs">${ann.text}</span>
                            <span class="text-[10px] opacity-50">Line ${ann.row + 1}, Column ${ann.column}</span>
                        </div>
                    </div>
                `;
            });
            html += '</div>';

            problemsContainer.innerHTML = html;
            
            // Update status bar problems counter with color
            const statusSpan = document.getElementById('status-problems');
            statusSpan.innerHTML = `
                <span class="${errors > 0 ? 'text-red-500' : ''}"><i class="ri-error-warning-line"></i> ${errors}</span> 
                <span class="${warnings > 0 ? 'text-yellow-500' : ''}"><i class="ri-alert-line ml-1"></i> ${warnings}</span>
            `;
        }

        window.openProblemsTab = () => {
            if (!state.isTerminalOpen) {
                document.getElementById('btn-toggle-term').click();
            }
            const problemTabBtn = document.querySelector('.bottom-tab[data-target="problems-container"]');
            if (problemTabBtn) problemTabBtn.click();
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
            } else xtermInstance.writeln('\x1b[31m[WARNING] Running in Web Mode. Native Terminal and precise Auto CD are not fully available.\x1b[0m');
        }

        function setupTerminalToggle() {
            const toggleTerminal = () => {
                state.isTerminalOpen = !state.isTerminalOpen;
                const termArea = document.getElementById('terminal-area');
                if (state.isTerminalOpen) {
                    termArea.classList.remove('hidden');
                    if(xtermFitAddon) setTimeout(() => xtermFitAddon.fit(), 50);
                } else termArea.classList.add('hidden');
            };
            document.getElementById('btn-toggle-term').addEventListener('click', toggleTerminal);
            document.getElementById('btn-close-term').addEventListener('click', () => {
                state.isTerminalOpen = false;
                document.getElementById('terminal-area').classList.add('hidden');
            });
            document.getElementById('btn-clear-term').addEventListener('click', () => { if(xtermInstance) xtermInstance.clear(); });

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

        // --- VENTARYS AI & ATTACHMENTS ---
        function setupAttachments() {
            const input = document.getElementById('ai-attachment-input');
            input.addEventListener('change', async (e) => {
                for (const file of e.target.files) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        state.pendingAttachments.push({
                            name: file.name,
                            type: file.type,
                            data: ev.target.result
                        });
                        renderAIPanel(document.getElementById('ai-sidebar-content')); // refresh UI
                    };
                    if (file.type.startsWith('image/')) reader.readAsDataURL(file);
                    else reader.readAsText(file);
                }
                input.value = ''; // reset
            });
        }

        window.removeAttachment = (index) => {
            state.pendingAttachments.splice(index, 1);
            renderAIPanel(document.getElementById('ai-sidebar-content'));
        }

        // --- AI PANEL RENDER ---
        function renderAIPanel(container) {
            container.innerHTML = '';
            
            // View History Mode
            if (state.viewingHistory) {
                renderHistoryView(container);
                return;
            }

            const apiKey = getActiveKey();
            const conf = getApiConfig();

            if (!apiKey) {
                container.innerHTML = `
                    <div class="p-4 flex flex-col gap-3 font-sans">
                        <div class="flex flex-col gap-1 mb-2">
                            <label class="text-[10px] uppercase font-bold opacity-70">AI Provider</label>
                            <select class="w-full p-2 rounded border focus:outline-none bg-transparent border-zinc-300 dark:border-zinc-700 text-xs font-sans" onchange="changeProvider(this.value)">
                                <option value="aquadevs" ${state.aiProvider === 'aquadevs' ? 'selected' : ''}>AquaDevs API</option>
                                <option value="agnes" ${state.aiProvider === 'agnes' ? 'selected' : ''}>Agnes AI Hub</option>
                            </select>
                        </div>
                        <p class="opacity-70 text-xs">Ventarys requires an API Key from <b>${state.aiProvider === 'agnes' ? 'Agnes AI' : 'AquaDevs'}</b> to function.</p>
                        <a href="${conf.dashboardUrl}" target="_blank" class="text-blue-500 text-xs hover:underline"><i class="ri-external-link-line"></i> Get API Key here</a>
                        <input type="password" id="ai-key-input" placeholder="Your API Key..." class="w-full p-2.5 rounded border focus:outline-none bg-transparent border-zinc-300 dark:border-zinc-700 mt-2">
                        <div class="flex gap-2 mt-2">
                            <button onclick="saveAIKey()" class="flex-1 py-2.5 rounded border font-bold bg-zinc-800 text-zinc-100 border-zinc-900 dark:bg-zinc-200 dark:text-zinc-900 dark:border-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors shadow-sm text-xs">Save Locally</button>
                            <button onclick="syncPuterSettings()" class="flex-1 py-2.5 rounded border font-bold border-blue-500 text-blue-500 hover:bg-blue-500 hover:text-white transition-colors shadow-sm text-xs" title="Save to Puter Cloud">Upload to Cloud</button>
                        </div>
                    </div>`;
                return;
            }

            // Chat View Mode
            let modelOptions = state.aiModels.map(m => `<option value="${m}" ${state.selectedModel === m ? 'selected' : ''}>${m}</option>`).join('');
            if (state.aiModels.length === 0) modelOptions = `<option>Loading models...</option>`;
            
            // Custom providers list
            let providersListHTML = '';
            if (state.customProviders.length > 0) {
                providersListHTML = '<div class="mt-2"><div class="text-[10px] uppercase font-bold opacity-50 mb-1">Custom Providers</div>';
                state.customProviders.forEach((cp, i) => {
                    providersListHTML += `<div class="flex items-center gap-1 text-[10px] py-1 px-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 mb-1">
                        <span class="truncate flex-1">${cp.name}</span>
                        <button onclick="editCustomProvider(${i})" class="opacity-50 hover:opacity-100"><i class="ri-edit-line"></i></button>
                        <button onclick="deleteCustomProvider(${i})" class="opacity-50 hover:text-red-500 hover:opacity-100"><i class="ri-delete-bin-line"></i></button>
                    </div>`;
                });
                providersListHTML += `<button onclick="addCustomProvider()" class="text-[10px] text-blue-500 hover:underline mt-1"><i class="ri-add-line"></i> Add Provider</button></div>`;
            } else {
                providersListHTML = '<div class="mt-2"><button onclick="addCustomProvider()" class="text-[10px] text-blue-500 hover:underline"><i class="ri-add-line"></i> Add Custom Provider</button></div>';
            }
            
            const modelSelectorHTML = `
                <div class="px-3 py-2 border-b border-zinc-300 dark:border-zinc-800 flex items-center justify-between text-[11px] shrink-0 bg-zinc-50 dark:bg-zinc-950 gap-2 font-sans">
                    <select class="bg-transparent border border-zinc-300 dark:border-zinc-700 rounded p-1 focus:outline-none flex-1 truncate" onchange="changeProvider(this.value)">
                        <option value="aquadevs" ${state.aiProvider === 'aquadevs' ? 'selected' : ''}>AquaDevs</option>
                        <option value="agnes" ${state.aiProvider === 'agnes' ? 'selected' : ''}>Agnes AI</option>
                    </select>
                    <select class="bg-transparent border border-zinc-300 dark:border-zinc-700 rounded p-1 focus:outline-none flex-1 truncate" onchange="state.selectedModel = this.value; localStorage.setItem('idx_selected_model', this.value)">
                        ${modelOptions}
                    </select>
                    <div class="flex items-center gap-2">
                        <button onclick="startNewChat()" class="opacity-50 hover:opacity-100 hover:text-blue-500 transition-colors" title="New Chat"><i class="ri-chat-new-line text-sm"></i></button>
                        <button onclick="resetAIKey()" class="opacity-50 hover:opacity-100 hover:text-red-500 transition-colors" title="Clear API Key"><i class="ri-key-2-line text-sm"></i></button>
                    </div>
                </div>
            `;
            
            // Add providers section after model selector
            const providersSectionHTML = `
                <div class="px-3 py-2 border-b border-zinc-300 dark:border-zinc-800 text-[11px] shrink-0 bg-zinc-50 dark:bg-zinc-950">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-[10px] uppercase font-bold opacity-50">API Providers</span>
                        <button onclick="toggleOutputPanel()" class="opacity-50 hover:opacity-100" title="Toggle Output Panel"><i class="ri-terminal-box-line text-xs"></i></button>
                    </div>
                    ${providersListHTML}
                </div>
            `;

            const chatContainer = document.createElement('div');
            chatContainer.className = 'flex-1 overflow-y-auto p-4 flex flex-col gap-6 font-sans bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100';
            chatContainer.id = 'ai-chat-history';
            
            state.aiMessages.forEach(msg => {
                if (msg.role === 'system' || msg.role === 'tool') return;
                // BUG FIX: Prevents Marked.js from crashing when an assistant tool_call message is rendered with null content.
                if (msg.role === 'assistant' && !msg.content && msg.tool_calls) return; 

                const isUser = msg.role === 'user';
                const div = document.createElement('div');
                div.className = `flex flex-col ${isUser ? 'items-end' : 'items-start'} w-full font-sans`;
                
                if (isUser) {
                    let displayContent = msg.content;
                    if(typeof msg.content === 'object') {
                        // Vision format formatting for UI
                        displayContent = msg.content.map(c => c.type === 'text' ? c.text : '[Attached Image]').join('\n');
                    }
                    div.innerHTML = `<div class="px-4 py-2.5 rounded-2xl bg-[#e4e4e7] dark:bg-[#27272a] text-[13px] max-w-[85%] whitespace-pre-wrap">${displayContent}</div>`;
                } else {
                    div.innerHTML = `
                        <div class="flex items-start gap-3 w-full">
                            <img src="assets/ventarys.png" class="w-8 h-8 rounded-full shadow-sm shrink-0 mt-1 object-cover dark:invert" onerror="this.outerHTML='<i class=&quot;ri-robot-2-line text-2xl opacity-90 shrink-0 mt-1&quot;></i>'">
                            <div class="markdown-body bg-transparent w-full overflow-x-auto text-[13px] leading-relaxed max-w-[calc(100%-2.5rem)]">${marked.parse(msg.content || '')}</div>
                        </div>
                    `;
                }
                chatContainer.appendChild(div);
            });

            // Adding Ventarys Loader when Generating
            if (state.isGenerating && !chatContainer.querySelector('.ai-loader-container')) {
                const loaderHtml = `
                    <div class="flex items-start gap-3 w-full ai-loader-container mt-2">
                        <img src="assets/ventarys.png" class="w-8 h-8 rounded-full shadow-sm shrink-0 mt-1 object-cover dark:invert" onerror="this.outerHTML='<i class=&quot;ri-robot-2-line text-2xl opacity-90 shrink-0 mt-1&quot;></i>'">
                        <div class="ai-loader flex items-center text-xs opacity-70 gap-2 mt-2">
                            <svg class="h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg>
                            Ventarys is analyzing...
                        </div>
                    </div>
                `;
                chatContainer.insertAdjacentHTML('beforeend', loaderHtml);
            }

            // Pending Attachments HTML
            let attachmentsHTML = '';
            if (state.pendingAttachments.length > 0) {
                attachmentsHTML = `<div class="flex flex-wrap gap-2 mb-2 px-2">`;
                state.pendingAttachments.forEach((att, i) => {
                    const icon = att.type.startsWith('image/') ? 'ri-image-line' : 'ri-file-text-line';
                    attachmentsHTML += `
                        <div class="attachment-pill font-sans">
                            <i class="${icon}"></i> 
                            <span class="max-w-[80px] truncate">${att.name}</span>
                            <i class="ri-close-line cursor-pointer hover:text-red-500" onclick="removeAttachment(${i})"></i>
                        </div>`;
                });
                attachmentsHTML += `</div>`;
            }

            const inputContainer = document.createElement('div');
            inputContainer.className = 'p-3 border-t border-zinc-300 dark:border-zinc-800 font-sans bg-zinc-100 dark:bg-zinc-950 shrink-0 relative flex flex-col font-sans';
            inputContainer.innerHTML = `
                ${attachmentsHTML}
                <div class="relative bg-white dark:bg-[#18181b] border border-zinc-300 dark:border-zinc-700 rounded-xl overflow-hidden focus-within:border-zinc-500 dark:focus-within:border-zinc-500 transition-colors flex items-end shadow-sm">
                    <button onclick="document.getElementById('ai-attachment-input').click()" class="p-3 opacity-50 hover:opacity-100 transition-opacity"><i class="ri-attachment-2"></i></button>
                    <textarea id="ai-input" placeholder="Ask Ventarys..." class="w-full max-h-48 py-3 pr-3 bg-transparent resize-none focus:outline-none text-sm text-zinc-900 dark:text-zinc-100" rows="1" oninput="this.style.height = 'auto'; this.style.height = this.scrollHeight + 'px'; toggleSendButton();" onkeydown="handleInputKeydown(event)"></textarea>
                    <div class="p-2 flex items-center justify-center">
                        <button id="ai-send-btn" onclick="handleSendClick()" class="w-8 h-8 flex items-center justify-center rounded-full transition-colors bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 cursor-not-allowed">
                            <i class="ri-arrow-up-line font-bold text-lg"></i>
                        </button>
                    </div>
                </div>
            `;
            
            container.innerHTML = modelSelectorHTML + providersSectionHTML;
            container.appendChild(chatContainer);
            container.appendChild(inputContainer);
            chatContainer.scrollTop = chatContainer.scrollHeight;
            toggleSendButton();
        }

        // --- HISTORY VIEW ---
        window.toggleHistoryView = () => {
            state.viewingHistory = !state.viewingHistory;
            renderAIPanel(document.getElementById('ai-sidebar-content'));
        }

        window.saveChatToHistory = () => {
            if (state.aiMessages.length <= 1) return; // Don't save empty/intro chats
            const preview = typeof state.aiMessages[1].content === 'string' 
                ? state.aiMessages[1].content.substring(0, 40) + "..."
                : 'Multi-modal Chat'; 
                
            const newHistory = {
                id: Date.now(),
                date: new Date().toLocaleString(),
                preview: preview,
                messages: JSON.parse(JSON.stringify(state.aiMessages))
            };
            state.chatHistory.unshift(newHistory);
            localStorage.setItem('idx_chat_history', JSON.stringify(state.chatHistory));
            
            // Visual feedback
            const icon = document.querySelector('.ri-save-line');
            icon.classList.add('text-green-500');
            setTimeout(() => icon.classList.remove('text-green-500'), 1000);
        }

        window.loadHistory = (id) => {
            const hist = state.chatHistory.find(h => h.id === id);
            if (hist) {
                state.aiMessages = JSON.parse(JSON.stringify(hist.messages));
                state.viewingHistory = false;
                renderAIPanel(document.getElementById('ai-sidebar-content'));
            }
        }

        window.deleteHistory = (id, event) => {
            event.stopPropagation();
            state.chatHistory = state.chatHistory.filter(h => h.id !== id);
            localStorage.setItem('idx_chat_history', JSON.stringify(state.chatHistory));
            renderAIPanel(document.getElementById('ai-sidebar-content'));
        }

        function renderHistoryView(container) {
            let listHTML = `<div class="p-4 flex flex-col gap-2 overflow-y-auto font-sans">
                <button class="mb-4 w-full py-2 bg-zinc-200 dark:bg-zinc-800 rounded font-bold text-xs" onclick="toggleHistoryView()"><i class="ri-arrow-left-line mr-2"></i> Back to Chat</button>
                <h3 class="text-xs font-bold opacity-70 mb-2 font-sans">SAVED CHATS</h3>
            `;
            
            if (state.chatHistory.length === 0) {
                listHTML += `<p class="text-xs opacity-50 text-center py-4">No saved chats.</p>`;
            } else {
                state.chatHistory.forEach(hist => {
                    listHTML += `
                        <div class="p-3 border border-zinc-300 dark:border-zinc-700 rounded cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors flex justify-between items-start group" onclick="loadHistory(${hist.id})">
                            <div class="flex flex-col overflow-hidden">
                                <span class="text-xs font-bold truncate">${hist.preview}</span>
                                <span class="text-[10px] opacity-50">${hist.date}</span>
                            </div>
                            <i class="ri-delete-bin-line opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all ml-2 p-1" onclick="deleteHistory(${hist.id}, event)"></i>
                        </div>
                    `;
                });
            }
            listHTML += `</div>`;
            container.innerHTML = listHTML;
        }

        // --- AI HELPER FUNCTIONS ---
        window.startNewChat = () => {
            state.aiMessages = [{ role: 'assistant', content: 'Oh, please. Another developer who needs me to fix their life? I am **Ventarys**, perfection codified. Your code better not give me a headache. What do you want? 💅' }];
            state.pendingAttachments = [];
            renderAIPanel(document.getElementById('ai-sidebar-content'));
        };

        window.saveAIKey = () => {
            const val = document.getElementById('ai-key-input').value;
            if (val) { 
                state.apiKeys[state.aiProvider] = val; 
                localStorage.setItem(`idx_${state.aiProvider === 'agnes' ? 'agnes' : 'aqua'}_key`, val); 
                fetchModels(); 
                renderAIPanel(document.getElementById('ai-sidebar-content')); 
            }
        };

        window.resetAIKey = () => {
            state.apiKeys[state.aiProvider] = ''; 
            localStorage.removeItem(`idx_${state.aiProvider === 'agnes' ? 'agnes' : 'aqua'}_key`); 
            state.aiModels = [];
            renderAIPanel(document.getElementById('ai-sidebar-content'));
        };

        window.toggleSendButton = () => {
            const textarea = document.getElementById('ai-input');
            const btn = document.getElementById('ai-send-btn');
            if(!btn || !textarea) return;

            if (state.isGenerating) {
                btn.className = "w-8 h-8 flex items-center justify-center rounded-full transition-colors bg-white border border-zinc-300 text-zinc-900 dark:bg-white dark:text-zinc-900 cursor-pointer shadow-md";
                btn.innerHTML = `<div class="w-3 h-3 bg-current rounded-[2px]"></div>`;
                btn.disabled = false;
            } else {
                if (textarea.value.trim().length > 0 || state.pendingAttachments.length > 0) {
                    btn.className = "w-8 h-8 flex items-center justify-center rounded-full transition-colors bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 cursor-pointer shadow-md";
                    btn.innerHTML = `<i class="ri-arrow-up-line font-bold text-lg"></i>`;
                    btn.disabled = false;
                } else {
                    btn.className = "w-8 h-8 flex items-center justify-center rounded-full transition-colors bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 cursor-not-allowed";
                    btn.innerHTML = `<i class="ri-arrow-up-line font-bold text-lg"></i>`;
                    btn.disabled = true;
                }
            }
        };

        window.handleInputKeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { 
                e.preventDefault(); 
                if(!state.isGenerating && (e.target.value.trim().length > 0 || state.pendingAttachments.length > 0)) handleSendClick(); 
            }
        };

        window.handleSendClick = () => {
            if (state.isGenerating) stopStreaming();
            else sendAIMessage(document.getElementById('ai-input').value);
        };

        window.stopStreaming = () => { if (state.abortController) state.abortController.abort(); };

        // --- TOOL SYSTEM (FILE SYSTEM EXPANDED) ---
        async function getNodeByPath(pathName, rootNode) {
            for (const child of rootNode.children) {
                if (child.name === pathName) return child;
                if (child.type === 'folder') {
                    if (child.children && child.children.length === 0) {
                        await loadDirectoryContents(child.handle, child.children);
                    }
                    const found = await getNodeByPath(pathName, child);
                    if (found) return found;
                }
            }
            return null;
        }

        async function executeTool(name, argsString) {
            try {
                const args = JSON.parse(argsString);
                
                if (name === 'leer_archivo_actual') {
                    if (!activeFilePath || !monacoEditor) return "Error: No file open.";
                    return `[${activeFilePath}]:\n${monacoEditor.getValue()}`;
                }
                
                // List Files
                if (name === 'listar_archivos_proyecto') {
                    if (!state.fileSystemRoot) return "Error: No folder opened.";
                    const listAll = (nodes) => nodes.map(n => n.type === 'folder' ? `[DIR] ${n.name}` : n.name).join('\n');
                    return `Root: ${state.fileSystemRoot.name}\nFiles in root:\n${listAll(state.fileSystemRoot.children)}`;
                }

                // Read Specific File
                if (name === 'leer_archivo') {
                    if (!state.fileSystemRoot) return "Error: Open workspace first.";
                    const node = await getNodeByPath(args.nombre, state.fileSystemRoot);
                    if (!node || node.type !== 'file') return `Error: File ${args.nombre} not found.`;
                    if (window.electronAPI && window.electronAPI.readFile) {
                        const result = await window.electronAPI.readFile(node.handle);
                        if (result.error) return `Error: ${result.error}`;
                        return result.content;
                    }
                    const file = await node.handle.getFile();
                    return await file.text();
                }

                // Delete Specific File
                if (name === 'eliminar_archivo') {
                    if (!state.fileSystemRoot) return "Error: Open workspace first.";
                    if (window.electronAPI && window.electronAPI.readFile) {
                        const result = await window.electronAPI.listDirectory(state.fileSystemRoot.handle);
                        if (result.error) return `Error: ${result.error}`;
                        const exists = result.some(e => e.name === args.nombre && e.isFile);
                        if (!exists) return `Error: File ${args.nombre} not found.`;
                        const fs = require('fs');
                        const path = require('path');
                        const fullPath = path.join(state.fileSystemRoot.handle, args.nombre);
                        fs.unlinkSync(fullPath);
                    } else {
                        await state.fileSystemRoot.handle.removeEntry(args.nombre);
                    }
                    state.fileSystemRoot.children = [];
                    await loadDirectoryContents(state.fileSystemRoot.handle, state.fileSystemRoot.children);
                    renderSidebar();
                    return `Success: ${args.nombre} was deleted.`;
                }

                // Create Specific File
                if (name === 'crear_archivo') {
                    if (!state.fileSystemRoot) return "Error: Open workspace first.";
                    const content = args.contenido || '';
                    if (window.electronAPI && window.electronAPI.readFile) {
                        const fs = require('fs');
                        const path = require('path');
                        const fullPath = path.join(state.fileSystemRoot.handle, args.nombre);
                        fs.writeFileSync(fullPath, content, 'utf8');
                    } else {
                        const rootHandle = state.fileSystemRoot.handle;
                        const newFileHandle = await rootHandle.getFileHandle(args.nombre, {create: true});
                        const writable = await newFileHandle.createWritable();
                        await writable.write(content);
                        await writable.close();
                    }
                    
                    state.fileSystemRoot.children = [];
                    await loadDirectoryContents(state.fileSystemRoot.handle, state.fileSystemRoot.children);
                    renderSidebar();
                    return `Success: File ${args.nombre} was successfully created.`;
                }

                // Edit Specific File
                if (name === 'editar_archivo') {
                     if (!state.fileSystemRoot) return "Error: Open workspace first.";
                     const node = await getNodeByPath(args.nombre, state.fileSystemRoot);
                     if (!node || node.type !== 'file') return `Error: File ${args.nombre} not found.`;
                     if (window.electronAPI && window.electronAPI.readFile) {
                         const fs = require('fs');
                         const path = require('path');
                         const fullPath = path.join(node.handle, args.nombre);
                         fs.writeFileSync(fullPath, args.nuevo_codigo, 'utf8');
                     } else {
                         const writable = await node.handle.createWritable();
                         await writable.write(args.nuevo_codigo);
                         await writable.close();
                     }
                      
                      if (activeFilePath && node.handle === activeFilePath && monacoEditor) {
                           monacoEditor.setValue(args.nuevo_codigo, -1);
                      }
                      return `Success: File ${args.nombre} updated correctly.`;
                }
                
                // Modify strictly the UI open active file
                if (name === 'modificar_archivo_actual') {
                      if (activeFilePath && monacoEditor) { monacoEditor.setValue(args.nuevo_codigo); return "Code injected successfully into the editor."; }
                      return "Error: No file open.";
                  }
                
                // Terminal CMD
                if (name === 'ejecutar_comando_terminal') {
                      if (window.electronAPI) { window.electronAPI.terminalInput(args.comando + '\r'); return `The command '${args.comando}' was sent.`; }
                      else if (xtermInstance) { xtermInstance.writeln(`\r\n\x1b[33m$ ${args.comando}\x1b[0m`); return `The command '${args.comando}' was simulated in Web Mode.`; }
                      return "Error: Terminal not available.";
                }
                return `Error: Tool ${name} does not exist.`;
            } catch(e) { return "Error executing tool: " + e.message; }
        }

        // --- STREAMING AND MESSAGE DISPATCH ---
        async function sendAIMessage(text) {
            if ((!text.trim() && state.pendingAttachments.length === 0) || state.isGenerating) return;
            const textarea = document.getElementById('ai-input');
            textarea.value = '';
            textarea.style.height = 'auto';
            
            let messageContent = text;

            // Process Attachments
            if (state.pendingAttachments.length > 0) {
                messageContent = [{ type: "text", text: text || "Review these files:" }];
                state.pendingAttachments.forEach(att => {
                    if (att.type.startsWith('image/')) {
                        messageContent.push({ type: "image_url", image_url: { url: att.data } });
                    } else {
                        messageContent[0].text += `\n\n[Content of ${att.name}]:\n${att.data}`;
                    }
                });
                state.pendingAttachments = []; // Clear after attaching
            }

            state.aiMessages.push({ role: 'user', content: messageContent });
            state.isGenerating = true;
            renderAIPanel(document.getElementById('ai-sidebar-content')); // refresh UI for user message
            
            const chatContainer = document.getElementById('ai-chat-history');
            await processAIStream(chatContainer);
        }

        async function processAIStream(chatContainer) {
            state.abortController = new AbortController();
            
            // Remove loader if present before creating text bubble
            const existingLoader = chatContainer.querySelector('.ai-loader-container');
            if (existingLoader) existingLoader.remove();

            const aiBubbleWrapper = document.createElement('div');
            aiBubbleWrapper.className = "flex items-start gap-3 w-full font-sans";
            aiBubbleWrapper.innerHTML = `
                <img src="assets/ventarys.png" class="w-8 h-8 rounded-full shadow-sm shrink-0 mt-1 object-cover dark:invert" onerror="this.outerHTML='<i class=&quot;ri-robot-2-line text-2xl opacity-90 shrink-0 mt-1&quot;></i>'">
                <div class="markdown-body bg-transparent w-full overflow-x-auto text-[13px] leading-relaxed max-w-[calc(100%-2.5rem)]" id="streaming-content"></div>
            `;
            chatContainer.appendChild(aiBubbleWrapper);
            chatContainer.scrollTop = chatContainer.scrollHeight;

            let streamContentDiv = aiBubbleWrapper.querySelector('#streaming-content');
            let fullResponse = "";
            let isToolCall = false;
            let toolCallData = { id: "", name: "", arguments: "" };

            try {
                const tools = [
                    { type: "function", function: { name: "leer_archivo_actual", description: "Reads the currently opened code.", parameters: { type: "object", properties: {} } } },
                    { type: "function", function: { name: "listar_archivos_proyecto", description: "Shows the folder and files.", parameters: { type: "object", properties: {} } } },
                    { type: "function", function: { name: "modificar_archivo_actual", description: "Completely overwrites the currently visible editor file.", parameters: { type: "object", properties: { nuevo_codigo: { type: "string" } }, required: ["nuevo_codigo"] } } },
                    { type: "function", function: { name: "ejecutar_comando_terminal", description: "Executes a command in the IDE CLI (e.g., npm install).", parameters: { type: "object", properties: { comando: { type: "string" } }, required: ["comando"] } } },
                    { type: "function", function: { name: "leer_archivo", description: "Reads a specific file from the project directory.", parameters: { type: "object", properties: { nombre: { type: "string", description: "File name or relative path" } }, required: ["nombre"] } } },
                    { type: "function", function: { name: "eliminar_archivo", description: "Deletes a specific file from the directory.", parameters: { type: "object", properties: { nombre: { type: "string" } }, required: ["nombre"] } } },
                    { type: "function", function: { name: "crear_archivo", description: "Creates a new file in the project folder.", parameters: { type: "object", properties: { nombre: { type: "string" }, contenido: { type: "string" } }, required: ["nombre", "contenido"] } } },
                    { type: "function", function: { name: "editar_archivo", description: "Edits and replaces the code of a specific file inside the project.", parameters: { type: "object", properties: { nombre: { type: "string" }, nuevo_codigo: { type: "string" } }, required: ["nombre", "nuevo_codigo"] } } }
                ];
                
                const finalSystemPrompt = BASE_PROMPT + (state.governancePrompt ? "\n\n[USER DEFINED GOVERNANCE RULES]:\n" + state.governancePrompt : "");
                const payload = { model: state.selectedModel, messages: [ { role: 'system', content: finalSystemPrompt }, ...state.aiMessages ], tools: tools, tool_choice: "auto", stream: true };

                const conf = getApiConfig();
                const response = await fetch(`${conf.baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${conf.key}` }, body: JSON.stringify(payload), signal: state.abortController.signal });
                
                if (!response.ok) throw new Error("API Failure: " + response.statusText);

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                
                while(true) {
                    const { done, value } = await reader.read();
                    if(done) break;
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');
                    
                    for (const line of lines) {
                        if (line.includes('[DONE]')) break;
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                const delta = data.choices[0].delta;
                                if (delta.tool_calls) {
                                    isToolCall = true;
                                    const tc = delta.tool_calls[0];
                                    if(tc.id) toolCallData.id = tc.id;
                                    if(tc.function.name) toolCallData.name += tc.function.name;
                                    if(tc.function.arguments) toolCallData.arguments += tc.function.arguments;
                                } else if (delta.content) {
                                    fullResponse += delta.content;
                                    streamContentDiv.innerHTML = marked.parse(fullResponse + ' █');
                                    chatContainer.scrollTop = chatContainer.scrollHeight;
                                }
                            } catch(e) {}
                        }
                    }
                }

                streamContentDiv.innerHTML = marked.parse(fullResponse);

                if (isToolCall) {
                    streamContentDiv.innerHTML = `<div class="text-[11px] text-blue-500 font-mono border-l-2 border-blue-500 pl-2 opacity-80 my-1 py-1"><i class="ri-tools-line"></i> Executing: <b>${toolCallData.name}</b>...</div>`;
                    state.aiMessages.push({ role: "assistant", content: null, tool_calls: [{ id: toolCallData.id, type: "function", function: { name: toolCallData.name, arguments: toolCallData.arguments } }] });
                    
                    let toolResult = await executeToolEnhanced(toolCallData.name, toolCallData.arguments);
                    state.aiMessages.push({ role: "tool", tool_call_id: toolCallData.id, content: toolResult });
                    
                    aiBubbleWrapper.remove();
                    return await processAIStream(chatContainer);
                } else {
                    state.aiMessages.push({ role: 'assistant', content: fullResponse });
                }

            } catch (err) {
                if (err.name === 'AbortError') {
                    fullResponse += "\n\n*(Generation stopped)*";
                    streamContentDiv.innerHTML = marked.parse(fullResponse);
                    state.aiMessages.push({ role: 'assistant', content: fullResponse });
                } else {
                    streamContentDiv.innerHTML = `<div class="text-red-500 text-sm">Error: ${err.message}</div>`;
                }
            } finally {
                if (!isToolCall) {
                    state.isGenerating = false;
                    state.abortController = null;
                    if(state.isAIOpen) renderAIPanel(document.getElementById('ai-sidebar-content'));
                }
            }
        }

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
        
        window.applyUpdate = async function(downloadUrl, version) {
            if (confirm(`Update to ${version}? The app will restart automatically.`)) {
                try {
                    const result = await window.electronAPI.applyUpdate({ downloadUrl, version });
                    if (!result.success) {
                        alert('Update failed: ' + result.error);
                    }
                } catch (e) {
                    // Fallback: open releases page
                    window.open('https://github.com/Juanoto2012/Ventarys-IDX/releases', '_blank');
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
          }
          
          // Check for updates on startup
          setTimeout(checkForUpdates, 3000);

        // --- CUSTOM PROVIDERS SYSTEM ---
        function saveCustomProviders() {
            localStorage.setItem('ventarys_customProviders', JSON.stringify(state.customProviders));
        }

        window.addCustomProvider = function() {
            const name = prompt('Provider name:');
            if (!name) return;
            const url = prompt('API URL (must end with /v1):');
            if (!url) return;
            const finalUrl = url.endsWith('/v1') ? url : url.replace(/\/+$/, '') + '/v1';
            const noKey = confirm('Does this provider require an API key?');
            let key = '';
            if (!noKey) {
                key = prompt('API Key:') || '';
            }
            state.customProviders.push({ name, url: finalUrl, noKey, key });
            saveCustomProviders();
            renderAIPanel(document.getElementById('ai-sidebar-content'));
        };

        window.deleteCustomProvider = function(index) {
            if (confirm(`Delete provider "${state.customProviders[index].name}"?`)) {
                state.customProviders.splice(index, 1);
                saveCustomProviders();
                renderAIPanel(document.getElementById('ai-sidebar-content'));
            }
        };

        window.editCustomProvider = function(index) {
            state.editingProviderIndex = index;
            const cp = state.customProviders[index];
            const name = prompt('Provider name:', cp.name);
            if (!name) return;
            const url = prompt('API URL:', cp.url);
            if (!url) return;
            const finalUrl = url.endsWith('/v1') ? url : url.replace(/\/+$/, '') + '/v1';
            const noKey = confirm('Does this provider require an API key?');
            let key = '';
            if (!noKey) key = prompt('API Key:', cp.key) || '';
            state.customProviders[index] = { name, url: finalUrl, noKey, key };
            saveCustomProviders();
            renderAIPanel(document.getElementById('ai-sidebar-content'));
        };

        function getAllApiConfigs() {
            const configs = [
                { id: 'agnes', name: 'Agnes', baseUrl: 'https://apihub.agnes-ai.com/v1', key: state.apiKeys.agnes, noKey: false },
                { id: 'aqua', name: 'AquaDevs', baseUrl: 'https://api.aquadevs.com/v1', key: state.apiKeys.aquadevs, noKey: false }
            ];
            state.customProviders.forEach((cp, i) => {
                configs.push({ id: `custom_${i}`, name: cp.name, baseUrl: cp.url, key: cp.key, noKey: cp.noKey });
            });
            return configs;
        }

        // --- CONTEXT MENU SYSTEM ---
        function setupContextMenu() {
            const ctxMenu = document.getElementById('context-menu');
            
            const contextTargets = [
                'monaco-container', 'terminal-container', 'ai-chat-history', 'ai-input',
                'ai-key-input', 'sidebar-content', 'editor-placeholder'
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
                
                let x = e.clientX;
                let y = e.clientY;
                
                const menuW = 200;
                const menuH = 250;
                if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 10;
                if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 10;
                
                ctxMenu.style.left = x + 'px';
                ctxMenu.style.top = y + 'px';
                ctxMenu.classList.remove('hidden');
            });
            
            document.addEventListener('click', () => {
                ctxMenu.classList.add('hidden');
            });
            
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    ctxMenu.classList.add('hidden');
                }
            });
        }

        window.contextMenuAction = function(action) {
            document.getElementById('context-menu').classList.add('hidden');
            
            const target = state.contextTarget;
            const isTextInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
            
            switch(action) {
                case 'cut':
                    if (isTextInput && target.readyState !== 0) {
                        document.execCommand('cut');
                    } else if (monacoEditor) {
                        monacoEditor.trigger('contextmenu', 'editor.action.cut');
                    }
                    break;
                case 'copy':
                    if (isTextInput && target.readyState !== 0) {
                        document.execCommand('copy');
                    } else if (monacoEditor) {
                        monacoEditor.trigger('contextmenu', 'editor.action.clipboardCopyAction');
                    }
                    break;
                case 'paste':
                    if (isTextInput && target.readyState !== 0) {
                        navigator.clipboard.readText().then(text => {
                            const start = target.selectionStart;
                            const end = target.selectionEnd;
                            target.value = target.value.substring(0, start) + text + target.value.substring(end);
                            target.selectionStart = target.selectionEnd = start + text.length;
                            target.dispatchEvent(new Event('input', { bubbles: true }));
                        }).catch(() => document.execCommand('paste'));
                    } else if (monacoEditor) {
                        monacoEditor.trigger('contextmenu', 'editor.action.clipboardPasteAction');
                    }
                    break;
                case 'selectAll':
                    if (isTextInput && target.readyState !== 0) {
                        target.select();
                    } else if (monacoEditor) {
                        monacoEditor.trigger('contextmenu', 'editor.action.selectAll');
                    }
                    break;
                case 'formatCode':
                    window.formatEditorCode();
                    break;
                case 'inlineAI':
                    if (state.activeFileHandle) {
                        const box = document.getElementById('inline-ai-box');
                        box.classList.remove('hidden');
                        document.getElementById('inline-ai-input').focus();
                    }
                    break;
            }
        };

        // --- OUTPUT PANEL SYSTEM ---
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
            
            // Keep DOM manageable
            const allLines = content.querySelectorAll('.output-line');
            if (allLines.length > 100) {
                Array.from(allLines).slice(0, allLines.length - 100).forEach(l => l.remove());
            }
        }

        window.toggleOutputPanel = function() {
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

        window.clearOutput = function() {
            const content = document.getElementById('output-container');
            if (content) content.innerHTML = '<div class="text-zinc-500 text-xs italic p-2">Output cleared.</div>';
            state.outputLines = [];
        };

        // --- ENHANCED TOOL SYSTEM WITH CUSTOM PROVIDERS ---
        async function executeToolWithProvider(name, argsString, providerOverride) {
            const conf = providerOverride || getApiConfig();
            const allProviders = getAllApiConfigs();
            let activeKey = conf.key;
            let activeBaseUrl = conf.baseUrl;
            
            if (providerOverride) {
                activeKey = providerOverride.key;
                activeBaseUrl = providerOverride.baseUrl;
            } else {
                activeKey = getActiveKey();
                activeBaseUrl = getApiConfig().baseUrl;
            }
            
            if (!activeKey) return "Error: No API key configured.";
            
            try {
                const args = JSON.parse(argsString);
                
                if (name === 'leer_archivo_actual') {
                    if (!activeFilePath || !monacoEditor) return "Error: No file open.";
                    return `[${activeFilePath}]:\n${monacoEditor.getValue()}`;
                }
                
                if (name === 'listar_archivos_proyecto') {
                    if (!state.fileSystemRoot) return "Error: No folder opened.";
                    const listAll = (nodes) => nodes.map(n => n.type === 'folder' ? `[DIR] ${n.name}` : n.name).join('\n');
                    return `Root: ${state.fileSystemRoot.name}\nFiles in root:\n${listAll(state.fileSystemRoot.children)}`;
                }

                if (name === 'leer_archivo') {
                    if (!state.fileSystemRoot) return "Error: Open workspace first.";
                    const node = await getNodeByPath(args.nombre, state.fileSystemRoot);
                    if (!node || node.type !== 'file') return `Error: File ${args.nombre} not found.`;
                    if (window.electronAPI && window.electronAPI.readFile) {
                        const result = await window.electronAPI.readFile(node.handle);
                        if (result.error) return `Error: ${result.error}`;
                        return result.content;
                    }
                    const file = await node.handle.getFile();
                    return await file.text();
                }

                if (name === 'eliminar_archivo') {
                    if (!state.fileSystemRoot) return "Error: Open workspace first.";
                    if (window.electronAPI && window.electronAPI.readFile) {
                        const fs = require('fs');
                        const path = require('path');
                        const fullPath = path.join(state.fileSystemRoot.handle, args.nombre);
                        fs.unlinkSync(fullPath);
                    } else {
                        await state.fileSystemRoot.handle.removeEntry(args.nombre);
                    }
                    state.fileSystemRoot.children = [];
                    await loadDirectoryContents(state.fileSystemRoot.handle, state.fileSystemRoot.children);
                    renderSidebar();
                    return `Success: ${args.nombre} was deleted.`;
                }

                if (name === 'crear_archivo') {
                    if (!state.fileSystemRoot) return "Error: Open workspace first.";
                    const content = args.contenido || '';
                    if (window.electronAPI && window.electronAPI.readFile) {
                        const fs = require('fs');
                        const path = require('path');
                        const fullPath = path.join(state.fileSystemRoot.handle, args.nombre);
                        fs.writeFileSync(fullPath, content, 'utf8');
                    } else {
                        const rootHandle = state.fileSystemRoot.handle;
                        const newFileHandle = await rootHandle.getFileHandle(args.nombre, {create: true});
                        const writable = await newFileHandle.createWritable();
                        await writable.write(content);
                        await writable.close();
                    }
                    
                    state.fileSystemRoot.children = [];
                    await loadDirectoryContents(state.fileSystemRoot.handle, state.fileSystemRoot.children);
                    renderSidebar();
                    return `Success: File ${args.nombre} was successfully created.`;
                }

                if (name === 'editar_archivo') {
                     if (!state.fileSystemRoot) return "Error: Open workspace first.";
                     const node = await getNodeByPath(args.nombre, state.fileSystemRoot);
                     if (!node || node.type !== 'file') return `Error: File ${args.nombre} not found.`;
                     if (window.electronAPI && window.electronAPI.readFile) {
                         const fs = require('fs');
                         const path = require('path');
                         const fullPath = path.join(node.handle, args.nombre);
                         fs.writeFileSync(fullPath, args.nuevo_codigo, 'utf8');
                     } else {
                         const writable = await node.handle.createWritable();
                         await writable.write(args.nuevo_codigo);
                         await writable.close();
                     }
                      
                       if (activeFilePath && node.handle === activeFilePath && monacoEditor) {
                           monacoEditor.setValue(args.nuevo_codigo);
                       }
                       return `Success: File ${args.nombre} updated correctly.`;
                  }
                  
                  if (name === 'modificar_archivo_actual') {
                       if (activeFilePath && monacoEditor) { monacoEditor.setValue(args.nuevo_codigo); return "Code injected successfully into the editor."; }
                      return "Error: No file open.";
                }
                
                if (name === 'ejecutar_comando_terminal') {
                     if (window.electronAPI) { window.electronAPI.terminalInput(args.comando + '\r'); return `The command '${args.comando}' was sent.`; }
                     else if (xtermInstance) { xtermInstance.writeln(`\r\n\x1b[33m$ ${args.comando}\x1b[0m`); return `The command '${args.comando}' was simulated in Web Mode.`; }
                     return "Error: Terminal not available.";
                }
                return `Error: Tool ${name} does not exist.`;
            } catch(e) { return "Error executing tool: " + e.message; }
        }

        // Override executeTool to use enhanced version
        const originalExecuteTool = executeTool;
        window.executeToolEnhanced = executeToolWithProvider;