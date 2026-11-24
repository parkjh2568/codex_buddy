const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs');

for(const phase of ['before-open','after-read'])for(const entry of ['read','open','startup'])test(`history ${entry} rejects a path replacement ${phase} and preserves both files`,t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-history-identity-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{demo:true});store.data.messages=[{id:'original',role:'user',text:'original',status:'completed'}];store.save();
  const id=store.data.activeConversationId,file=path.join(store.historyDirectory,id+'.json'),original=fs.readFileSync(file),state=fs.readFileSync(store.file),replacement=Buffer.from(original.toString().replaceAll('original','replaced'));
  store.newConversation();const previous={...store.data},before=fs.readFileSync(store.file);
  if(entry==='startup')fs.writeFileSync(store.file,state);
  const open=fs.openSync,fstat=fs.fstatSync;let fd,calls=0,changed=false;
  const opened=t.mock.method(fs,'openSync',(target,...args)=>{
    if(target===file&&phase==='before-open'&&!changed){changed=true;fs.renameSync(file,file+'.preserved');fs.writeFileSync(file,replacement);}
    const descriptor=open(target,...args);if(target===file)fd=descriptor;return descriptor;
  });
  const stated=t.mock.method(fs,'fstatSync',(descriptor,...args)=>{
    const stat=fstat(descriptor,...args);
    if(descriptor===fd&&++calls===2&&phase==='after-read'&&!changed){changed=true;fs.renameSync(file,file+'.preserved');fs.writeFileSync(file,replacement);}
    return stat;
  });
  try{
    if(entry==='startup'){const loaded=new Store(root,{});assert.match(loaded.warning??'',/변경/);assert.equal(loaded.data.activeConversationId,null);assert.deepEqual(loaded.data.messages,[]);assert.equal(loaded.writeBlocked,true);assert.throws(()=>loaded.save(),/복구/);}
    else{assert.throws(()=>entry==='open'?store.openConversation(id):store.readHistory(id),/변경/);assert.equal(store.data.activeConversationId,previous.activeConversationId);assert.equal(store.data.messages,previous.messages);assert.deepEqual(fs.readFileSync(store.file),before);}
    assert.equal(changed,true);assert.throws(()=>fstat(fd),/EBADF/);assert.deepEqual(fs.readFileSync(file+'.preserved'),original);assert.deepEqual(fs.readFileSync(file),replacement);
  }finally{stated.mock.restore();opened.mock.restore();}
});

for(const phase of ['before-open','after-read'])test(`save worker blocks writes after detecting a history replacement ${phase}`,async t=>{
  const {Worker}=require('node:worker_threads'),vm=require('node:vm'),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-worker-identity-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const seeded=new Store(root,{demo:true});seeded.data.messages=[{id:'original',role:'user',text:'original',status:'completed'}];seeded.save();
  const file=path.join(seeded.historyDirectory,seeded.data.activeConversationId+'.json'),original=fs.readFileSync(file),state=fs.readFileSync(seeded.file),replacement=Buffer.from(original.toString().replaceAll('original','replaced'));
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/store.cjs'),'utf8'),{module,__dirname:path.join(__dirname,'../src'),Buffer,TextDecoder,setTimeout,clearTimeout,require:name=>name==='node:worker_threads'?{Worker:class extends Worker{
    constructor(workerFile,options){
      super(`const fs=require('node:fs'),target=${JSON.stringify(file)},phase=${JSON.stringify(phase)},open=fs.openSync,fstat=fs.fstatSync;let descriptor,calls=0,changed=false;
        fs.openSync=function(file,...args){if(file===target&&phase==='before-open'&&!changed){changed=true;const bytes=fs.readFileSync(file);fs.renameSync(file,file+'.preserved');fs.writeFileSync(file,bytes.toString().replaceAll('original','replaced'));}const fd=open(file,...args);if(file===target)descriptor=fd;return fd;};
        fs.fstatSync=function(fd,...args){const stat=fstat(fd,...args);if(fd===descriptor&&++calls===2&&phase==='after-read'&&!changed){changed=true;const bytes=fs.readFileSync(target);fs.renameSync(target,target+'.preserved');fs.writeFileSync(target,bytes.toString().replaceAll('original','replaced'));}return stat;};
        require(${JSON.stringify(workerFile)});`,{...options,eval:true});
    }
  }}:require(name)});
  const store=new module.exports.Store(root,{});t.after(()=>store.closeWorker());store.data.messages[0].text='new main data';
  await assert.rejects(store.saveAsync(),/복구/);assert.equal(store.writeBlocked,true);assert.equal(store.saving,null);await assert.rejects(store.saveAsync(),/복구/);
  assert.deepEqual(fs.readFileSync(file+'.preserved'),original);assert.deepEqual(fs.readFileSync(file),replacement);assert.deepEqual(fs.readFileSync(store.file),state);
});

for(const mode of ['missing','invalid-json','invalid-utf8'])test(`unreadable active history (${mode}) blocks writes and deletion recovery`,async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-history-startup-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const seeded=new Store(root,{demo:true});seeded.data.messages=[{id:'owned',role:'user',text:'preserve',status:'completed'}];seeded.save();const id=seeded.data.activeConversationId,file=path.join(seeded.historyDirectory,id+'.json');
  seeded.beginDeletion(id);fs.writeFileSync(seeded.deleteFile,JSON.stringify({...seeded.pendingDeletion,phase:'cli-deleted'}));
  if(mode==='missing')fs.unlinkSync(file);else fs.writeFileSync(file,mode==='invalid-json'?'broken JSON':Buffer.from([123,255,125]));
  const state=fs.readFileSync(seeded.file),journal=fs.readFileSync(seeded.deleteFile),bytes=mode==='missing'?null:fs.readFileSync(file),loaded=new Store(root,{});
  assert.equal(loaded.writeBlocked,true);assert.ok(loaded.warning);assert.throws(()=>loaded.save(),/복구/);await assert.rejects(loaded.saveAsync(),/복구/);assert.equal(loaded.worker,null);
  assert.deepEqual(fs.readFileSync(seeded.file),state);assert.deepEqual(fs.readFileSync(seeded.deleteFile),journal);if(bytes)assert.deepEqual(fs.readFileSync(file),bytes);else assert.equal(fs.existsSync(file),false);
});
