/**
 * Underleaf — preload
 * Bridges native file/folder dialogs and Finder drop paths to the renderer.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('__UNDERLEAF_ELECTRON__', true);

contextBridge.exposeInMainWorld('electronAPI', {
  // Native pickers (return a path string, or null if cancelled).
  chooseFolder:  () => ipcRenderer.invoke('choose-folder'),
  chooseTexFile: () => ipcRenderer.invoke('choose-tex'),
  // Reveal a path in Finder.
  openFolder:    (p) => ipcRenderer.invoke('open-in-finder', p),
  // Resolve the absolute filesystem path of a dropped File (Finder drag-drop).
  pathForFile:   (file) => {
    try { return webUtils.getPathForFile(file); }
    catch { return (file && file.path) || ''; }
  },
});
