const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {setImmediate}=require('node:timers');

class StorageMaintenance{
  constructor(directory){this.root=fs.realpathSync(directory);this.preview=null;}
  async inspect({conversations,messages,extraMessages=[],blocked=false,isCurrent=()=>true}){
    this.preview=null;
    if(fs.realpathSync(this.root)!==this.root)throw Error('기록 폴더가 변경됐어요.');
    const references=new Set(),referenceFiles=[],warnings=[],histories=path.join(this.root,'conversations');
    const records=[...messages,...extraMessages],registered=new Set(conversations.map(item=>item.id));
    let referenceBytes=0;
    if(fs.lstatSync(histories).isSymbolicLink()||fs.realpathSync(histories)!==histories)throw Error('기록 폴더의 링크는 사용할 수 없어요.');
    const historyDirectoryStat=fs.statSync(histories);
    for(const entry of await fs.promises.readdir(histories,{withFileTypes:true})){
      if(!isCurrent())throw Error('보관 파일 확인을 중단했어요.');
      const id=entry.name.slice(0,-5),file=path.join(histories,entry.name);
      if(!entry.isFile()||!entry.name.endsWith('.json')||!registered.has(id)){blocked=true;warnings.push('등록되지 않은 기록·복구 파일을 보존해요.');continue;}
      registered.delete(id);let handle;
      try{
        handle=await fs.promises.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));const before=await handle.stat();
        if(!before.isFile()||before.size>32*1024*1024||referenceBytes+before.size>256*1024*1024)throw Error('기록 조회 크기 한도');
        const bytes=Buffer.alloc(before.size+1);let count=0;
        while(count<bytes.length){const read=await handle.read(bytes,count,Math.min(65536,bytes.length-count),null);if(!read.bytesRead)break;count+=read.bytesRead;}
        const after=await handle.stat();
        if(count!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('조회 중 기록 변경');
        const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,count)));
        if(data.id!==id||data.source!=='onggi_bot'||!Array.isArray(data.messages))throw Error('기록 소유 정보');
        if(records.length+data.messages.length>50000)throw Error('기록 메시지 조회 한도');
        for(const message of data.messages)records.push(message);referenceBytes+=count;referenceFiles.push({file,dev:before.dev,ino:before.ino,size:before.size,mtimeMs:before.mtimeMs,ctimeMs:before.ctimeMs});
      }catch{blocked=true;warnings.push('읽지 못하거나 변경된 기록이 있어 캐시 정리를 보류해요.');}
      finally{await handle?.close();}
    }
    if(registered.size){blocked=true;warnings.push('누락된 대화 기록을 먼저 확인해주세요.');}
    for(const message of records){
      if(!message||typeof message!=='object'){blocked=true;continue;}
      for(const key of ['images','attachments']){
        if(message[key]===undefined)continue;
        if(!Array.isArray(message[key])){blocked=true;continue;}
        for(const item of message[key]){
          if(!item||typeof item!=='object'){blocked=true;continue;}
          if(key==='images'&&['pending','failed'].includes(item.status)&&item.id===undefined&&item.previewId===undefined)continue;
          const hashes=key==='images'?[item.id,item.previewId]:item.kind==='image'?[item.hash,item.previewId]:[item.hash];
          if(hashes.some(hash=>typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)))blocked=true;
          for(const hash of hashes)if(typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash))references.add(hash);
        }
      }
    }
    for(const name of ['state.json','state.json.tmp','save-journal.json','save-journal.json.tmp','delete-journal.json','delete-journal.json.tmp','pack-change.json']){
      const file=path.join(this.root,name);if(!fs.existsSync(file))continue;
      const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||name!=='state.json'){blocked=true;warnings.push('저장·삭제·팩 변경 복구 파일을 먼저 확인해주세요.');}
      referenceFiles.push({file,dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs});
    }
    if((await fs.promises.readdir(this.root)).some(name=>name.startsWith('state.json.backup'))){blocked=true;warnings.push('이전 설정·기록 복구본은 별도 확인이 필요해요.');}
    const items=[],candidates=new Map();let bytes=0,referencedBytes=0;
    for(const folder of ['response-images','attachments']){
      const directory=path.join(this.root,folder);if(!fs.existsSync(directory))continue;
      if(fs.lstatSync(directory).isSymbolicLink()||fs.realpathSync(directory)!==directory)throw Error('캐시 폴더의 링크는 사용할 수 없어요.');
      const entries=await fs.promises.readdir(directory,{withFileTypes:true});if(entries.length>10000)throw Error('캐시 파일이 많아 전체 참조 확인이 필요해요.');
      for(const entry of entries){
        if(!isCurrent())throw Error('보관 파일 확인을 중단했어요.');
        const file=path.join(directory,entry.name),stat=await fs.promises.lstat(file),relative=folder+'/'+entry.name;
        let reason='사용자 추가·알 수 없는 파일 보존',eligible=false;
        if(stat.isFile()&&!stat.isSymbolicLink()){
          bytes+=stat.size;const match=/^([a-f0-9]{64})\.([a-z0-9]{1,16})$/.exec(entry.name);
          if(match&&references.has(match[1])){reason='대화·초안·첨부에서 참조 중';referencedBytes+=stat.size;}
          else if(match&&stat.size<=16*1024*1024&&stat.size>0&&(folder==='attachments'||['png','jpeg','webp'].includes(match[2]))){
            const handle=await fs.promises.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));let digest;
            try{const opened=await handle.stat();if(opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)throw Error('조회 중 캐시 변경');const data=Buffer.alloc(stat.size+1);let count=0;while(count<data.length){const read=await handle.read(data,count,Math.min(65536,data.length-count),null);if(!read.bytesRead)break;count+=read.bytesRead;}const after=await handle.stat();if(count!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs)throw Error('캐시 크기·내용 변경');digest=createHash('sha256').update(data.subarray(0,count)).digest('hex');}finally{await handle.close();}
            if(digest===match[1]){reason=blocked?'기록 확인·현재 작업이 끝날 때까지 보존':'미참조 캐시 · 선택해 복구 보관 가능';eligible=!blocked;}
            else reason='변경된 캐시·사용자 파일 보존';
          }
        }
        const id=randomUUID();items.push({id,name:relative,bytes:stat.isFile()?stat.size:0,eligible,reason});
        if(eligible)candidates.set(id,{relative,file,hash:entry.name.slice(0,64),dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs});
      }
    }
    const preservedGroups=[];
    for(const entry of await fs.promises.readdir(this.root,{withFileTypes:true})){
      if(!entry.name.startsWith('.archive-')&&!['personas','cache-quarantine'].includes(entry.name))continue;
      const group={name:entry.name,bytes:0,files:0,links:0,limited:false},directories=[path.join(this.root,entry.name)];
      while(directories.length){
        if(!isCurrent())throw Error('보관 파일 확인을 중단했어요.');
        const directory=directories.pop(),stat=await fs.promises.lstat(directory);
        if(stat.isSymbolicLink()){group.links++;continue;}
        if(!stat.isDirectory()){if(stat.isFile()){group.files++;group.bytes+=stat.size;}continue;}
        if(fs.realpathSync(directory)!==directory){group.links++;continue;}
        const children=await fs.promises.readdir(directory,{withFileTypes:true});
        if(group.files+directories.length+children.length>10000){group.limited=true;break;}
        for(const child of children)directories.push(path.join(directory,child.name));
      }
      preservedGroups.push(group);
    }
    if(fs.realpathSync(this.root)!==this.root||fs.realpathSync(histories)!==histories)throw Error('조회 중 기록 경로가 변경됐어요.');
    const token=randomUUID();
    const batches=[],quarantine=path.join(this.root,'cache-quarantine');
    if(fs.existsSync(quarantine)){
      if(fs.lstatSync(quarantine).isSymbolicLink()||fs.realpathSync(quarantine)!==quarantine)throw Error('복구 보관 폴더를 확인해주세요.');
      for(const entry of await fs.promises.readdir(quarantine,{withFileTypes:true}))if(entry.isDirectory()&&/^[a-f0-9-]{36}$/.test(entry.name))batches.push({id:entry.name});
    }
    if(!isCurrent())throw Error('보관 파일 확인을 중단했어요.');
    this.preview={token,candidates,referenceFiles,historyDirectoryStat};
    return{token,items,bytes,referencedBytes,blocked,warnings:[...new Set(warnings)],batches,preservedGroups,preserved:'캐릭터 팩·말투·백업·복구본은 정리하지 않아요.'};
  }
  async quarantine({token,ids},options,isCurrent){
    const previous=this.preview;
    if(!previous||token!==previous.token||!Array.isArray(ids)||!ids.length||ids.length>128||new Set(ids).size!==ids.length||ids.some(id=>!previous.candidates.has(id)))throw Error('정리 목록을 다시 확인하고 최대 128개를 선택해주세요.');
    await this.inspect(options);const latest=this.preview;
    const candidates=ids.map(id=>previous.candidates.get(id));
    for(const candidate of candidates)if(![...latest.candidates.values()].some(item=>item.relative===candidate.relative&&item.dev===candidate.dev&&item.ino===candidate.ino&&item.size===candidate.size&&item.mtimeMs===candidate.mtimeMs&&item.ctimeMs===candidate.ctimeMs))throw Error('참조나 파일이 변경됐어요. 정리 목록을 다시 확인해주세요.');
    if(!isCurrent())throw Error('작업 상태가 변경됐어요.');
    const directory=path.join(this.root,'cache-quarantine');if(!fs.existsSync(directory))fs.mkdirSync(directory,{mode:0o700});
    if(fs.lstatSync(directory).isSymbolicLink()||fs.realpathSync(directory)!==directory)throw Error('복구 보관 경로를 확인해주세요.');
    const batch=randomUUID(),folder=path.join(directory,batch);fs.mkdirSync(folder,{mode:0o700});
    const manifest={version:1,id:batch,createdAt:Date.now(),items:candidates.map(item=>({relative:item.relative,hash:item.hash,bytes:item.size}))};
    fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(manifest),{flag:'wx',mode:0o600});
    const moved=[],warnings=[];
    try{
      for(const candidate of candidates){
        if(!isCurrent()||fs.realpathSync(this.root)!==this.root||fs.realpathSync(directory)!==directory||fs.realpathSync(folder)!==folder)throw Error('정리 중 작업·경로 상태가 변경됐어요.');
        const historyStat=fs.statSync(path.join(this.root,'conversations'));
        if(historyStat.dev!==latest.historyDirectoryStat.dev||historyStat.ino!==latest.historyDirectoryStat.ino||historyStat.mtimeMs!==latest.historyDirectoryStat.mtimeMs||historyStat.ctimeMs!==latest.historyDirectoryStat.ctimeMs)throw Error('대화 목록이 변경됐어요.');
        for(const reference of latest.referenceFiles){const stat=fs.lstatSync(reference.file);if(!stat.isFile()||stat.isSymbolicLink()||['dev','ino','size','mtimeMs','ctimeMs'].some(key=>stat[key]!==reference[key]))throw Error('대화 참조가 변경됐어요.');}
        const parent=path.dirname(candidate.file);if(fs.realpathSync(parent)!==parent)throw Error('캐시 경로가 변경됐어요.');
        const stat=fs.lstatSync(candidate.file);
        if(!stat.isFile()||stat.isSymbolicLink()||['dev','ino','size','mtimeMs','ctimeMs'].some(key=>stat[key]!==candidate[key]))throw Error('선택한 캐시가 변경됐어요.');
        const sourceDescriptor=fs.openSync(candidate.file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));let sourceHash;
        try{const opened=fs.fstatSync(sourceDescriptor);if(opened.dev!==candidate.dev||opened.ino!==candidate.ino||opened.size!==candidate.size)throw Error('선택한 캐시가 변경됐어요.');const bytes=Buffer.alloc(candidate.size+1);let count=0;while(count<bytes.length){const read=fs.readSync(sourceDescriptor,bytes,count,bytes.length-count,null);if(!read)break;count+=read;}const after=fs.fstatSync(sourceDescriptor);if(after.size!==candidate.size||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs)throw Error('선택한 캐시가 변경됐어요.');sourceHash=createHash('sha256').update(bytes.subarray(0,count)).digest('hex');}finally{fs.closeSync(sourceDescriptor);}
        if(sourceHash!==candidate.hash)throw Error('선택한 캐시가 변경됐어요.');
        const backup=path.join(folder,candidate.relative);fs.mkdirSync(path.dirname(backup),{recursive:true,mode:0o700});
        if(fs.realpathSync(path.dirname(backup))!==path.dirname(backup)||fs.existsSync(backup))throw Error('복구 보관 경로가 변경됐어요.');
        fs.renameSync(candidate.file,backup);
        const saved=fs.lstatSync(backup);
        if(!saved.isFile()||saved.isSymbolicLink()||saved.dev!==candidate.dev||saved.ino!==candidate.ino||saved.size!==candidate.size){try{fs.linkSync(backup,candidate.file);}catch{}throw Error('변경된 파일을 복구 보관했어요. 원본 위치와 보관 폴더를 확인해주세요.');}
        const descriptor=fs.openSync(backup,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));let digest;
        try{const bytes=Buffer.alloc(candidate.size+1);let count=0;while(count<bytes.length){const read=fs.readSync(descriptor,bytes,count,bytes.length-count,null);if(!read)break;count+=read;}digest=createHash('sha256').update(bytes.subarray(0,count)).digest('hex');}finally{fs.closeSync(descriptor);}
        if(digest!==candidate.hash){try{fs.linkSync(backup,candidate.file);}catch{}throw Error('변경된 파일을 복구 보관했어요. 원본 위치와 보관 폴더를 확인해주세요.');}
        moved.push(candidate.relative);
        await new Promise(resolve=>setImmediate(resolve));
      }
    }catch(error){warnings.push(error.message);}
    finally{this.preview=null;}
    return{batch,moved,warnings,partial:moved.length!==candidates.length,bytes:candidates.filter(item=>moved.includes(item.relative)).reduce((sum,item)=>sum+item.size,0)};
  }
  async restore(id,isCurrent){
    if(typeof id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))throw Error('복구 보관 ID를 확인해주세요.');
    const directory=path.join(this.root,'cache-quarantine'),folder=path.join(directory,id),file=path.join(folder,'manifest.json');
    for(const item of [this.root,directory,folder])if(fs.lstatSync(item).isSymbolicLink()||fs.realpathSync(item)!==item)throw Error('복구 경로의 링크는 사용할 수 없어요.');
    if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>65536)throw Error('복구 목록을 확인해주세요.');
    const descriptor=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));let manifest;
    try{const stat=fs.fstatSync(descriptor);if(!stat.isFile()||stat.size>65536)throw Error('복구 목록 크기를 확인해주세요.');const bytes=Buffer.alloc(stat.size+1);let count=0;while(count<bytes.length){const read=fs.readSync(descriptor,bytes,count,bytes.length-count,null);if(!read)break;count+=read;}if(count!==stat.size||fs.fstatSync(descriptor).size!==stat.size)throw Error('복구 목록이 변경됐어요.');manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,count)));}finally{fs.closeSync(descriptor);}
    if(manifest?.version!==1||manifest.id!==id||!Array.isArray(manifest.items)||manifest.items.length>128||new Set(manifest.items.map(item=>item?.relative)).size!==manifest.items.length)throw Error('복구 목록 형식을 확인해주세요.');
    for(const item of manifest.items)if(!item||typeof item.relative!=='string'||!/^(response-images|attachments)\/[a-f0-9]{64}\.[a-z0-9]{1,16}$/.test(item.relative)||typeof item.hash!=='string'||!/^[a-f0-9]{64}$/.test(item.hash)||path.basename(item.relative).slice(0,64)!==item.hash||!Number.isSafeInteger(item.bytes)||item.bytes<1||item.bytes>16*1024*1024)throw Error('복구 파일 범위를 확인해주세요.');
    const restored=[],warnings=[],usage=new Map();
    for(const category of new Set(manifest.items.map(item=>item.relative.split('/')[0]))){
      const parent=path.join(this.root,category);if(fs.realpathSync(parent)!==parent)throw Error('캐시 폴더를 확인해주세요.');
      let used=0;const entries=fs.readdirSync(parent);if(entries.length>10000)throw Error('캐시 파일이 많아 전체 확인이 필요해요.');
      for(const name of entries){const stat=fs.lstatSync(path.join(parent,name));if(!stat.isFile()||stat.isSymbolicLink())throw Error('캐시 폴더의 파일을 확인해주세요.');used+=stat.size;}
      usage.set(category,used);
    }
    for(const item of manifest.items){
      if(!isCurrent()){warnings.push('복구 중 작업 상태가 변경되어 나머지를 보존했어요.');break;}
      const backup=path.join(folder,item.relative),destination=path.join(this.root,item.relative);
      if(!fs.existsSync(backup))continue;
      try{
        for(const parent of [path.dirname(backup),path.dirname(destination)])if(fs.lstatSync(parent).isSymbolicLink()||fs.realpathSync(parent)!==parent)throw Error('복구 파일 폴더의 링크');
        const stat=fs.lstatSync(backup);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==item.bytes)throw Error('변경된 복구 파일 보존');
        const descriptor=fs.openSync(backup,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));let bytes;
        try{const opened=fs.fstatSync(descriptor);if(opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==item.bytes)throw Error('복구 파일 변경');const buffer=Buffer.alloc(item.bytes+1);let count=0;while(count<buffer.length){const read=fs.readSync(descriptor,buffer,count,buffer.length-count,null);if(!read)break;count+=read;}bytes=buffer.subarray(0,count);}finally{fs.closeSync(descriptor);}
        if(bytes.length!==item.bytes||createHash('sha256').update(bytes).digest('hex')!==item.hash)throw Error('변경된 복구 파일 보존');
        const category=item.relative.split('/')[0];if(usage.get(category)+item.bytes>512*1024*1024)throw Error('캐시 512MiB 한도로 복구본 보존');
        fs.writeFileSync(destination,bytes,{flag:'wx',mode:0o600});usage.set(category,usage.get(category)+item.bytes);restored.push(item.relative);
      }catch(error){warnings.push(item.relative+': '+(error.code==='EEXIST'?'이미 있는 파일을 보존했어요.':error.message));}
      await new Promise(resolve=>setImmediate(resolve));
    }
    this.preview=null;return{restored,warnings,backupPreserved:true};
  }
}
module.exports={StorageMaintenance};
