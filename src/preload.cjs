const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('onggi', {
  action: (action, payload) => ipcRenderer.invoke('action', action, payload),
  onState: callback => { ipcRenderer.on('state', (_event, state) => callback(state)); },
  onTab: callback => { ipcRenderer.on('show-tab', (_event, tab) => callback(tab)); },
  onPetPointer: callback => { ipcRenderer.on('pet-pointer', (_event, pointer) => callback(pointer)); },
  onPetLayoutChanged: callback => { ipcRenderer.on('pet-layout-changed', () => callback()); },
  onBubblePlacement: callback => { ipcRenderer.on('bubble-placement', (_event,position) => callback(position)); }
});
