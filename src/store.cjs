const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Worker } = require('node:worker_threads');

class Store {
  constructor(directory, defaults) {
    if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink())throw Error('저장 루트 폴더의 링크는 사용할 수 없습니다.');
    fs.mkdirSync(directory,{recursive:true});
    directory=fs.realpathSync(directory);
    this.directory = directory;
    this.file = path.join(directory, 'state.json');
    this.historyDirectory = path.join(directory, 'conversations');
    this.warning = null;
    this.snapshot = null;
    this.registryRevision = 0;
    this.worker = null;
    this.saving = null;
    this.writeBlocked = false;
    this.journalFile = path.join(directory,'save-journal.json');
    this.deleteFile=path.join(directory,'delete-journal.json');
    this.pendingDeletion=null;
    if(fs.existsSync(this.historyDirectory)&&fs.lstatSync(this.historyDirectory).isSymbolicLink())throw Error('대화 폴더의 링크는 사용할 수 없습니다.');
    fs.mkdirSync(this.historyDirectory, { recursive: true });
    this.data = { version: 2, settings: { ...defaults }, threadId: null, messages: [], activeConversationId: null, conversations: [] };
    try{for(const file of [this.file,this.file+'.tmp',this.journalFile,this.journalFile+'.tmp',this.deleteFile,this.deleteFile+'.tmp']){let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(stat.isSymbolicLink()||!stat.isFile())throw Error('저장 파일의 link/directory 경로를 확인해주세요.');}}catch(error){this.writeBlocked=true;this.warning=error.message;return;}
    try { this.recoverPendingSave(); }
    catch(error) { this.writeBlocked=true;this.warning=`저장 복구가 필요합니다. 원본을 보존했습니다: ${error.message}`; }
    try {
      if (fs.existsSync(this.file)) {
        if (fs.statSync(this.file).size > 8 * 1024 * 1024) throw new Error('저장 파일 크기를 확인해주세요.');
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (![1,2].includes(saved.version)) throw new Error('저장 형식이 올바르지 않습니다.');
        if (!saved.settings || typeof saved.settings !== 'object' || Array.isArray(saved.settings)) throw new Error('저장 설정 형식이 올바르지 않습니다.');
        const settings = { ...defaults };
        let repaired = false;
        for (const key of ['buddyName','characterId','codexPath','workspace','skinId','chatMode','serviceTier','model','effort']) {
          if (!(key in saved.settings)) continue;
          const value = saved.settings[key];
          if ((['model','effort'].includes(key) && value === null) || (typeof value === 'string' && value.length > 0 && value.length <= (['workspace','codexPath'].includes(key) ? 8192 : 200) && !value.includes('\u0000'))) settings[key] = value;
          else repaired = true;
        }
        for (const key of ['demo','reducedMotion','alwaysOnTop','measureResponseTime','batterySaver','notifyCompleted','notifyApproval','notifyFailed','notifyPreview','notifySound','quietHoursEnabled']) {
          if (!(key in saved.settings)) continue;
          if (typeof saved.settings[key] === 'boolean') settings[key] = saved.settings[key];
          else repaired = true;
        }
        if(saved.settings.appearanceProfile!==undefined){if(['custom','quiet','daily','lively'].includes(saved.settings.appearanceProfile))settings.appearanceProfile=saved.settings.appearanceProfile;else repaired=true;}
        if(saved.settings.characterScale!==undefined){if([.35,.5,.65].includes(saved.settings.characterScale))settings.characterScale=saved.settings.characterScale;else repaired=true;}
        if(saved.settings.approvalDisplay!==undefined){if(['panel','notification'].includes(saved.settings.approvalDisplay))settings.approvalDisplay=saved.settings.approvalDisplay;else repaired=true;}
        for(const [key,values]of [['fontScale',[100,110,120]],['miniSize',['small','comfortable']],['sendKey',['enter','modifier-enter']],['hotkey',['CommandOrControl+Shift+Space','CommandOrControl+Shift+B','CommandOrControl+Shift+O']]])if(saved.settings[key]!==undefined){if(values.includes(saved.settings[key]))settings[key]=saved.settings[key];else repaired=true;}
        for(const key of ['quietStart','quietEnd'])if(saved.settings[key]!==undefined){if(Number.isInteger(saved.settings[key])&&saved.settings[key]>=0&&saved.settings[key]<1440)settings[key]=saved.settings[key];else repaired=true;}
        const position = saved.settings.position;
        if (position == null) settings.position = null;
        else if (typeof position === 'object' && ['x','y'].every(key => Number.isFinite(position[key]) && Math.abs(position[key]) < 100000) && ['width','height'].every(key => position[key] === undefined || (Number.isFinite(position[key]) && position[key] > 0 && position[key] < 10000))) settings.position = { x:position.x, y:position.y, ...(position.width === undefined ? {} : {width:position.width}), ...(position.height === undefined ? {} : {height:position.height}) };
        else { settings.position = null; repaired = true; }
        settings.personaModes = {};
        if (saved.settings.personaModes && typeof saved.settings.personaModes === 'object' && !Array.isArray(saved.settings.personaModes)) {
          for (const [id, mode] of Object.entries(saved.settings.personaModes)) if (/^[a-z][a-z0-9-]{0,47}$/.test(id) && typeof mode === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(mode)) settings.personaModes[id] = mode; else repaired = true;
        }
        this.data.settings = settings;
        if (repaired) { fs.copyFileSync(this.file,this.file+'.backup-settings-'+Date.now()+'-'+randomUUID(),fs.constants.COPYFILE_EXCL); this.warning = '잘못된 저장 설정 일부를 기본값으로 복구했습니다. 원본 파일을 백업했습니다.'; }
        if (saved.version === 1) {
          if (!Array.isArray(saved.messages)) throw new Error('저장 형식이 올바르지 않습니다.');
          this.data.threadId = typeof saved.threadId === 'string' ? saved.threadId : null;
          this.data.messages = saved.messages;
          fs.copyFileSync(this.file, this.file + `.backup-v1-${Date.now()}-${randomUUID()}`,fs.constants.COPYFILE_EXCL);
          this.save();
        } else {
          if (!Array.isArray(saved.conversations)) throw new Error('대화 목록 형식이 올바르지 않습니다.');
          const ids = new Set();
          this.data.conversations = saved.conversations.filter(c => {
            if (!c || typeof c.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(c.id) || ids.has(c.id) || c.source !== 'onggi_bot' || typeof c.title !== 'string') return false;
            ids.add(c.id); return true;
          }).map(c => {
            const createdAt = Number.isFinite(c.createdAt) && c.createdAt >= 0 && c.createdAt <= 8640000000000000 ? c.createdAt : Date.now();
            return { ...c, title:c.title.slice(0,60), titleSource:c.titleSource==='manual'?'manual':'auto',pinned:c.pinned===true,preview:typeof c.preview === 'string' ? c.preview.slice(0,120) : '', createdAt, updatedAt:Number.isFinite(c.updatedAt) && c.updatedAt >= 0 && c.updatedAt <= 8640000000000000 ? c.updatedAt : createdAt,
              workspace:typeof c.workspace === 'string' && !c.workspace.includes('\u0000') ? c.workspace : undefined, codexPath:typeof c.codexPath === 'string' && !c.codexPath.includes('\u0000') ? c.codexPath : undefined,
              threadId:typeof c.threadId === 'string' ? c.threadId : null, mode:c.mode === 'demo' ? 'demo' : 'codex', messageCount:Number.isSafeInteger(c.messageCount) && c.messageCount >= 0 ? c.messageCount : 0 };
          });
          const active = this.data.conversations.find(c => c.id === saved.activeConversationId);
          if (active) {
            const history = this.readHistory(active.id);
            this.data.activeConversationId = active.id;
            this.data.threadId = typeof history.threadId === 'string' ? history.threadId : null;
            this.data.messages = history.messages;
            this.snapshot = JSON.stringify(history);
          }
        }
      }
    } catch (error) {
      this.warning = `대화 기록을 읽지 못했습니다. 원본을 보존했습니다: ${error.message}`;
      if (fs.existsSync(this.file)) { try { fs.copyFileSync(this.file, this.file + `.backup-${Date.now()}-${randomUUID()}`,fs.constants.COPYFILE_EXCL); } catch (backupError) { this.writeBlocked = true; this.warning += ' 백업도 실패하여 쓰기를 차단했습니다: ' + backupError.message; } }
      this.data.activeConversationId = null; this.data.threadId = null; this.data.messages = [];
    }
    try {this.recoverPendingDeletion();}catch{}
  }
  readHistory(id) {
    if(fs.realpathSync(this.historyDirectory)!==this.historyDirectory)throw Error('대화 폴더 경로가 바뀌었습니다.');
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) throw new Error('대화 ID 형식이 올바르지 않습니다.');
    const file = path.join(this.historyDirectory, id + '.json');
    if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile() || fs.statSync(file).size > 32 * 1024 * 1024) throw new Error('대화 기록 경로·크기를 확인해주세요.');
    const descriptor=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));let saved;
    try{const stat=fs.fstatSync(descriptor);if(!stat.isFile()||stat.size>32*1024*1024||fs.realpathSync(this.historyDirectory)!==this.historyDirectory)throw Error('대화 기록 경로·크기를 확인해주세요.');const bytes=fs.readFileSync(descriptor);if(bytes.length>32*1024*1024)throw Error('대화 기록 크기를 확인해주세요.');saved=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{fs.closeSync(descriptor);}
    if (saved.id !== id || saved.source !== 'onggi_bot' || !Array.isArray(saved.messages)) throw new Error('대화 기록 형식이 올바르지 않습니다.');
    const ids = new Set();
    saved.messages = saved.messages.filter(m => {
      if (!m || typeof m.id !== 'string' || !m.id || m.id.length > 256 || ids.has(m.id) || !['user','assistant','system'].includes(m.role) || typeof m.text !== 'string') return false;
      ids.add(m.id); return true;
    }).map(m => {
      const message = { ...m, status:['completed','failed','interrupted'].includes(m.status) ? m.status : 'interrupted', createdAt:Number.isFinite(m.createdAt) && m.createdAt >= 0 && m.createdAt <= 8640000000000000 ? m.createdAt : Date.now() };
      if(m.role==='assistant'&&Array.isArray(m.images))message.images=m.images.slice(0,8).filter(i=>i&&typeof i.itemId==='string'&&i.itemId.length<=256).map(i=>{
        if(i.status==='ready'&&/^[a-f0-9]{64}$/.test(i.id)&&/^[a-f0-9]{64}$/.test(i.previewId)&&['image/png','image/jpeg','image/webp'].includes(i.mime)&&[i.width,i.height,i.bytes].every(Number.isSafeInteger)&&i.width>0&&i.height>0&&i.width<=4096&&i.height<=4096&&i.bytes>0&&i.bytes<=16*1024*1024)return{itemId:i.itemId,status:'ready',id:i.id,previewId:i.previewId,mime:i.mime,width:i.width,height:i.height,bytes:i.bytes};
        return{itemId:i.itemId,status:'failed',error:i.status==='failed'&&typeof i.error==='string'?i.error.slice(0,500):'이전 이미지 생성이 중단됐어요. 대화를 다시 열어 결과를 확인해주세요.'};
      });else delete message.images;
      if(m.role==='user'&&Array.isArray(m.attachments))message.attachments=m.attachments.slice(0,8).filter(a=>a&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(a.id)&&/^[a-f0-9]{64}$/.test(a.hash)&&typeof a.name==='string'&&a.name.length>0&&a.name.length<=256&&!/[\u0000-\u001f\u007f-\u009f]/u.test(a.name)&&Number.isSafeInteger(a.bytes)&&a.bytes>0&&a.bytes<=16*1024*1024&&/^\.[a-z0-9]{1,16}$/.test(a.extension)&&['file','image'].includes(a.kind)&&(!(a.kind==='image')||['image/png','image/jpeg','image/webp'].includes(a.mime)&&/^[a-f0-9]{64}$/.test(a.previewId)&&[a.width,a.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=4096))).map(a=>({id:a.id,kind:a.kind,name:a.name,bytes:a.bytes,hash:a.hash,extension:a.extension,...(a.kind==='image'?{mime:a.mime,width:a.width,height:a.height,previewId:a.previewId}:{})}));else delete message.attachments;
      if (m.timing && typeof m.timing === 'object' && !Array.isArray(m.timing)) {
        message.timing = {};
        for (const key of ['receivedAt','submittedAt','enqueuedAt','queueStartedAt','cliSentAt','firstReplyAt','completedAt','renderedAt','inputMs','dispatchMs','cliMs','firstReplyMs','queueMs','renderMs','totalMs']) if (m.timing[key] === null || (Number.isFinite(m.timing[key]) && m.timing[key] >= 0)) message.timing[key] = m.timing[key];
        message.timing.mode = m.mode; message.timing.status = message.status;
      } else delete message.timing;
      if(!['conversation','summary','analyze','plan','review'].includes(m.purpose))delete message.purpose;
      if(m.skill&&typeof m.skill.name==='string'&&m.skill.name.length<=200&&typeof m.skill.path==='string'&&path.isAbsolute(m.skill.path)&&m.skill.path.length<=8192&&!m.skill.path.includes('\u0000')&&/^[a-f0-9]{64}$/.test(m.skill.hash))message.skill={name:m.skill.name,path:m.skill.path,hash:m.skill.hash};else delete message.skill;
      if(m.progress&&typeof m.progress==='object')message.progress={plan:Array.isArray(m.progress.plan)?m.progress.plan.slice(0,24).filter(item=>item&&typeof item.step==='string'&&['pending','inProgress','completed'].includes(item.status)).map(item=>({step:item.step.slice(0,300),status:item.status})):[],tools:Array.isArray(m.progress.tools)?m.progress.tools.slice(-24).filter(item=>item&&typeof item.id==='string'&&typeof item.label==='string'&&['commandExecution','fileChange','mcpToolCall','webSearch'].includes(item.type)&&['running','failed','completed','stopped','declined'].includes(item.status)).map(item=>({id:item.id.slice(0,256),label:item.label.slice(0,180),type:item.type,status:item.status})):[]};else delete message.progress;
      if(m.tokenUsage&&typeof m.tokenUsage==='object'){
        message.tokenUsage={};for(const slot of ['total','last']){const value=m.tokenUsage[slot];if(value&&['totalTokens','inputTokens','outputTokens'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0))message.tokenUsage[slot]={totalTokens:value.totalTokens,inputTokens:value.inputTokens,outputTokens:value.outputTokens};}
        if(Number.isSafeInteger(m.tokenUsage.modelContextWindow)&&m.tokenUsage.modelContextWindow>0)message.tokenUsage.modelContextWindow=m.tokenUsage.modelContextWindow;
      }else delete message.tokenUsage;
      if(!['running','completed'].includes(m.reviewState))delete message.reviewState;
      if(typeof m.reviewSettings==='string')message.reviewSettings=m.reviewSettings.slice(0,300);else delete message.reviewSettings;
      if(typeof m.reviewThreadModel==='string')message.reviewThreadModel=m.reviewThreadModel.slice(0,200);else delete message.reviewThreadModel;
      return message;
    });
    return saved;
  }

  beginDeletion(id, {relatedIds=[]}={}) {
    if(this.writeBlocked)throw new Error('저장 복구 후 대화를 삭제해주세요.');
    const selected=this.data.conversations.find(c=>c.id===id&&c.source==='onggi_bot');
    if(!selected)throw new Error('옹기봇에서 만든 대화만 삭제할 수 있습니다.');
    if(this.pendingDeletion && this.pendingDeletion.id!==id)throw new Error('삭제 확인이 끝나지 않은 이전 대화를 먼저 처리해주세요.');
    if (!relatedIds.every(related => this.data.conversations.some(c => c.id === related && c.source === 'onggi_bot' && (c.codexPath??null)===(selected.codexPath??null) && (c.workspace??null)===(selected.workspace??null)))) throw new Error('파생 대화의 소유 정보를 확인해주세요.');
    if (!this.pendingDeletion) this.save();
    const pending={version:1,id,ids:[...new Set([id,...(this.pendingDeletion?.ids??[]),...relatedIds])],phase:'pending',threadId:selected.threadId??null,codexPath:selected.codexPath??null,workspace:selected.workspace??null};
    if(fs.realpathSync(this.directory)!==this.directory||fs.realpathSync(this.historyDirectory)!==this.historyDirectory)throw Error('삭제 폴더 경로를 확인해주세요.');
    for(const file of [this.deleteFile,this.deleteFile+'.tmp']){let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(stat.isSymbolicLink()||!stat.isFile())throw Error('삭제 저널 경로를 확인해주세요.');}
    if(fs.existsSync(this.deleteFile+'.tmp'))fs.renameSync(this.deleteFile+'.tmp',this.deleteFile+'.tmp.orphan-'+randomUUID());
    fs.writeFileSync(this.deleteFile+'.tmp',JSON.stringify(pending),{mode:0o600,flag:'wx'});fs.renameSync(this.deleteFile+'.tmp',this.deleteFile);this.pendingDeletion=pending;
  }

  completeDeletion(ids) {
    if(this.writeBlocked||fs.existsSync(this.journalFile))throw new Error('저장 복구를 마친 뒤 삭제 정리를 다시 시도해주세요.');
    if(!this.pendingDeletion)throw new Error('확인된 삭제 요청이 없습니다.');
    if(!Array.isArray(ids)||ids.some(id=>!this.pendingDeletion.ids.includes(id)))throw Error('확인한 삭제 범위 밖의 대화는 정리할 수 없습니다.');
    const pending={...this.pendingDeletion,phase:'cli-deleted',ids:[...new Set([this.pendingDeletion.id,...ids])]};
    if(!pending.ids.every(id=>/^[a-f0-9-]{36}$/.test(id)&&this.data.conversations.some(c=>c.id===id&&c.source==='onggi_bot'&&(c.codexPath??null)===(pending.codexPath??null)&&(c.workspace??null)===(pending.workspace??null))))throw new Error('삭제 대화의 소유 정보가 올바르지 않습니다.');
    if(fs.realpathSync(this.directory)!==this.directory||fs.realpathSync(this.historyDirectory)!==this.historyDirectory)throw Error('삭제 폴더 경로를 확인해주세요.');
    for(const file of [this.deleteFile,this.deleteFile+'.tmp']){let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(stat.isSymbolicLink()||!stat.isFile())throw Error('삭제 저널 경로를 확인해주세요.');}
    if(fs.existsSync(this.deleteFile+'.tmp'))fs.renameSync(this.deleteFile+'.tmp',this.deleteFile+'.tmp.orphan-'+randomUUID());
    fs.writeFileSync(this.deleteFile+'.tmp',JSON.stringify(pending),{mode:0o600,flag:'wx'});fs.renameSync(this.deleteFile+'.tmp',this.deleteFile);this.pendingDeletion=pending;
    this.recoverPendingDeletion();
  }

  recoverPendingDeletion() {
    if(!fs.existsSync(this.deleteFile))return;
    try {
      if(fs.existsSync(this.journalFile))throw new Error('진행 중인 저장 복구를 먼저 완료해주세요.');
      if(fs.realpathSync(this.directory)!==this.directory||fs.realpathSync(this.historyDirectory)!==this.historyDirectory)throw Error('삭제 폴더 경로를 확인해주세요.');
      for(const file of [this.deleteFile,this.file,this.file+'.tmp']){let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(stat.isSymbolicLink()||!stat.isFile())throw Error('삭제 파일 경로를 확인해주세요.');}
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
        const registered=this.data.conversations.find(c=>c.id===id);if(registered&&((registered.codexPath??null)!==(pending.codexPath??null)||(registered.workspace??null)!==(pending.workspace??null)))throw Error('삭제 대화의 연결 문맥이 다릅니다.');
        const file=path.join(this.historyDirectory,id+'.json');
        let staged;try{staged=fs.lstatSync(file+'.tmp');}catch(error){if(error.code!=='ENOENT')throw error;}if(staged&&(staged.isSymbolicLink()||!staged.isFile()))throw Error('삭제 임시 파일 경로를 확인해주세요.');
        if(fs.existsSync(file)){
          if(fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile())throw Error('삭제 기록 경로를 확인해주세요.');
          if(fs.statSync(file).size>32*1024*1024)throw new Error('삭제 기록 크기를 확인해주세요.');
          const history=JSON.parse(fs.readFileSync(file,'utf8'));
          if(history.id!==id||history.source!=='onggi_bot')throw new Error('삭제 기록의 소유 정보가 올바르지 않습니다.');
        }
      }
      const conversations=this.data.conversations.filter(c=>!pending.ids.includes(c.id));
      const activeDeleted=pending.ids.includes(this.data.activeConversationId),activeId=activeDeleted?null:this.data.activeConversationId;
      const stateText=JSON.stringify({version:2,settings:this.data.settings,activeConversationId:activeId,conversations},null,2);
      if(fs.existsSync(this.file+'.tmp'))fs.renameSync(this.file+'.tmp',this.file+'.tmp.orphan-'+randomUUID());
      fs.writeFileSync(this.file+'.tmp',stateText,{mode:0o600,flag:'wx'});fs.renameSync(this.file+'.tmp',this.file);
      this.data.conversations=conversations;this.data.activeConversationId=activeId;this.registryRevision++;
      if(activeDeleted){this.data.threadId=null;this.data.messages=[];this.snapshot=null;}
      for(const id of pending.ids){const file=path.join(this.historyDirectory,id+'.json');fs.rmSync(file,{force:true});fs.rmSync(file+'.tmp',{force:true});}
      fs.unlinkSync(this.deleteFile);this.pendingDeletion=null;this.writeBlocked=false;this.warning=null;
    }catch(error){this.writeBlocked=true;this.warning=`삭제 정리를 완료하지 못했습니다. 기록과 삭제 정보를 보존합니다: ${error.message}`;throw error;}
  }

  recoverPendingSave() {
    if (!fs.existsSync(this.journalFile)) return;
    if(fs.realpathSync(this.directory)!==this.directory||fs.realpathSync(this.historyDirectory)!==this.historyDirectory)throw Error('저장 복구 폴더의 경로가 바뀌었습니다.');
    for(const file of [this.journalFile,this.file,this.file+'.tmp']){let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(stat.isSymbolicLink()||!stat.isFile())throw Error('복구 파일의 link/directory 경로를 확인해주세요.');}
    if (fs.statSync(this.journalFile).size > 1024) throw new Error('저장 저널 크기가 올바르지 않습니다.');
    const journal=JSON.parse(fs.readFileSync(this.journalFile,'utf8'));
    if (journal.version!==1 || !/^[a-f0-9-]{36}$/.test(journal.historyId) || !/^[a-f0-9]{64}$/.test(journal.stateHash) || !/^[a-f0-9]{64}$/.test(journal.historyHash)) throw new Error('저장 저널 형식이 올바르지 않습니다.');
    const historyFile=path.join(this.historyDirectory,journal.historyId+'.json');
    for(const file of [historyFile,historyFile+'.tmp']){let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(stat.isSymbolicLink()||!stat.isFile())throw Error('대화 복구 파일 경로를 확인해주세요.');}
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
    if (this.saving) throw new Error('대화 저장이 진행 중입니다. 잠시 뒤 다시 시도해주세요.');
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
          if(active.titleSource!=='manual')active.title=(this.data.messages.find(m=>m.role==='user')?.text.trim().replace(/\s+/g,' ')||active.title).slice(0,60);
          active.updatedAt=Date.now();active.messageCount=this.data.messages.length;
        }
      }
      const stateText=JSON.stringify({version:2,settings:this.data.settings,activeConversationId:this.data.activeConversationId,conversations:this.data.conversations},null,2);
      if (Buffer.byteLength(stateText)>8*1024*1024) throw new Error('대화 목록이 8MiB를 초과했습니다. 기록 폴더를 확인해주세요.');
      if(fs.realpathSync(this.directory)!==this.directory||fs.realpathSync(this.historyDirectory)!==this.historyDirectory)throw Error('저장 폴더의 경로가 바뀌었습니다.');
      const targets=[this.file,this.file+'.tmp',this.journalFile,this.journalFile+'.tmp',this.deleteFile,this.deleteFile+'.tmp',...(active?[path.join(this.historyDirectory,active.id+'.json'),path.join(this.historyDirectory,active.id+'.json.tmp')]:[])];
      for(const file of targets){let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(stat.isSymbolicLink()||!stat.isFile())throw Error('저장 파일의 link/directory 경로를 확인해주세요.');}
      if(fs.existsSync(this.journalFile))throw Error('저장 저널 복구가 먼저 필요합니다.');
      for(const file of targets.filter(file=>file.endsWith('.tmp')))if(fs.existsSync(file))fs.renameSync(file,file+'.orphan-'+randomUUID());
      if (historyFile) fs.writeFileSync(historyFile+'.tmp',serialized,{mode:0o600,flag:'wx'});
      fs.writeFileSync(this.file+'.tmp',stateText,{mode:0o600,flag:'wx'});
      if (historyFile) {
        const journal=JSON.stringify({version:1,historyId:active.id,stateHash:createHash('sha256').update(stateText).digest('hex'),historyHash:createHash('sha256').update(serialized).digest('hex')});
        fs.writeFileSync(this.journalFile+'.tmp',journal,{mode:0o600,flag:'wx'});fs.renameSync(this.journalFile+'.tmp',this.journalFile);
        fs.renameSync(historyFile+'.tmp',historyFile);
      }
      fs.renameSync(this.file+'.tmp',this.file);
      if (historyFile) fs.unlinkSync(this.journalFile);
      if (serialized!==null) this.snapshot=serialized;
      if (historyFile) this.registryRevision++;
    } catch(error) {
      this.data.activeConversationId=previousId;this.data.conversations=previousIndex;this.snapshot=previousSnapshot;
      this.writeBlocked=fs.existsSync(this.journalFile);
      this.warning=`대화를 저장하지 못했습니다. 현재 화면과 원본을 보존합니다: ${error.message}`;
      throw error;
    }
  }

  saveAsync() {
    if (this.saving) return this.saving.then(() => this.saveAsync());
    if (this.writeBlocked) return Promise.reject(new Error('저장 복구가 필요합니다. 앱을 다시 실행하고 기록 폴더를 확인해주세요.'));
    if (!this.worker) {
      const file = path.join(__dirname,'store-worker.cjs').replace('app.asar' + path.sep,'app.asar.unpacked' + path.sep);
      this.worker = new Worker(file,{workerData:{directory:this.directory}});
      this.workerRevision = -1; this.workerConversationId = undefined;
      const created = this.worker;
      created.on('error', error => { if (this.worker === created) {this.worker=null;this.writeBlocked=Boolean(this.saving);this.warning='저장 프로세스 오류: '+error.message;} });
      created.on('exit', code => { if (this.worker === created) {this.worker=null;this.writeBlocked=Boolean(this.saving);if(code)this.warning='저장 프로세스가 종료됐습니다 ('+code+').';} });
      this.worker.unref();
    }
    const worker = this.worker, previousId = this.data.activeConversationId;
    const operation = new Promise((resolve,reject) => {
      const completed = (error,result) => {
        clearTimeout(timer); worker.off('message',onMessage); worker.off('error',onError); worker.off('exit',onExit); worker.unref();
        if (error) reject(error); else resolve(result);
      };
      const onMessage = result => completed(null,result);
      const onError = error => { this.writeBlocked = true; this.worker = null; completed(error); };
      const onExit = code => { this.writeBlocked = true; this.worker = null; completed(new Error('대화 저장 프로세스가 종료됐습니다 (' + code + '). 재실행하여 복구해주세요.')); };
      const timer = setTimeout(() => { this.writeBlocked=true;if(this.worker===worker)this.worker=null;completed(new Error('대화 저장 시간이 초과됐습니다. 재실행하여 복구해주세요.'));void worker.terminate(); },30000);
      worker.once('message',onMessage); worker.once('error',onError); worker.once('exit',onExit); worker.ref();
      const message = {data:this.data};
      if (this.workerRevision !== this.registryRevision || this.workerConversationId !== previousId) message.snapshot = this.snapshot;
      try { worker.postMessage(message); } catch (error) { completed(error); }
    }).then(result => {
      if (!result.ok) { this.writeBlocked = result.writeBlocked; throw new Error(result.error); }
      this.data.activeConversationId = result.activeConversationId;
      this.data.conversations = result.conversations;
      this.snapshot = result.snapshot; this.registryRevision++;
      this.workerRevision = this.registryRevision; this.workerConversationId = this.data.activeConversationId;
    }).catch(error => {
      this.warning = '대화를 저장하지 못했습니다. 현재 화면과 원본을 보존합니다: ' + error.message;
      throw error;
    }).finally(() => { if (this.saving === operation) this.saving = null; });
    this.saving = operation;
    return operation;
  }

  async closeWorker() {
    while (this.saving) { try { await this.saving; } catch {} }
    const worker = this.worker; this.worker = null;
    if (worker) await worker.terminate();
  }

  newConversation({settings=this.data.settings}={}) {
    this.save();
    const previous={id:this.data.activeConversationId,threadId:this.data.threadId,messages:this.data.messages,snapshot:this.snapshot,settings:this.data.settings};
    this.data.activeConversationId = null; this.data.threadId = null; this.data.messages = []; this.snapshot = null;
    this.data.settings = settings;
    try {this.save();}catch(error){this.data.activeConversationId=previous.id;this.data.threadId=previous.threadId;this.data.messages=previous.messages;this.data.settings=previous.settings;this.snapshot=previous.snapshot;throw error;}
  }

  openConversation(id) {
    const selected = this.data.conversations.find(c => c.id === id && c.source === 'onggi_bot');
    if (!selected) throw new Error('옹기봇에서 만든 대화만 열 수 있습니다.');
    const saved = this.readHistory(selected.id);
    this.save();
    const previous={id:this.data.activeConversationId,threadId:this.data.threadId,messages:this.data.messages,settings:{...this.data.settings},snapshot:this.snapshot};
    this.data.activeConversationId = selected.id;
    this.data.threadId = typeof saved.threadId === 'string' ? saved.threadId : null;
    this.data.messages = saved.messages;
    if (selected.workspace) this.data.settings.workspace = selected.workspace;
    if (selected.codexPath) this.data.settings.codexPath = selected.codexPath;
    this.data.settings.demo = selected.mode === 'demo'; this.snapshot = JSON.stringify(saved);
    try {this.save();}catch(error){this.data.activeConversationId=previous.id;this.data.threadId=previous.threadId;this.data.messages=previous.messages;this.data.settings=previous.settings;this.snapshot=previous.snapshot;throw error;}
    return selected;
  }
}

module.exports = { Store };
