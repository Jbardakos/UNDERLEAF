/**
 * Underleaf — Electron Entry Point
 * Embeds the Express server, opens a desktop window
 */

const { app, BrowserWindow, Menu, shell, dialog, nativeImage } = require('electron');
const path = require('path');
const http = require('http');

// ─── Port negotiation ────────────────────────────────────────────────────────

let PORT = 3737;

async function findFreePort(start) {
  return new Promise((resolve) => {
    const srv = require('net').createServer();
    srv.once('error', () => resolve(findFreePort(start + 1)));
    srv.once('listening', () => { srv.close(() => resolve(start)); });
    srv.listen(start, '127.0.0.1');
  });
}

// ─── Start embedded Express server ───────────────────────────────────────────

async function startServer(port) {
  // Inject PORT before loading server module
  process.env.PORT = String(port);
  // Load server — it calls server.listen() internally
  require('./server.js');
}

// ─── Wait for server ready ────────────────────────────────────────────────────

function waitForServer(port, retries = 30) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const check = () => {
      http.get(`http://127.0.0.1:${port}/api/status`, (res) => {
        if (res.statusCode === 200) resolve();
        else retry();
      }).on('error', retry);
    };
    const retry = () => {
      tries++;
      if (tries >= retries) reject(new Error('Server did not start'));
      else setTimeout(check, 300);
    };
    check();
  });
}

// ─── Window ──────────────────────────────────────────────────────────────────

let mainWindow;

async function createWindow() {
  PORT = await findFreePort(3737);
  await startServer(PORT);

  const splash = new BrowserWindow({
    width: 480, height: 300,
    frame: false, transparent: true,
    alwaysOnTop: true, resizable: false,
    webPreferences: { contextIsolation: true },
  });
  splash.loadURL(`data:text/html,
    <style>
      body{margin:0;background:#000;display:flex;flex-direction:column;
           align-items:center;justify-content:center;height:100vh;
           font-family:monospace;color:#444}
      .logo{font-size:22px;letter-spacing:0.2em;color:#fff;margin-bottom:12px}
      .sub{font-size:11px;letter-spacing:0.15em;color:#555}
      .dot{animation:pulse 0.8s infinite alternate}
      @keyframes pulse{to{opacity:0.2}}
    </style>
    <div class="logo">UNDERLEAF</div>
    <div class="sub">Starting<span class="dot">…</span></div>
  `);

  try {
    await waitForServer(PORT);
  } catch {
    dialog.showErrorBox('Underleaf', 'Failed to start the local server. Please try again.');
    app.quit(); return;
  }

  mainWindow = new BrowserWindow({
    width: 1440, height: 900,
    minWidth: 900, minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  mainWindow.once('ready-to-show', () => {
    splash.close();
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links (PDF, GitHub, docs) in real browser
    if (!url.startsWith(`http://127.0.0.1:${PORT}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  buildMenu();
}

// ─── App menu ────────────────────────────────────────────────────────────────

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ]}] : []),
    { label: 'File', submenu: [
      { label: 'New Project…', accelerator: 'CmdOrCtrl+Shift+N',
        click() { mainWindow?.webContents.executeJavaScript('showNewProject()'); } },
      { type: 'separator' },
      { label: 'Open Projects Folder',
        click() {
          const dir = path.join(require('os').homedir(), 'dark-underleaf', 'projects');
          shell.openPath(dir);
        }
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ]},
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' },
      { label: 'Find / Replace', accelerator: 'CmdOrCtrl+H',
        click() { mainWindow?.webContents.executeJavaScript("S.editor?.trigger('menu','editor.action.startFindReplaceAction',{})"); } },
    ]},
    { label: 'Compile', submenu: [
      { label: 'Compile Document', accelerator: 'CmdOrCtrl+Return',
        click() { mainWindow?.webContents.executeJavaScript('compile()'); } },
      { type: 'separator' },
      { label: 'pdflatex',  click() { mainWindow?.webContents.executeJavaScript("document.getElementById('engine-sel').value='pdflatex'"); } },
      { label: 'xelatex',   click() { mainWindow?.webContents.executeJavaScript("document.getElementById('engine-sel').value='xelatex'"); } },
      { label: 'lualatex',  click() { mainWindow?.webContents.executeJavaScript("document.getElementById('engine-sel').value='lualatex'"); } },
    ]},
    { label: 'View', submenu: [
      { label: 'Mind Map', accelerator: 'CmdOrCtrl+Alt+M',
        click() { mainWindow?.webContents.executeJavaScript('toggleMindMap()'); } },
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      { label: 'Developer Tools', accelerator: 'CmdOrCtrl+Alt+I',
        click() { mainWindow?.webContents.toggleDevTools(); } },
    ]},
    { label: 'Help', submenu: [
      { label: 'Keyboard Shortcuts',
        click() { mainWindow?.webContents.executeJavaScript('showHelp()'); } },
      { type: 'separator' },
      { label: 'Open Data Folder',
        click() { shell.openPath(path.join(require('os').homedir(), 'dark-underleaf')); } },
      { label: 'TeX Live / MiKTeX Download',
        click() { shell.openExternal('https://www.tug.org/texlive/'); } },
      ...(!isMac ? [{ type: 'separator' }, { role: 'about' }] : []),
    ]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
