const { contextBridge, ipcRenderer,webUtils } = require('electron');
const attachmentListeners=new Set();let attachmentInputPending=false;
contextBridge.exposeInMainWorld('onggi', {
  action: (action, payload) => ipcRenderer.invoke('action', action, payload),
  onState: callback => { ipcRenderer.on('state', (_event, state) => callback(state)); },
  onTab: callback => { ipcRenderer.on('show-tab', (_event, tab) => callback(tab)); },
  onPetPointer: callback => { ipcRenderer.on('pet-pointer', (_event, pointer) => callback(pointer)); },
  onPetLayoutChanged: callback => { ipcRenderer.on('pet-layout-changed', () => callback()); },
  onBubblePlacement: callback => { ipcRenderer.on('bubble-placement', (_event,position) => callback(position)); },
  onAttachments:callback=>{attachmentListeners.add(callback);},
  onNotificationOpen:callback=>{ipcRenderer.on('notification-open',(_event,payload)=>callback(payload));}
});
for(const kind of ['drop','paste','click'])window.addEventListener(kind,async event=>{
  if(!event.isTrusted||!document.querySelector('#panel-surface')||document.querySelector('#panel-surface').hidden)return;
  let files;
  if(kind==='drop'){
    if(!event.dataTransfer?.files.length)return;event.preventDefault();
    if(event.dataTransfer.files.length>8){for(const callback of attachmentListeners)callback({ok:false,error:'첨부는 최대 8개까지 가능해요.'});return;}
    try{files=Array.from(event.dataTransfer.files,file=>webUtils.getPathForFile(file));}
    catch(error){for(const callback of attachmentListeners)callback({ok:false,error:error.message});return;}
  }else if(kind==='paste'){
    if(event.target!==document.querySelector('#prompt')||event.clipboardData?.getData('text/plain')||!Array.from(event.clipboardData?.items??[]).some(item=>item.kind==='file'&&item.type.startsWith('image/')))return;
    event.preventDefault();
  }else if(!event.target.closest?.('#paste-image'))return;
  if(attachmentInputPending)return;attachmentInputPending=true;
  for(const callback of attachmentListeners)callback({pending:true});
  try{const result=await ipcRenderer.invoke('attachment-input',{kind:kind==='drop'?'drop':'clipboard',files});for(const callback of attachmentListeners)callback(result);}
  catch(error){for(const callback of attachmentListeners)callback({ok:false,error:error.message});}
  finally{attachmentInputPending=false;}
});
window.addEventListener('dragover',event=>{if(document.querySelector('#panel-surface')&&!document.querySelector('#panel-surface').hidden&&Array.from(event.dataTransfer?.types??[]).includes('Files'))event.preventDefault();});
