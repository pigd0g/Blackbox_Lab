// ======================================================
// BLACKBOX LAB — PRELOAD
// ======================================================
//
// Exposes a minimal, safe bridge to the renderer:
// reading the bundled sample flights (so "Try a sample"
// works with one click, no file dialog).
//
// ======================================================

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("blackboxLab", {
  readSampleLog: (name) => ipcRenderer.invoke("read-sample-log", name),
  readSampleText: (name) => ipcRenderer.invoke("read-sample-text", name),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  listSampleLogs: () => ipcRenderer.invoke("list-sample-logs"),
  // The flight report as a PDF: the main process renders the
  // report HTML in a hidden window and prints it — Chromium's own
  // layout, the same on every machine.
  exportReportPdf: (html, suggestedName) =>
    ipcRenderer.invoke("export-report-pdf", { html, suggestedName }),
  revealPath: (filePath) => ipcRenderer.invoke("reveal-path", filePath)
});
