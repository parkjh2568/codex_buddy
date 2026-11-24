const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const source=String.raw`
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{createHash}=require('node:crypto');
const [mode,root,storePath]=process.argv.slice(1),{Store}=require(storePath),store=new Store(root,{demo:true});
store.data.messages=[{id:'owned-user',role:'user',text:'preserve owned history',status:'completed'}];store.save();
const id=store.data.activeConversationId,history=path.join(store.historyDirectory,id+'.json');let target;
if(mode.startsWith('save-')){
  const state=fs.readFileSync(store.file),saved=JSON.parse(fs.readFileSync(history));saved.messages.push({id:'pending',role:'user',text:'not replayed',status:'queued'});const bytes=Buffer.from(JSON.stringify(saved));
  fs.writeFileSync(store.file+'.tmp',state);fs.writeFileSync(history+'.tmp',bytes);fs.writeFileSync(store.journalFile,JSON.stringify({version:1,historyId:id,stateHash:createHash('sha256').update(state).digest('hex'),historyHash:createHash('sha256').update(bytes).digest('hex')}));
  target=mode==='save-journal'?store.journalFile:mode==='save-index'?store.file+'.tmp':history+'.tmp';
}else if(mode.startsWith('delete-')){
  store.beginDeletion(id);fs.writeFileSync(store.deleteFile,JSON.stringify({...store.pendingDeletion,phase:'cli-deleted'}));target=mode==='delete-journal'?store.deleteFile:history;
}else target=mode.includes('state')?store.file:history;
const originals=new Map();for(const file of [store.file,history,store.journalFile,store.file+'.tmp',history+'.tmp',store.deleteFile])if(fs.existsSync(file))originals.set(file,fs.readFileSync(file));
(async()=>{
  let descriptor,flags,changed=false,readCalls=0;
  if(mode.startsWith('worker-')){
    const threads=require('node:worker_threads'),NativeWorker=threads.Worker;
    threads.Worker=class extends NativeWorker{constructor(file,options){super('const fs=require("node:fs"),{spawnSync}=require("node:child_process"),assert=require("node:assert/strict"),{parentPort}=require("node:worker_threads"),open=fs.openSync,read=fs.readSync,post=parentPort.postMessage;let descriptor,flags,changed=false,readCalls=0;fs.openSync=function(file,...args){if(file==='+JSON.stringify(target)+'&&!changed){changed=true;fs.renameSync(file,file+".preserved-source");const result=spawnSync("mkfifo",[file],{encoding:"utf8"});assert.equal(result.status,0,result.stderr);flags=args[0];const fd=open(file,...args);descriptor=fd;return fd;}return open(file,...args);};fs.readSync=function(fd,...args){if(fd===descriptor)readCalls++;return read(fd,...args);};parentPort.postMessage=function(result){let closed=false;try{fs.fstatSync(descriptor);}catch(error){closed=error.code==="EBADF";}return post.call(this,{...result,audit:{changed,flags,readCalls,closed}});};require('+JSON.stringify(file)+');',{...options,eval:true});}};
    delete require.cache[storePath];let owner;
    try{owner=new(require(storePath).Store)(root,{});}finally{threads.Worker=NativeWorker;}
    const pending=owner.saveAsync(),worker=owner.worker,outcomes=[];worker.on('message',message=>outcomes.push(message));await assert.rejects(pending,/경로|복구|link|directory/);
    const audit=outcomes[0].audit;assert.equal(audit.changed,true);assert.ok(audit.flags&fs.constants.O_NONBLOCK);assert.equal(audit.readCalls,0);assert.equal(audit.closed,true);await owner.closeWorker();changed=audit.changed;flags=audit.flags;
  }else{
    const open=fs.openSync,read=fs.readSync,copy=fs.copyFileSync;let copies=0;
    fs.openSync=function(file,...args){if(file===target&&!changed){changed=true;fs.renameSync(file,file+'.preserved-source');const result=spawnSync('mkfifo',[file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);flags=args[0];const fd=open(file,...args);descriptor=fd;return fd;}return open(file,...args);};
    fs.readSync=function(fd,...args){if(fd===descriptor)readCalls++;return read(fd,...args);};fs.copyFileSync=function(...args){copies++;return copy(...args);};
    try{
      if(mode==='state'){const loaded=new Store(root,{});assert.equal(loaded.writeBlocked,true);assert.match(loaded.warning,/원본|백업/);assert.throws(()=>loaded.save(),/복구/);}
      else if(mode==='history')assert.throws(()=>store.readHistory(id),/경로|크기/);
      else if(mode.startsWith('delete-')){assert.throws(()=>store.recoverPendingDeletion(),/경로|크기/);assert.equal(store.writeBlocked,true);}
      else assert.throws(()=>store.recoverPendingSave(),/경로|크기/);
    }finally{fs.openSync=open;fs.readSync=read;fs.copyFileSync=copy;}
    assert.equal(copies,0,'backup must use bounded captured bytes, not reopen the replaced path');assert.equal(changed,true);assert.ok(flags&fs.constants.O_NONBLOCK);assert.equal(readCalls,0);assert.throws(()=>fs.fstatSync(descriptor),/EBADF/);
  }
  assert.ok(fs.lstatSync(target).isFIFO());assert.ok(fs.readFileSync(target+'.preserved-source').equals(originals.get(target)));
  for(const [file,bytes]of originals)if(file!==target)assert.ok(fs.readFileSync(file).equals(bytes),file+' must be preserved');
  console.log(JSON.stringify({mode,changed,nonblocking:Boolean(flags&fs.constants.O_NONBLOCK),originalsPreserved:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});`;

test('all six Store read call sites reject real FIFO replacements and preserve originals and journals',t=>{
  if(process.platform==='win32'||!fs.constants.O_NONBLOCK){t.skip('POSIX FIFOs and nonblocking opens are required');return;}
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-store-read-fifo-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const mode of ['state','history','delete-journal','delete-history','save-journal','save-index','save-history']){
    const child=spawnSync(process.execPath,['-e',source,mode,path.join(root,mode),path.join(__dirname,'../src/store.cjs')],{encoding:'utf8',timeout:5000});
    assert.equal(child.error,undefined,mode+' '+child.stderr);assert.equal(child.status,0,mode+' '+child.stderr);const result=JSON.parse(child.stdout);assert.equal(result.mode,mode);assert.equal(result.nonblocking,true);assert.equal(result.originalsPreserved,true);
  }
});

test('saveAsync worker startup rejects replaced state and history FIFOs and releases its descriptor',t=>{
  if(process.platform==='win32'||!fs.constants.O_NONBLOCK){t.skip('POSIX FIFOs and nonblocking opens are required');return;}
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-worker-read-fifo-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const mode of ['worker-state','worker-history']){
    const child=spawnSync(process.execPath,['-e',source,mode,path.join(root,mode),path.join(__dirname,'../src/store.cjs')],{encoding:'utf8',timeout:5000});
    assert.equal(child.error,undefined,mode+' '+child.stderr);assert.equal(child.status,0,mode+' '+child.stderr);assert.equal(JSON.parse(child.stdout).originalsPreserved,true);
  }
});
