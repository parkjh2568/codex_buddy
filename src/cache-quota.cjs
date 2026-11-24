const fs=require('node:fs'),path=require('node:path');
const {setImmediate}=require('node:timers/promises');
const writes=new Map(),limit=512*1024*1024;

class CacheQuotaBatch{
  constructor(root,label){this.root=root;this.label=label;this.observed=null;this.used=0;this.release=null;this.work=null;}
  static get activeRoots(){return writes.size;}
  async acquire(){
    if(this.work)return;
    const previous=writes.get(this.root);let release;
    const work=new Promise(resolve=>{release=resolve;});this.work=work;writes.set(this.root,work);
    await previous;
    this.release=()=>{release();if(writes.get(this.root)===work)writes.delete(this.root);};
  }
  async prepare(additional){
    if(!this.release)throw Error('캐시 쓰기 소유권을 먼저 확인해주세요.');
    if(!this.observed){
      const before=fs.lstatSync(this.root),observed=[];let used=0,checked=0;
      if(!before.isDirectory()||before.isSymbolicLink()||fs.realpathSync(this.root)!==this.root)throw Error(this.label+' 폴더가 변경됐어요.');
      for(const name of fs.readdirSync(this.root)){
        const file=path.join(this.root,name),stat=fs.lstatSync(file);
        if(!stat.isFile()||stat.isSymbolicLink()||!Number.isSafeInteger(stat.size)||stat.size<0)throw Error(this.label+' 폴더의 파일을 확인해주세요.');
        used+=stat.size;observed.push({file,dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs});
        if(++checked%128===0){
          await setImmediate();const current=fs.lstatSync(this.root);
          if(!current.isDirectory()||current.isSymbolicLink()||fs.realpathSync(this.root)!==this.root||current.dev!==before.dev||current.ino!==before.ino||current.mtimeMs!==before.mtimeMs||current.ctimeMs!==before.ctimeMs)throw Error(this.label+' 폴더가 변경됐어요. 다시 확인해주세요.');
        }
      }
      const after=fs.lstatSync(this.root);
      if(!after.isDirectory()||after.isSymbolicLink()||fs.realpathSync(this.root)!==this.root||after.dev!==before.dev||after.ino!==before.ino||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error(this.label+' 폴더가 변경됐어요. 다시 확인해주세요.');
      this.observed=observed;this.used=used;this.identity=before;
    }
    if(!Number.isSafeInteger(additional)||additional<0||this.used+additional>limit)throw Error(this.label+' 저장 공간이 512MiB 한도에 도달했어요.');
  }
  verify(additional,temporary,identity,size){
    if(!this.release||!this.observed)throw Error('캐시 쓰기 범위를 다시 확인해주세요.');
    const before=fs.lstatSync(this.root);
    if(!before.isDirectory()||before.isSymbolicLink()||fs.realpathSync(this.root)!==this.root||before.dev!==this.identity.dev||before.ino!==this.identity.ino)throw Error(this.label+' 폴더가 변경됐어요.');
    const names=fs.readdirSync(this.root);
    if(names.length!==this.observed.length+1||!names.includes(path.basename(temporary)))throw Error(this.label+' 폴더의 파일이 변경됐어요. 다시 확인해주세요.');
    const staged=fs.lstatSync(temporary);
    if(!staged.isFile()||staged.isSymbolicLink()||staged.dev!==identity.dev||staged.ino!==identity.ino||staged.size!==size)throw Error(this.label+' 임시 파일이 변경됐어요.');
    // Known files plus the distinct owned temporary file exhaust the current listing.
    for(const entry of this.observed){
      let stat;
      try{stat=fs.lstatSync(entry.file);}catch(error){if(error.code==='ENOENT')throw Error(this.label+' 폴더의 파일이 변경됐어요. 다시 확인해주세요.');throw error;}
      if(entry.file===temporary||!stat.isFile()||stat.isSymbolicLink()||stat.dev!==entry.dev||stat.ino!==entry.ino||stat.size!==entry.size||stat.mtimeMs!==entry.mtimeMs||stat.ctimeMs!==entry.ctimeMs)throw Error(this.label+' 폴더의 파일이 변경됐어요. 다시 확인해주세요.');
    }
    const after=fs.lstatSync(this.root);
    if(!after.isDirectory()||after.isSymbolicLink()||fs.realpathSync(this.root)!==this.root||after.dev!==before.dev||after.ino!==before.ino||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error(this.label+' 폴더가 변경됐어요.');
    if(!Number.isSafeInteger(additional)||additional<0||this.used+additional>limit)throw Error(this.label+' 저장 공간이 512MiB 한도에 도달했어요.');
  }
  record(file,temporary){
    if(!this.observed)return;
    if(fs.lstatSync(temporary,{throwIfNoEntry:false})){this.invalidate();return;}
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()){this.invalidate();return;}
    this.used+=stat.size;this.observed.push({file,dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs});
  }
  invalidate(){this.observed=null;this.used=0;}
  close(){this.release?.();this.release=null;this.work=null;this.invalidate();}
}
module.exports={CacheQuotaBatch};
