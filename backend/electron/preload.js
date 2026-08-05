const { contextBridge, ipcRenderer } = require('electron');

// contextBridge.exposeInMainWorld can only pass values across the context-isolation boundary that
// it can clone (plain functions, plain objects/arrays, primitives) — a Proxy is none of those, and
// silently fails ("An object could not be cloned") the moment the renderer touches ANY property on
// it. So the ergonomic window.api.<feature>.<action>(payload) sugar (Proxy-based, to avoid
// hand-listing every action for every feature) is built in the RENDERER's own JS instead — see
// frontend/src/lib/ipcBridge.ts, which wraps this one raw primitive. Only a single real function
// crosses the bridge here.
contextBridge.exposeInMainWorld('__ipcInvoke', (channel, payload) => ipcRenderer.invoke(channel, payload));
