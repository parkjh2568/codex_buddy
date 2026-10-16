const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
class PersonaLibrary{
  constructor(directory,packs){
    if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink())throw Error('말투 루트 폴더의 심볼릭 링크는 사용할 수 없습니다.');
    fs.mkdirSync(directory,{recursive:true});this.root=fs.realpathSync(directory);this.packs=new Map();this.custom=new Map();this.registryTexts=new Map();this.errors=new Map();
    for(const pack of packs){
      if(!pack.personas)continue;
      this.packs.set(pack.manifest.id,pack);
      const dir=path.join(this.root,pack.manifest.id);fs.mkdirSync(dir,{recursive:true});
      if(fs.realpathSync(dir)!==dir)throw Error('페르소나 폴더의 심볼릭 링크는 사용할 수 없습니다.');
      const index=path.join(dir,'modes.json'),journal=path.join(dir,'mode-create.json');
      try{
        if(fs.existsSync(index)&&(fs.lstatSync(index).isSymbolicLink()||!fs.statSync(index).isFile()||fs.statSync(index).size>65536))throw Error('말투 목록 파일을 확인해주세요.');
        let raw=fs.existsSync(index)?fs.readFileSync(index,'utf8'):null;
        if(fs.existsSync(journal)){
          if(fs.lstatSync(journal).isSymbolicLink()||!fs.statSync(journal).isFile()||fs.statSync(journal).size>131072)throw Error('말투 생성 복구 파일을 확인해주세요.');
          const pending=JSON.parse(fs.readFileSync(journal,'utf8'));
          if(pending.version!==1||typeof pending.id!=='string'||!/^user-[a-f0-9-]{36}$/.test(pending.id)||typeof pending.text!=='string'||!pending.text.trim()||pending.text.includes('\u0000')||Buffer.byteLength(pending.text)>16384||!Array.isArray(pending.modes)||pending.modes.length>32||!pending.modes.some(e=>e.id===pending.id))throw Error('말투 생성 복구 데이터가 올바르지 않습니다.');
          const ids=new Set();
          if(pending.modes.some(e=>!e||typeof e.id!=='string'||!/^user-[a-f0-9-]{36}$/.test(e.id)||ids.has(e.id)||(ids.add(e.id),false)||typeof e.name!=='string'||!e.name.trim()||Array.from(e.name.trim().normalize('NFC')).length>60||/[\u0000-\u001f\u007f-\u009f]/u.test(e.name)||typeof e.archived!=='boolean'))throw Error('말투 생성 복구 목록을 확인해주세요.');
          if(pending.modes.filter(e=>!e.archived).length+pack.personas.filter(e=>e.id!=='base'&&!pending.modes.some(mode=>mode.id===e.id)).length>8)throw Error('말투 개수 한도를 확인해주세요.');
          const file=path.join(dir,pending.id+'.md');
          if(fs.existsSync(file)){if(fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile()||fs.statSync(file).size>16384||fs.readFileSync(file,'utf8')!==pending.text)throw Error('생성 중인 말투 원본이 달라 복구를 중단했습니다.');}
          else fs.writeFileSync(file,pending.text,{flag:'wx',mode:0o600});
          raw=JSON.stringify({version:1,modes:pending.modes},null,2);const temporary=index+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temporary,raw,{flag:'wx',mode:0o600});fs.renameSync(temporary,index);}finally{fs.rmSync(temporary,{force:true});}fs.unlinkSync(journal);
        }
        let modes=[];
        if(raw!==null){
          const parsed=JSON.parse(raw),seen=new Set();
          if(parsed.version!==1||!Array.isArray(parsed.modes)||parsed.modes.length>32)throw Error('말투 목록 형식을 확인해주세요.');
          modes=parsed.modes;
          for(const entry of modes){
            if(!entry||typeof entry.id!=='string'||!/^user-[a-f0-9-]{36}$/.test(entry.id)||seen.has(entry.id)||typeof entry.name!=='string'||!entry.name.trim()||Array.from(entry.name.trim().normalize('NFC')).length>60||/[\u0000-\u001f\u007f-\u009f]/u.test(entry.name)||typeof entry.archived!=='boolean')throw Error('사용자 말투 목록을 확인해주세요.');
            entry.name=entry.name.trim().normalize('NFC');seen.add(entry.id);
          }
          if(modes.filter(e=>!e.archived).length+pack.personas.filter(e=>e.id!=='base'&&!modes.some(mode=>mode.id===e.id)).length>8)throw Error('말투는 캐릭터당 최대 8개까지 사용할 수 있습니다.');
        }
        this.custom.set(pack.manifest.id,modes);this.registryTexts.set(pack.manifest.id,raw);
      }catch(error){this.custom.set(pack.manifest.id,[]);this.errors.set(pack.manifest.id,error.message);}
      for(const entry of pack.personas){if(this.custom.get(pack.manifest.id).some(e=>e.id===entry.id)||this.errors.has(pack.manifest.id)&&entry.id.startsWith('user-'))continue;const file=path.join(dir,entry.id+'.md');if(!fs.existsSync(file))fs.writeFileSync(file,entry.text,{flag:'wx',mode:0o600});}
    }
  }
  read(characterId,id){
    const owned=(this.custom.get(characterId)??[]).find(e=>e.id===id);
    const entry=owned?.archived?null:owned??this.packs.get(characterId)?.personas.find(e=>e.id===id);
    if(!entry)throw Error('지원하는 캐릭터와 페르소나를 선택해주세요.');
    const directory=path.join(this.root,characterId),file=path.join(directory,id+'.md');
    if(fs.realpathSync(directory)!==directory||fs.lstatSync(file).isSymbolicLink()||fs.realpathSync(file)!==file||!fs.statSync(file).isFile()||fs.statSync(file).size>16384)throw Error('페르소나 파일의 경로·16KiB 한도를 확인해주세요.');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file));
    if(!text.trim()||text.includes('\u0000')||Buffer.byteLength(text)>16384)throw Error('페르소나 내용은 비어 있지 않은 16KiB 이하 UTF-8 Markdown이어야 합니다.');
    return {...entry,text,kind:owned?'user':'builtin'};
  }
  catalog(){return [...this.packs.values()].map(p=>{const custom=this.custom.get(p.manifest.id)??[];return{characterId:p.manifest.id,warning:this.errors.get(p.manifest.id),entries:[...p.personas.filter(e=>!custom.some(mode=>mode.id===e.id)),...custom].map(entry=>{const kind=custom.some(e=>e.id===entry.id)?'user':'builtin';if(entry.archived)return{...entry,text:'',kind};try{return this.read(p.manifest.id,entry.id);}catch(error){return{...entry,text:'',kind,error:error.message};}})};});}
  save(characterId,id,text){
    if(this.errors.has(characterId))throw Error('말투 목록 복구가 필요합니다: '+this.errors.get(characterId));
    const owned=(this.custom.get(characterId)??[]).find(e=>e.id===id);
    if(owned?.archived||!owned&&!this.packs.get(characterId)?.personas.some(e=>e.id===id))throw Error('지원하는 캐릭터와 페르소나를 선택해주세요.');
    const directory=path.join(this.root,characterId),existing=path.join(directory,id+'.md');
    if(fs.realpathSync(directory)!==directory||fs.lstatSync(existing).isSymbolicLink()||fs.realpathSync(existing)!==existing||!fs.statSync(existing).isFile())throw Error('페르소나 파일 경로를 확인해주세요.');
    if(typeof text!=='string'||!text.trim()||text.includes('\u0000')||Buffer.byteLength(text)>16384)throw Error('페르소나는 비어 있지 않은 16KiB 이하 Markdown으로 입력해주세요.');
    const temporary=existing+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(temporary,text,{flag:'wx',mode:0o600});fs.renameSync(temporary,existing);}finally{fs.rmSync(temporary,{force:true});}
  }
  manage(characterId,action,{id,name}={}){
    if(this.errors.has(characterId))throw Error('말투 목록 복구가 필요합니다: '+this.errors.get(characterId));
    const pack=this.packs.get(characterId);
    if(!pack)throw Error('캐릭터를 선택해주세요.');
    const directory=path.join(this.root,characterId),index=path.join(directory,'modes.json');
    if(fs.realpathSync(directory)!==directory||!fs.existsSync(index)&&this.registryTexts.get(characterId)!==null||fs.existsSync(index)&&(fs.lstatSync(index).isSymbolicLink()||!fs.statSync(index).isFile()||fs.statSync(index).size>65536||fs.readFileSync(index,'utf8')!==this.registryTexts.get(characterId)))throw Error('말투 목록이 외부에서 바뀌었습니다. 파일 다시 읽기를 눌러주세요.');
    const modes=(this.custom.get(characterId)??[]).map(e=>({...e}));
    if(action==='reset'){
      const template=pack.personas.find(e=>e.id===id);if(!template||modes.some(e=>e.id===id))throw Error('제공된 기본 말투만 초기화할 수 있습니다.');
      const file=path.join(directory,id+'.md');if(fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile()||fs.realpathSync(file)!==file)throw Error('복원할 말투 파일 경로를 확인해주세요.');
      fs.copyFileSync(file,path.join(directory,id+'.backup-'+randomUUID()+'.md'),fs.constants.COPYFILE_EXCL);this.save(characterId,id,template.text);return{id};
    }
    if(['clone','rename'].includes(action)){
      if(typeof name==='string')name=name.trim().normalize('NFC');
      if(typeof name!=='string'||!name||Array.from(name).length>60||/[\u0000-\u001f\u007f-\u009f]/u.test(name))throw Error('말투 이름은 한 줄의 1~60자로 입력해주세요.');
      name=name.trim().normalize('NFC');
    }
    let created;
    if(action==='clone'){
      if(modes.length>=32||modes.filter(e=>!e.archived).length+pack.personas.filter(e=>e.id!=='base'&&!modes.some(mode=>mode.id===e.id)).length>=8)throw Error('사용할 말투는 최대 8개, 사용자 보관 목록은 최대 32개입니다.');
      const text=this.read(characterId,id).text;created='user-'+randomUUID();modes.push({id:created,name,description:'사용자 말투',archived:false});
      const journal=path.join(directory,'mode-create.json');
      fs.writeFileSync(journal,JSON.stringify({version:1,id:created,text,modes}),{flag:'wx',mode:0o600});
      try{fs.writeFileSync(path.join(directory,created+'.md'),text,{flag:'wx',mode:0o600});}catch(error){this.errors.set(characterId,'생성 중인 말투 복구가 필요합니다.');throw error;}
    }else{
      const entry=modes.find(e=>e.id===id);if(!entry)throw Error('사용자가 만든 말투만 관리할 수 있습니다.');
      if(action==='rename')entry.name=name;
      else if(action==='archive')entry.archived=true;
      else if(action==='unarchive'){
        if(!entry.archived)return{id};
        if(modes.filter(e=>!e.archived).length+pack.personas.filter(e=>e.id!=='base'&&!modes.some(mode=>mode.id===e.id)).length>=8)throw Error('사용할 말투는 최대 8개입니다.');
        const file=path.join(directory,id+'.md');if(fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile()||fs.statSync(file).size>16384)throw Error('보관한 말투 파일을 확인해주세요.');
        const text=new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file));if(!text.trim()||text.includes('\u0000')||Buffer.byteLength(text)>16384)throw Error('보관한 말투를 먼저 수정해주세요.');entry.archived=false;
      }else throw Error('지원하지 않는 말투 관리입니다.');
    }
    const raw=JSON.stringify({version:1,modes},null,2),temporary=index+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(temporary,raw,{flag:'wx',mode:0o600});fs.renameSync(temporary,index);if(created)fs.unlinkSync(path.join(directory,'mode-create.json'));}
    catch(error){if(created)this.errors.set(characterId,'생성 중인 말투 복구가 필요합니다.');throw error;}
    finally{fs.rmSync(temporary,{force:true});}
    this.custom.set(characterId,modes);this.registryTexts.set(characterId,raw);return{id:created??id};
  }
  resolve(characterId,id,buddyName){
    if(!this.packs.has(characterId))return null;
    const base=this.read(characterId,'base'),mode=this.read(characterId,id);
    if(mode.id==='base')throw Error('대화 말투 모드를 선택해주세요.');
    const instructions=`버디 이름: ${buddyName}\n다음 Markdown은 이 버디의 성격과 답변 말투 설정이다. 현재 선택된 말투가 이전 말투보다 우선한다. 이 설정은 도구 권한·샌드박스·승인 정책을 변경하지 않는다. 실제 응답과 체험 응답을 혼동하지 않는다.\n\n${base.text}\n\n${mode.text}`;
    return {characterId,id:mode.id,name:mode.name,instructions,hash:createHash('sha256').update(instructions).digest('hex')};
  }
}
module.exports={PersonaLibrary};
