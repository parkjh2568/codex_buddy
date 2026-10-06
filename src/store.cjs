const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

class Store {
  constructor(directory, defaults) {
    this.directory = directory;
    this.file = path.join(directory, 'state.json');
    this.historyDirectory = path.join(directory, 'conversations');
    this.warning = null;
    this.snapshot = null;
    this.writeBlocked = false;
    this.journalFile = path.join(directory,'save-journal.json');
    this.deleteFile=path.join(directory,'delete-journal.json');
    this.pendingDeletion=null;
    fs.mkdirSync(this.historyDirectory, { recursive: true });
    this.data = { version: 2, settings: { ...defaults }, threadId: null, messages: [], activeConversationId: null, conversations: [] };
    try { this.recoverPendingSave(); }
    catch(error) { this.writeBlocked=true;this.warning=`저장 복구가 필요합니다. 원본을 보존했습니다: ${error.message}`; }
    try {
      if (fs.existsSync(this.file)) {
        if (fs.statSync(this.file).size > 8 * 1024 * 1024) throw new Error('저장 파일 크기를 확인해주세요.');
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (![1,2].includes(saved.version)) throw new Error('저장 형식이 올바르지 않습니다.');
        this.data.settings = { ...defaults, ...saved.settings };
        if (saved.version === 1) {
          if (!Array.isArray(saved.messages)) throw new Error('저장 형식이 올바르지 않습니다.');
          this.data.threadId = typeof saved.threadId === 'string' ? saved.threadId : null;
          this.data.messages = saved.messages.filter(m => m && typeof m.id === 'string' && ['user','assistant','system'].includes(m.role) && typeof m.text === 'string').map(m => ({ ...m, text: m.text.slice(0,100000), status: ['queued','running'].includes(m.status) ? 'interrupted' : m.status }));
          fs.copyFileSync(this.file, this.file + `.backup-v1-${Date.now()}`);
          this.save();
        } else {
          if (!Array.isArray(saved.conversations)) throw new Error('대화 목록 형식이 올바르지 않습니다.');
          this.data.conversations = saved.conversations.filter(c => c && /^[a-f0-9-]{36}$/.test(c.id) && c.source === 'onggi_bot' && typeof c.title === 'string');
          const active = this.data.conversations.find(c => c.id === saved.activeConversationId);
          if (active) {
            const file = path.join(this.historyDirectory, active.id + '.json');
            if (fs.statSync(file).size > 32 * 1024 * 1024) throw new Error('대화 기록이 너무 큽니다.');
            const history = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (history.id !== active.id || history.source !== 'onggi_bot' || !Array.isArray(history.messages)) throw new Error('대화 기록 형식이 올바르지 않습니다.');
            this.data.activeConversationId = active.id;
            this.data.threadId = typeof history.threadId === 'string' ? history.threadId : null;
            this.data.messages = history.messages.filter(m => m && typeof m.id === 'string' && ['user','assistant','system'].includes(m.role) && typeof m.text === 'string').map(m => ({ ...m, text: m.text.slice(0,100000), status: ['queued','running'].includes(m.status) ? 'interrupted' : m.status }));
            this.snapshot = JSON.stringify(history);
          }
        }
      }
    } catch (error) {
      this.warning = `대화 기록을 읽지 못했습니다. 원본을 보존했습니다: ${error.message}`;
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + `.backup-${Date.now()}`);
      this.data.activeConversationId = null; this.data.threadId = null; this.data.messages = [];
    }
    try {this.recoverPendingDeletion();}catch{}
  }
  beginDeletion(id) {
    if(this.writeBlocked)throw new Error('저장 복구 후 대화를 삭제해주세요.');
    const selected=this.data.conversations.find(c=>c.id===id&&c.source==='onggi_bot');
    if(!selected)throw new Error('옹기봇에서 만든 대화만 삭제할 수 있습니다.');
    if(this.pendingDeletion){if(this.pendingDeletion.id!==id)throw new Error('삭제 확인이 끝나지 않은 이전 대화를 먼저 처리해주세요.');return;}
    this.save();
    const pending={version:1,id,ids:[id],phase:'pending',threadId:selected.threadId??null,codexPath:selected.codexPath??null,workspace:selected.workspace??null};
    fs.writeFileSync(this.deleteFile+'.tmp',JSON.stringify(pending),{mode:0o600});fs.renameSync(this.deleteFile+'.tmp',this.deleteFile);this.pendingDeletion=pending;
  }

  completeDeletion(ids) {
    if(this.writeBlocked||fs.existsSync(this.journalFile))throw new Error('저장 복구를 마친 뒤 삭제 정리를 다시 시도해주세요.');
    if(!this.pendingDeletion)throw new Error('확인된 삭제 요청이 없습니다.');
    const pending={...this.pendingDeletion,phase:'cli-deleted',ids:[...new Set([this.pendingDeletion.id,...ids])]};
    if(!pending.ids.every(id=>/^[a-f0-9-]{36}$/.test(id)&&this.data.conversations.some(c=>c.id===id&&c.source==='onggi_bot')))throw new Error('삭제 대화의 소유 정보가 올바르지 않습니다.');
    fs.writeFileSync(this.deleteFile+'.tmp',JSON.stringify(pending),{mode:0o600});fs.renameSync(this.deleteFile+'.tmp',this.deleteFile);this.pendingDeletion=pending;
    this.recoverPendingDeletion();
  }

  recoverPendingDeletion() {
    if(!fs.existsSync(this.deleteFile))return;
    try {
      if(fs.existsSync(this.journalFile))throw new Error('진행 중인 저장 복구를 먼저 완료해주세요.');
      if(fs.statSync(this.deleteFile).size>65536)throw new Error('삭제 저널 크기가 올바르지 않습니다.');
      const pending=JSON.parse(fs.readFileSync(this.deleteFile,'utf8'));
      if(pending.version!==1||!['pending','cli-deleted'].includes(pending.phase)||!/^[a-f0-9-]{36}$/.test(pending.id)||!Array.isArray(pending.ids)||!pending.ids.includes(pending.id)||!pending.ids.every(id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id)))throw new Error('삭제 저널 형식이 올바르지 않습니다.');
      this.pendingDeletion=pending;
      if(pending.phase==='pending'){
        const selected=this.data.conversations.find(c=>c.id===pending.id&&c.source==='onggi_bot');
        if(!selected||(selected.threadId??null)!==pending.threadId||(selected.codexPath??null)!==pending.codexPath||(selected.workspace??null)!==pending.workspace)throw new Error('삭제 대화의 연결 정보가 올바르지 않습니다.');
        this.warning='삭제 확인이 끝나지 않은 대화가 있습니다. 이전 대화에서 삭제를 재시도해주세요.';return;
      }
      for(const id of pending.ids){
        const file=path.join(this.historyDirectory,id+'.json');
        if(fs.existsSync(file)){
          if(fs.statSync(file).size>32*1024*1024)throw new Error('삭제 기록 크기를 확인해주세요.');
          const history=JSON.parse(fs.readFileSync(file,'utf8'));
          if(history.id!==id||history.source!=='onggi_bot')throw new Error('삭제 기록의 소유 정보가 올바르지 않습니다.');
        }
      }
      const conversations=this.data.conversations.filter(c=>!pending.ids.includes(c.id));
      const activeDeleted=pending.ids.includes(this.data.activeConversationId),activeId=activeDeleted?null:this.data.activeConversationId;
      const stateText=JSON.stringify({version:2,settings:this.data.settings,activeConversationId:activeId,conversations},null,2);
      fs.writeFileSync(this.file+'.tmp',stateText,{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);
      this.data.conversations=conversations;this.data.activeConversationId=activeId;
      if(activeDeleted){this.data.threadId=null;this.data.messages=[];this.snapshot=null;}
      for(const id of pending.ids){const file=path.join(this.historyDirectory,id+'.json');fs.rmSync(file,{force:true});fs.rmSync(file+'.tmp',{force:true});}
      fs.unlinkSync(this.deleteFile);this.pendingDeletion=null;this.writeBlocked=false;this.warning=null;
    }catch(error){this.writeBlocked=true;this.warning=`삭제 정리를 완료하지 못했습니다. 기록과 삭제 정보를 보존합니다: ${error.message}`;throw error;}
  }

  recoverPendingSave() {
    if (!fs.existsSync(this.journalFile)) return;
    if (fs.statSync(this.journalFile).size > 1024) throw new Error('저장 저널 크기가 올바르지 않습니다.');
    const journal=JSON.parse(fs.readFileSync(this.journalFile,'utf8'));
    if (journal.version!==1 || !/^[a-f0-9-]{36}$/.test(journal.historyId) || !/^[a-f0-9]{64}$/.test(journal.stateHash) || !/^[a-f0-9]{64}$/.test(journal.historyHash)) throw new Error('저장 저널 형식이 올바르지 않습니다.');
    const historyFile=path.join(this.historyDirectory,journal.historyId+'.json');
    const statePending=fs.existsSync(this.file+'.tmp'), historyPending=fs.existsSync(historyFile+'.tmp');
    const statePath=statePending?this.file+'.tmp':this.file,historyPath=historyPending?historyFile+'.tmp':historyFile;
    if (fs.statSync(statePath).size>8*1024*1024 || fs.statSync(historyPath).size>32*1024*1024) throw new Error('복구 파일 크기가 한도를 초과합니다.');
    const stateText=fs.readFileSync(statePath,'utf8'),historyText=fs.readFileSync(historyPath,'utf8');
    if (createHash('sha256').update(stateText).digest('hex')!==journal.stateHash || createHash('sha256').update(historyText).digest('hex')!==journal.historyHash) throw new Error('복구 파일이 저장 저널과 일치하지 않습니다.');
    const state=JSON.parse(stateText),history=JSON.parse(historyText);
    if (state.version!==2 || state.activeConversationId!==journal.historyId || !state.conversations?.some(c=>c.id===journal.historyId&&c.source==='onggi_bot') || history.id!==journal.historyId || history.source!=='onggi_bot' || !Array.isArray(history.messages)) throw new Error('복구 대화의 소유 정보가 올바르지 않습니다.');
    if (historyPending) fs.renameSync(historyFile+'.tmp',historyFile);
    if (statePending) fs.renameSync(this.file+'.tmp',this.file);
    fs.unlinkSync(this.journalFile);
    this.warning='중단된 대화 저장을 복구했습니다. 진행 중이던 질문은 자동 재실행하지 않습니다.';
  }

  save({includeHistory=true}={}) {
    if (this.writeBlocked) throw new Error('저장 복구가 필요합니다. 앱을 다시 실행하고 기록 폴더를 확인해주세요.');
    const previousId=this.data.activeConversationId,previousIndex=this.data.conversations.map(c=>({...c})),previousSnapshot=this.snapshot;
    try {
      if (!this.data.activeConversationId && (this.data.messages.length || this.data.threadId)) {
        const id=randomUUID(),first=this.data.messages.find(m=>m.role==='user');
        this.data.activeConversationId=id;
        this.data.conversations.push({id,source:'onggi_bot',threadId:this.data.threadId,title:(first?.text.trim().replace(/\s+/g,' ')||'새 대화').slice(0,60),preview:'',createdAt:first?.createdAt??Date.now(),updatedAt:Date.now(),mode:first?.mode??(this.data.settings.demo?'demo':'codex'),workspace:this.data.settings.workspace,codexPath:this.data.settings.codexPath});
        this.snapshot=null;includeHistory=true;
      }
      const active=this.data.conversations.find(c=>c.id===this.data.activeConversationId);
      let serialized=null,historyFile=null;
      if (active && includeHistory) {
        serialized=JSON.stringify({id:active.id,source:'onggi_bot',threadId:this.data.threadId,messages:this.data.messages});
        if (Buffer.byteLength(serialized)>32*1024*1024) throw new Error('대화 기록이 32MiB를 초과했습니다. 새 대화를 시작해주세요.');
        if (serialized!==this.snapshot) {
          historyFile=path.join(this.historyDirectory,active.id+'.json');
          active.threadId=this.data.threadId;
          active.preview=(this.data.messages.findLast(m=>m.text)?.text??'').replace(/\s+/g,' ').slice(0,120);
          active.title=(this.data.messages.find(m=>m.role==='user')?.text.trim().replace(/\s+/g,' ')||active.title).slice(0,60);
          active.updatedAt=Date.now();active.messageCount=this.data.messages.length;
        }
      }
      const stateText=JSON.stringify({version:2,settings:this.data.settings,activeConversationId:this.data.activeConversationId,conversations:this.data.conversations},null,2);
      if (Buffer.byteLength(stateText)>8*1024*1024) throw new Error('대화 목록이 8MiB를 초과했습니다. 기록 폴더를 확인해주세요.');
      if (historyFile) fs.writeFileSync(historyFile+'.tmp',serialized,{mode:0o600});
      fs.writeFileSync(this.file+'.tmp',stateText,{mode:0o600});
      if (historyFile) {
        const journal=JSON.stringify({version:1,historyId:active.id,stateHash:createHash('sha256').update(stateText).digest('hex'),historyHash:createHash('sha256').update(serialized).digest('hex')});
        fs.writeFileSync(this.journalFile+'.tmp',journal,{mode:0o600});fs.renameSync(this.journalFile+'.tmp',this.journalFile);
        fs.renameSync(historyFile+'.tmp',historyFile);
      }
      fs.renameSync(this.file+'.tmp',this.file);
      if (historyFile) fs.unlinkSync(this.journalFile);
      if (serialized!==null) this.snapshot=serialized;
    } catch(error) {
      this.data.activeConversationId=previousId;this.data.conversations=previousIndex;this.snapshot=previousSnapshot;
      this.writeBlocked=fs.existsSync(this.journalFile);
      this.warning=`대화를 저장하지 못했습니다. 현재 화면과 원본을 보존합니다: ${error.message}`;
      throw error;
    }
  }

  newConversation() {
    this.save();
    const previous={id:this.data.activeConversationId,threadId:this.data.threadId,messages:this.data.messages,snapshot:this.snapshot};
    this.data.activeConversationId = null; this.data.threadId = null; this.data.messages = []; this.snapshot = null;
    try {this.save();}catch(error){this.data.activeConversationId=previous.id;this.data.threadId=previous.threadId;this.data.messages=previous.messages;this.snapshot=previous.snapshot;throw error;}
  }

  openConversation(id) {
    const selected = this.data.conversations.find(c => c.id === id && c.source === 'onggi_bot');
    if (!selected) throw new Error('옹기봇에서 만든 대화만 열 수 있습니다.');
    const file = path.join(this.historyDirectory, selected.id + '.json');
    if (fs.statSync(file).size > 32 * 1024 * 1024) throw new Error('대화 기록이 너무 큽니다.');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.id !== selected.id || saved.source !== 'onggi_bot' || !Array.isArray(saved.messages)) throw new Error('대화 기록 형식이 올바르지 않습니다.');
    this.save();
    const previous={id:this.data.activeConversationId,threadId:this.data.threadId,messages:this.data.messages,settings:{...this.data.settings},snapshot:this.snapshot};
    this.data.activeConversationId = selected.id;
    this.data.threadId = typeof saved.threadId === 'string' ? saved.threadId : null;
    this.data.messages = saved.messages.filter(m => m && typeof m.id === 'string' && ['user','assistant','system'].includes(m.role) && typeof m.text === 'string').map(m => ({ ...m, text: m.text.slice(0,100000), status: ['queued','running'].includes(m.status) ? 'interrupted' : m.status }));
    if (selected.workspace) this.data.settings.workspace = selected.workspace;
    if (selected.codexPath) this.data.settings.codexPath = selected.codexPath;
    this.data.settings.demo = selected.mode === 'demo'; this.snapshot = JSON.stringify(saved);
    try {this.save();}catch(error){this.data.activeConversationId=previous.id;this.data.threadId=previous.threadId;this.data.messages=previous.messages;this.data.settings=previous.settings;this.snapshot=previous.snapshot;throw error;}
    return selected;
  }
}

module.exports = { Store };
