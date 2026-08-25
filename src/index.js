const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Test harnesses point this at a throwaway directory so probe runs
// never share Health Record / settings state with a real install.
if (process.env.BLACKBOX_LAB_USER_DATA) {
  app.setPath('userData', process.env.BLACKBOX_LAB_USER_DATA);
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// ---- sample flights bridge (read-only, whitelisted) ----
const samplesDirectory = path.join(__dirname, '..', 'samples');

// Open release pages in the pilot's real browser — only the
// project's own GitHub URLs are allowed through.
ipcMain.handle('open-external', (event, url) => {
  if (typeof url === 'string' &&
      url.startsWith('https://github.com/hillbilly1975/Blackbox_Lab')) {
    shell.openExternal(url);
  }
});

ipcMain.handle('list-sample-logs', () => {
  try {
    return fs
      .readdirSync(samplesDirectory)
      .filter((name) => name.toLowerCase().endsWith('.bbl'));
  } catch {
    return [];
  }
});

ipcMain.handle('read-sample-log', (event, name) => {
  const safeName = path.basename(String(name));

  if (!safeName.toLowerCase().endsWith('.bbl')) {
    return null;
  }

  try {
    return fs.readFileSync(path.join(samplesDirectory, safeName));
  } catch {
    return null;
  }
});

// Academy companion files (the stale-dump teaching pair):
// text only, same whitelisted directory.
ipcMain.handle('read-sample-text', (event, name) => {
  const safeName = path.basename(String(name));

  if (!safeName.toLowerCase().endsWith('.txt')) {
    return null;
  }

  try {
    return fs.readFileSync(
      path.join(samplesDirectory, safeName),
      'utf8'
    );
  } catch {
    return null;
  }
});

// ---- flight report → PDF ----
// The renderer builds the report HTML (self-contained, chart
// images inline); this side asks where to save it, renders the
// HTML in a hidden window and prints it to PDF with Chromium's
// own engine. A4, backgrounds kept (the masthead and the dark
// chart panels are part of the report's identity). The temp file
// exists only for the duration of the render.
let lastReportSavePath = null;

ipcMain.handle('export-report-pdf', async (event, payload) => {
  const html = typeof payload?.html === 'string' ? payload.html : null;
  const suggestedName =
    typeof payload?.suggestedName === 'string' && payload.suggestedName
      ? path.basename(payload.suggestedName)
      : 'blackbox-lab-report.pdf';

  if (!html) {
    return { ok: false, error: 'no report to render' };
  }

  const owner = BrowserWindow.fromWebContents(event.sender);
  const defaultDirectory =
    lastReportSavePath
      ? path.dirname(lastReportSavePath)
      : app.getPath('documents');

  // The UI smoke test cannot drive a native save dialog: when it
  // sets this directory, the report lands there unasked. Unset in
  // any real run, so the pilot always chooses.
  const smokeDirectory = process.env.BLACKBOX_LAB_SMOKE_PDF_DIR;

  const { canceled, filePath } = smokeDirectory
    ? { canceled: false, filePath: path.join(smokeDirectory, suggestedName) }
    : await dialog.showSaveDialog(owner, {
        title: 'Save flight report',
        defaultPath: path.join(defaultDirectory, suggestedName),
        filters: [{ name: 'PDF report', extensions: ['pdf'] }]
      });

  if (canceled || !filePath) {
    return { ok: false, canceled: true };
  }

  const tempPath = path.join(
    app.getPath('temp'),
    `blackbox-lab-report-${process.pid}-${Date.now()}.html`
  );

  const printer = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  try {
    fs.writeFileSync(tempPath, html, 'utf8');
    await printer.loadFile(tempPath);

    const pdf = await printer.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0.45, bottom: 0.45, left: 0.4, right: 0.4 }
    });

    fs.writeFileSync(filePath, pdf);
    lastReportSavePath = filePath;
    return { ok: true, path: filePath };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  } finally {
    if (!printer.isDestroyed()) {
      printer.destroy();
    }
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // nothing to clean
    }
  }
});

// Show the saved report in the file manager — only a path this
// process itself wrote.
ipcMain.handle('reveal-path', (event, filePath) => {
  if (typeof filePath === 'string' && filePath === lastReportSavePath) {
    shell.showItemInFolder(filePath);
  }
});

app.whenReady().then(() => {
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
