const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {Store}=require('../src/store.cjs');

test('history preparation failures preserve the previous active state, settings and files',t=>{
  for(const mode of ['deep-json','stringify','hash']){
    const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-open-preparation-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const store=new Store(root,{demo:true,workspace:'/target',codexPath:'/target-cli'});store.data.threadId='target-thread';store.data.messages=[{id:'target',role:'user',text:'target',status:'completed',createdAt:1700000000000}];store.save();
    const id=store.data.activeConversationId,file=path.join(store.historyDirectory,id+'.json');store.newConversation();store.data.settings.workspace='/current';store.data.settings.codexPath='/current-cli';store.data.threadId='current-thread';store.data.messages=[{id:'current',role:'user',text:'current',status:'completed',createdAt:1700000000001}];store.save();
    if(mode==='deep-json')fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('"text":"target"','"text":"target","error":'+'['.repeat(15000)+'0'+']'.repeat(15000)));
    const state=fs.readFileSync(store.file),history=fs.readFileSync(file),previous={id:store.data.activeConversationId,threadId:store.data.threadId,messages:store.data.messages,settings:{...store.data.settings},snapshot:store.snapshot,conversations:structuredClone(store.data.conversations)};
    const stringify=JSON.stringify,update=crypto.Hash.prototype.update;let mock;
    if(mode==='stringify')mock=t.mock.method(JSON,'stringify',function(value,...args){if(value?.id===id&&Array.isArray(value.messages))throw Error('injected target stringify failure');return stringify.call(this,value,...args);});
    if(mode==='hash')mock=t.mock.method(crypto.Hash.prototype,'update',function(value,...args){if(typeof value==='string'&&value.startsWith('{"id":'+stringify(id)))throw Error('injected target hash failure');return update.call(this,value,...args);});
    try{assert.throws(()=>store.openConversation(id),mode==='deep-json'?/stack/i:/injected target/);}finally{mock?.mock.restore();}
    assert.equal(store.data.activeConversationId,previous.id,mode);assert.equal(store.data.threadId,previous.threadId,mode);assert.equal(store.data.messages,previous.messages,mode);assert.deepEqual(store.data.settings,previous.settings,mode);assert.equal(store.snapshot,previous.snapshot,mode);assert.deepEqual(store.data.conversations,previous.conversations,mode);assert.equal(store.writeBlocked,false,mode);
    assert.deepEqual(fs.readFileSync(store.file),state,mode);assert.deepEqual(fs.readFileSync(file),history,mode);
  }
});

test('startup history preparation failures block writes and preserve pending deletion recovery',async t=>{
  for(const mode of ['deep-json','stringify','hash']){
    const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-startup-preparation-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const store=new Store(root,{demo:true});store.data.messages=[{id:'target',role:'user',text:'target',status:'completed',createdAt:1700000000000}];store.save();const id=store.data.activeConversationId,file=path.join(store.historyDirectory,id+'.json');
    store.beginDeletion(id);fs.writeFileSync(store.deleteFile,JSON.stringify({...store.pendingDeletion,phase:'cli-deleted'}));
    if(mode==='deep-json')fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('"text":"target"','"text":"target","error":'+'['.repeat(15000)+'0'+']'.repeat(15000)));
    const state=fs.readFileSync(store.file),history=fs.readFileSync(file),journal=fs.readFileSync(store.deleteFile),stringify=JSON.stringify,update=crypto.Hash.prototype.update;let mock,loaded;
    if(mode==='stringify')mock=t.mock.method(JSON,'stringify',function(value,...args){if(value?.id===id&&Array.isArray(value.messages))throw Error('injected startup stringify failure');return stringify.call(this,value,...args);});
    if(mode==='hash')mock=t.mock.method(crypto.Hash.prototype,'update',function(value,...args){if(typeof value==='string'&&value.startsWith('{"id":'+stringify(id)))throw Error('injected startup hash failure');return update.call(this,value,...args);});
    try{loaded=new Store(root,{});}finally{mock?.mock.restore();}
    assert.equal(loaded.writeBlocked,true,mode);assert.ok(loaded.warning,mode);assert.equal(loaded.data.activeConversationId,null,mode);assert.deepEqual(loaded.data.messages,[],mode);assert.throws(()=>loaded.save(),/복구/);await assert.rejects(loaded.saveAsync(),/복구/);assert.equal(loaded.worker,null,mode);
    assert.deepEqual(fs.readFileSync(store.file),state,mode);assert.deepEqual(fs.readFileSync(file),history,mode);assert.deepEqual(fs.readFileSync(store.deleteFile),journal,mode);
  }
});

test('worker startup cannot overwrite history after a post-read serialization failure',async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-worker-preparation-'))),store=new Store(root,{demo:true});t.after(async()=>{await store.closeWorker();fs.rmSync(root,{recursive:true,force:true});});
  store.data.messages=[{id:'target',role:'user',text:'target',status:'completed',createdAt:1700000000000}];store.save();const file=path.join(store.historyDirectory,store.data.activeConversationId+'.json'),state=fs.readFileSync(store.file);
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('"text":"target"','"text":"target","error":'+'['.repeat(100000)+'0'+']'.repeat(100000)));const history=fs.readFileSync(file);store.data.messages[0].text='new main data';
  await assert.rejects(store.saveAsync(),/복구/);assert.equal(store.writeBlocked,true);assert.equal(store.saving,null);await assert.rejects(store.saveAsync(),/복구/);assert.deepEqual(fs.readFileSync(file),history);assert.deepEqual(fs.readFileSync(store.file),state);
});

test('reopening the active conversation preserves dirty messages and the worker fingerprint',async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-reopen-dirty-'))),store=new Store(root,{demo:true});t.after(async()=>{await store.closeWorker();fs.rmSync(root,{recursive:true,force:true});});
  store.data.threadId='original-thread';store.data.messages=[{id:'target',role:'user',text:'old',status:'completed',createdAt:1700000000000}];store.save();const id=store.data.activeConversationId,file=path.join(store.historyDirectory,id+'.json');
  store.data.messages[0].text='new unsaved';store.data.threadId='new-thread';store.openConversation(id);
  assert.equal(store.data.messages[0].text,'new unsaved');assert.equal(store.data.threadId,'new-thread');assert.equal(JSON.parse(fs.readFileSync(file)).messages[0].text,'new unsaved');assert.equal(JSON.parse(fs.readFileSync(file)).threadId,'new-thread');assert.equal(store.snapshot,new Store(root,{}).snapshot);
  store.data.messages.push({id:'next',role:'user',text:'next',status:'completed',createdAt:1700000000001});await store.saveAsync();assert.equal(JSON.parse(fs.readFileSync(file)).messages[0].text,'new unsaved');assert.equal(new Store(root,{}).data.messages[0].text,'new unsaved');
});

test('failed v1 migration blocks later writes while preserving legacy input',async t=>{
  for(const mode of ['deep-json','precommit-write']){
    const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-v1-migration-failure-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'state.json');
    let legacy='{"version":1,"settings":{"demo":true},"threadId":"legacy-thread","messages":[{"id":"legacy","role":"user","text":"preserve legacy","status":"completed","createdAt":1700000000000}]}';
    if(mode==='deep-json')legacy=legacy.replace('"text":"preserve legacy"','"text":"preserve legacy","error":'+'['.repeat(15000)+'0'+']'.repeat(15000));fs.writeFileSync(file,legacy);const bytes=fs.readFileSync(file),write=fs.writeFileSync;let mock,loaded;
    if(mode==='precommit-write')mock=t.mock.method(fs,'writeFileSync',(target,...args)=>{if(target===file+'.tmp')throw Object.assign(Error('injected migration ENOSPC'),{code:'ENOSPC'});return write(target,...args);});
    try{loaded=new Store(root,{});}finally{mock?.mock.restore();}
    assert.equal(loaded.writeBlocked,true,mode);assert.ok(loaded.warning,mode);assert.throws(()=>loaded.save(),/복구/);await assert.rejects(loaded.saveAsync(),/복구/);assert.equal(loaded.worker,null,mode);assert.deepEqual(fs.readFileSync(file),bytes,mode);
    const backups=fs.readdirSync(root).filter(name=>name.startsWith('state.json.backup-v1-'));assert.equal(backups.length,1,mode);assert.deepEqual(fs.readFileSync(path.join(root,backups[0])),bytes,mode);
  }
});
