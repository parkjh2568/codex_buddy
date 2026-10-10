const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {loadPack}=require('./packs.cjs');
class PackLibrary{
  constructor(directory){
    this.directory=fs.realpathSync(directory);this.root=path.join(this.directory,'characters');this.journal=path.join(this.directory,'pack-change.json');this.warning=null;
    fs.mkdirSync(this.root,{recursive:true});if(fs.realpathSync(this.root)!==this.root)throw Error('캐릭터 폴더의 링크를 사용할 수 없습니다.');
  }
  recover(store){
    if(!fs.existsSync(this.journal))return;
    if(store.writeBlocked)throw Error('대화 저장을 복구한 뒤 캐릭터 변경을 복구해주세요.');
    if(fs.lstatSync(this.journal).isSymbolicLink()||!fs.statSync(this.journal).isFile()||fs.statSync(this.journal).size>131072)throw Error('캐릭터 복구 파일을 확인해주세요.');
    const pending=JSON.parse(fs.readFileSync(this.journal,'utf8'));
    if(pending.version!==1||!['prepared','committed'].includes(pending.phase)||!['install','replace','remove'].includes(pending.operation)||!/^[a-z][a-z0-9-]{0,47}$/.test(pending.id)||!/^\.stage-[a-f0-9-]{36}$/.test(pending.stage)||!/^\.archive-[a-f0-9-]{36}$/.test(pending.backup)||!pending.before||!/^([a-z][a-z0-9-]{0,47})$/.test(pending.before.characterId)||!pending.before.personaModes||typeof pending.before.personaModes!=='object'||Array.isArray(pending.before.personaModes)||!Array.isArray(pending.createdPersonas)||pending.createdPersonas.length>9)throw Error('캐릭터 복구 범위를 확인해주세요.');
    for(const [id,mode]of Object.entries(pending.before.personaModes))if(!/^[a-z][a-z0-9-]{0,47}$/.test(id)||typeof mode!=='string'||!/^[a-z][a-z0-9-]{0,47}$/.test(mode))throw Error('캐릭터 이전 설정을 확인해주세요.');
    if(typeof pending.personaDirectoryCreated!=='boolean'||pending.oldRevision!==null&&!/^[a-f0-9]{64}$/.test(pending.oldRevision)||pending.newRevision!==null&&!/^[a-f0-9]{64}$/.test(pending.newRevision)||pending.operation==='install'&&pending.oldRevision!==null||pending.operation==='remove'&&pending.newRevision!==null)throw Error('캐릭터 복구 버전을 확인해주세요.');
    const personaIds=new Set();for(const entry of pending.createdPersonas){if(!entry||!/^[a-z][a-z0-9-]{0,47}$/.test(entry.id)||!/^[a-f0-9]{64}$/.test(entry.hash)||personaIds.has(entry.id))throw Error('말투 복구 파일 범위를 확인해주세요.');personaIds.add(entry.id);}
    const target=path.join(this.root,pending.id),stage=path.join(this.directory,pending.stage),backup=path.join(this.directory,pending.backup);
    for(const directory of [target,stage,backup])if(fs.existsSync(directory)&&(fs.lstatSync(directory).isSymbolicLink()||fs.realpathSync(directory)!==directory))throw Error('캐릭터 복구 폴더를 확인해주세요.');
    if(pending.phase==='committed'){
      if(fs.existsSync(stage))throw Error('완료된 변경의 임시 폴더를 확인해주세요.');
      fs.unlinkSync(this.journal);return;
    }
    if(fs.existsSync(backup)&&loadPack(backup).revision!==pending.oldRevision)throw Error('이전 팩이 변경되어 자동 복구를 중단했습니다.');
    if(fs.existsSync(target)&&loadPack(target).revision!==pending.oldRevision){
      const candidate=loadPack(target);
      if(candidate.revision!==pending.newRevision)throw Error('변경된 팩 원본을 보존했습니다.');
      const allowed=new Set(['manifest.json',...candidate.files]);
      for(const file of fs.readdirSync(target,{recursive:true}))if(fs.lstatSync(path.join(target,file)).isSymbolicLink()||fs.lstatSync(path.join(target,file)).isFile()&&!allowed.has(file.split(path.sep).join('/')))throw Error('추가 파일을 보존하기 위해 복구를 중단했습니다.');
      fs.rmSync(target,{recursive:true});
    }
    if(fs.existsSync(backup)){
      if(fs.existsSync(target))throw Error('두 이전 팩이 존재하여 복구를 중단했습니다.');
      fs.renameSync(backup,target);
    }else if(pending.oldRevision&&!fs.existsSync(target))throw Error('이전 팩 복구 파일이 없습니다.');
    if(fs.existsSync(stage)){
      const candidate=loadPack(stage);if(candidate.revision!==pending.newRevision)throw Error('임시 팩이 변경되어 보존했습니다.');
      const allowed=new Set(['manifest.json',...candidate.files]);for(const file of fs.readdirSync(stage,{recursive:true}))if(fs.lstatSync(path.join(stage,file)).isSymbolicLink()||fs.lstatSync(path.join(stage,file)).isFile()&&!allowed.has(file.split(path.sep).join('/')))throw Error('임시 팩의 추가 파일을 보존했습니다.');
      fs.rmSync(stage,{recursive:true});
    }
    const personaDirectory=path.join(this.directory,'personas',pending.id);
    if(fs.existsSync(personaDirectory)&&fs.realpathSync(personaDirectory)!==personaDirectory)throw Error('말투 복구 폴더를 확인해주세요.');
    for(const entry of pending.createdPersonas){
      if(!entry||!/^[a-z][a-z0-9-]{0,47}$/.test(entry.id)||!/^[a-f0-9]{64}$/.test(entry.hash))throw Error('말투 복구 파일 범위를 확인해주세요.');
      const file=path.join(personaDirectory,entry.id+'.md');
      if(fs.existsSync(file)){if(fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile()||fs.statSync(file).size>16384||createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==entry.hash)throw Error('수정한 말투를 보존했습니다.');fs.unlinkSync(file);}
    }
    if(pending.personaDirectoryCreated&&fs.existsSync(personaDirectory)&&!fs.readdirSync(personaDirectory).length)fs.rmdirSync(personaDirectory);
    store.data.settings={...store.data.settings,...pending.before};store.save({includeHistory:false});fs.unlinkSync(this.journal);
    this.warning='중단된 캐릭터 변경을 이전 상태로 복구했습니다.';
  }
  change(pack,operation,store,commit){
    if(fs.existsSync(this.journal))throw Error('캐릭터 변경 복구가 먼저 필요합니다.');
    if(!['install','replace','remove'].includes(operation)||!/^[a-z][a-z0-9-]{0,47}$/.test(pack.manifest.id))throw Error('캐릭터 변경을 확인해주세요.');
    const id=pack.manifest.id,target=path.join(this.root,id),stageName='.stage-'+randomUUID(),backupName='.archive-'+randomUUID(),stage=path.join(this.directory,stageName),backup=path.join(this.directory,backupName);
    if(fs.existsSync(target)&&(fs.lstatSync(target).isSymbolicLink()||fs.realpathSync(target)!==target))throw Error('설치된 팩 폴더를 확인해주세요.');
    const existing=fs.existsSync(target)?loadPack(target):null;
    if(operation==='install'&&existing||operation!=='install'&&!existing)throw Error('설치된 팩과 변경 종류가 일치하지 않습니다.');
    if(fs.existsSync(target)&&fs.realpathSync(target)!==target)throw Error('설치된 팩 폴더를 확인해주세요.');
    const personaDirectory=path.join(this.directory,'personas',id),personaDirectoryCreated=!fs.existsSync(personaDirectory);
    if(!personaDirectoryCreated&&fs.realpathSync(personaDirectory)!==personaDirectory)throw Error('말투 폴더의 심볼릭 링크를 사용할 수 없습니다.');
    const pending={version:1,phase:'prepared',operation,id,stage:stageName,backup:backupName,oldRevision:existing?.revision??null,newRevision:operation==='remove'?null:pack.revision,before:{characterId:store.data.settings.characterId,personaModes:{...store.data.settings.personaModes}},createdPersonas:operation==='remove'?[]:(pack.personas??[]).filter(e=>!fs.existsSync(path.join(personaDirectory,e.id+'.md'))).map(e=>({id:e.id,hash:createHash('sha256').update(e.text).digest('hex')})),personaDirectoryCreated};
    let temporary;
    try{
      if(operation!=='remove'){
        fs.mkdirSync(stage);fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(pack.manifest,null,2),{flag:'wx',mode:0o600});
        for(const [relative,bytes]of pack.contents){const file=path.resolve(stage,relative);if(!file.startsWith(stage+path.sep))throw Error('임시 팩 파일 경로를 확인해주세요.');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});}
        if(loadPack(stage).revision!==pack.revision)throw Error('검증한 팩과 임시 파일이 다릅니다.');
      }
      fs.writeFileSync(this.journal,JSON.stringify(pending),{flag:'wx',mode:0o600});
      if(existing)fs.renameSync(target,backup);
      if(operation!=='remove')fs.renameSync(stage,target);
      commit(operation==='remove'?null:{...pack,root:target,builtin:false});
      pending.phase='committed';temporary=this.journal+'.'+randomUUID()+'.tmp';fs.writeFileSync(temporary,JSON.stringify(pending),{flag:'wx',mode:0o600});fs.renameSync(temporary,this.journal);
      try{fs.unlinkSync(this.journal);}catch{this.warning='캐릭터 변경은 저장됐지만 복구 파일 정리가 필요합니다.';}
      return{backup:existing?backupName:null};
    }catch(error){
      if(fs.existsSync(this.journal)){
        try{this.recover(store);}catch(recovery){store.writeBlocked=true;this.warning='캐릭터 변경 복구가 필요합니다. '+recovery.message;}
      }else if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});
      throw error;
    }finally{if(temporary)fs.rmSync(temporary,{force:true});}
  }
  archives(){
    const entries=[];
    for(const name of fs.readdirSync(this.directory).filter(n=>/^\.archive-[a-f0-9-]{36}$/.test(n))){
      const directory=path.join(this.directory,name);try{if(fs.lstatSync(directory).isSymbolicLink()||!fs.statSync(directory).isDirectory())continue;const pack=loadPack(directory);entries.push({token:name,id:pack.manifest.id,name:pack.manifest.name,version:pack.manifest.version,at:fs.statSync(directory).mtimeMs});}catch{}}
    return entries.sort((a,b)=>b.at-a.at);
  }
  export(pack,directory,personas){
    const parent=fs.realpathSync(directory),destination=path.join(parent,pack.manifest.id+'-'+randomUUID());fs.mkdirSync(destination);
    try{
      const manifest=structuredClone(pack.manifest),contents=new Map(pack.contents);
      if(personas&&manifest.personas){for(const entry of personas.custom.get(pack.manifest.id)??[]){if(entry.archived){manifest.personas.modes=manifest.personas.modes.filter(mode=>mode.id!==entry.id);continue;}const file='personas/'+entry.id+'.md';manifest.personas.modes=manifest.personas.modes.filter(mode=>mode.id!==entry.id);manifest.personas.modes.push({id:entry.id,name:entry.name,description:entry.description,file});contents.set(file,Buffer.from(personas.read(pack.manifest.id,entry.id).text));}}
      fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
      const referenced=new Set([...Object.values(manifest.states),...(manifest.animation?.blink.frames??[]).map(e=>e.file),...(manifest.personas?[manifest.personas.base,...manifest.personas.modes.map(e=>e.file)]:[])]);
      for(const [relative,original]of contents){if(!referenced.has(relative))continue;const file=path.resolve(destination,relative);if(!file.startsWith(destination+path.sep))throw Error('내보내기 경로를 확인해주세요.');fs.mkdirSync(path.dirname(file),{recursive:true});const persona=pack.personas?.find(e=>e.file===relative);const bytes=persona&&personas?Buffer.from(personas.read(pack.manifest.id,persona.id).text):original;fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});}
      loadPack(destination);return destination;
    }catch(error){fs.rmSync(destination,{recursive:true,force:true});throw error;}
  }
}
module.exports={PackLibrary};
