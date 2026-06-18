const {contextBridge, ipcRenderer} = require("electron");

contextBridge.exposeInMainWorld("ContentBridge", {
  getLatestWxData: () => ipcRenderer.invoke("getLatestWxData"),
  getLabelName: () => ipcRenderer.invoke("getLabelName"),
  getWxHistory: () => ipcRenderer.invoke("getWxHistory"),
  clearHistory: () => ipcRenderer.invoke("clearHistory"),
  on: (channel, callback) => ipcRenderer.on(channel, (event, argv) => callback(event, argv)),
});
