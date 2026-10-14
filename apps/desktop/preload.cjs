const { contextBridge, ipcRenderer } = require("electron");

/**
 * The only bridge the web client can see. Kept as CommonJS because sandboxed
 * Electron preloads cannot load ESM. The page never gets Node or Electron
 * APIs — just this small surface.
 */
const meta = ipcRenderer.sendSync("nimbus:meta");

contextBridge.exposeInMainWorld("nimbus", {
  platform: process.platform,
  version: meta.version,
  isElectron: true,
  serverUrl: meta.serverUrl,
  openExternal(url) {
    return ipcRenderer.invoke("nimbus:open-external", url);
  },
  pickFolder() {
    return ipcRenderer.invoke("nimbus:pick-folder");
  },
  window: {
    minimize() { ipcRenderer.send("nimbus:win", "minimize"); },
    maximize() { ipcRenderer.send("nimbus:win", "maximize"); },
    close() { ipcRenderer.send("nimbus:win", "close"); },
    isMaximized() { return ipcRenderer.invoke("nimbus:win-maximized"); },
  },
  updater: {
    checkForUpdates() {
      return ipcRenderer.invoke("nimbus:check-for-updates");
    },
    installUpdate() {
      return ipcRenderer.invoke("nimbus:install-update");
    },
    onStatus(callback) {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("nimbus:update-status", listener);
      return () => ipcRenderer.removeListener("nimbus:update-status", listener);
    },
  },
});
