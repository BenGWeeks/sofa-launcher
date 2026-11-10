const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('s1', { sandboxed: process.sandboxed === true });
