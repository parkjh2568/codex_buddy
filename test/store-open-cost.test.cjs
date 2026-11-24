const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {Store}=require('../src/store.cjs');

test('opening canonical v2 history avoids a second target serialization while preserving disk, metadata and worker saves',async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-open-cost-'))),store=new Store(root,{demo:true,workspace:'/target',model:'chosen',effort:'high'});t.after(async()=>{await store.closeWorker();fs.rmSync(root,{recursive:true,force:true});});
  store.data.threadId='target-thread';store.data.messages=[{id:'target',role:'user',text:'한글 **원문** '.repeat(4096),status:'completed',createdAt:1700000000000}];store.save();
  const target=store.data.activeConversationId,file=path.join(store.historyDirectory,target+'.json');store.data.conversations[0].title='수동 제목';store.data.conversations[0].titleSource='manual';store.data.conversations[0].pinned=true;store.save({includeHistory:false});
  const bytes=fs.readFileSync(file),metadata={...store.data.conversations[0]},stat=fs.statSync(file);store.newConversation();store.data.settings.workspace='/previous';store.data.messages=[{id:'previous',role:'user',text:'previous',status:'completed',createdAt:1700000000001}];store.save();const previous=store.data.activeConversationId;
  const stringify=JSON.stringify;let targetSerializations=0;
  const mock=t.mock.method(JSON,'stringify',function(value,...args){if(value?.id===target&&value.source==='onggi_bot'&&Array.isArray(value.messages))targetSerializations++;return stringify.call(this,value,...args);});
  try{store.openConversation(target);}finally{mock.mock.restore();}
  assert.equal(targetSerializations,1,'target payload is already serialized to compute its fingerprint');
  assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(fs.statSync(file).mtimeMs,stat.mtimeMs);assert.deepEqual(store.data.conversations.find(item=>item.id===target),metadata);assert.equal(store.data.activeConversationId,target);assert.equal(store.data.threadId,'target-thread');assert.equal(store.data.settings.workspace,'/target');assert.equal(store.data.settings.model,'chosen');assert.equal(store.data.settings.effort,'high');assert.equal(store.snapshot,createHash('sha256').update(JSON.stringify(store.readHistory(target))).digest('hex'));
  assert.equal(store.readHistory(previous).messages[0].text,'previous');await store.saveAsync();const reopened=new Store(root,{});assert.equal(reopened.data.activeConversationId,target);assert.equal(reopened.data.messages[0].text,store.data.messages[0].text);assert.equal(reopened.data.conversations.find(item=>item.id===target).title,'수동 제목');
  store.openConversation(target);assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(store.data.activeConversationId,target);
});

for(const mode of ['reordered','extra','missing-thread','invalid-thread'])test(`opening ${mode} history retains canonical rewrite and journal recovery`,t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-open-shape-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root,{demo:true});store.data.threadId='target-thread';store.data.messages=[{id:'target',role:'user',text:'preserve',status:'completed',createdAt:1700000000000}];store.save();
  const id=store.data.activeConversationId,file=path.join(store.historyDirectory,id+'.json'),saved=JSON.parse(fs.readFileSync(file));store.newConversation();
  if(mode==='reordered'){fs.writeFileSync(file,JSON.stringify({messages:saved.messages,threadId:saved.threadId,source:saved.source,id}));}else{if(mode==='extra')saved.extra='old metadata';if(mode==='missing-thread')delete saved.threadId;if(mode==='invalid-thread')saved.threadId=42;fs.writeFileSync(file,JSON.stringify(saved));}
  const rename=fs.renameSync;let journalSeen=false;
  const mock=t.mock.method(fs,'renameSync',(from,to)=>{if(to===file){assert.equal(fs.existsSync(store.journalFile),true);journalSeen=true;}return rename(from,to);});
  try{store.openConversation(id);}finally{mock.mock.restore();}
  const disk=JSON.parse(fs.readFileSync(file));assert.equal(journalSeen,true);assert.deepEqual(Object.keys(disk),['id','source','threadId','messages']);assert.equal(disk.threadId,['missing-thread','invalid-thread'].includes(mode)?null:'target-thread');assert.equal(disk.messages[0].text,'preserve');assert.equal(fs.existsSync(store.journalFile),false);assert.equal(new Store(root,{}).data.activeConversationId,id);
});

test('opening a canonical history whose normalized payload exceeds 32MiB still rejects and retains the prior active state',t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-open-limit-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root,{demo:true});store.data.messages=[{id:'large',role:'user',text:'small',status:'completed',createdAt:1700000000000}];store.save();const target=store.data.activeConversationId,file=path.join(store.historyDirectory,target+'.json');
  store.newConversation();store.data.messages=[{id:'current',role:'user',text:'current',status:'completed',createdAt:1700000000001}];store.save();const previous=store.data.activeConversationId,settings={...store.data.settings};
  const history={id:target,source:'onggi_bot',threadId:null,messages:[{id:'large',role:'user',text:''}]};history.messages[0].text='x'.repeat(32*1024*1024-Buffer.byteLength(JSON.stringify(history)));const bytes=Buffer.from(JSON.stringify(history));assert.equal(bytes.length,32*1024*1024);fs.writeFileSync(file,bytes);
  assert.throws(()=>store.openConversation(target),/32MiB/);assert.equal(store.data.activeConversationId,previous);assert.equal(store.data.messages[0].text,'current');assert.deepEqual(store.data.settings,settings);assert.equal(JSON.parse(fs.readFileSync(store.file)).activeConversationId,previous);assert.deepEqual(fs.readFileSync(file),bytes);
});

test('state-only open failure retains previous memory and disk without rewriting the target',t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-open-rollback-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root,{demo:true});store.data.messages=[{id:'target',role:'user',text:'target',status:'completed',createdAt:1700000000000}];store.save();const target=store.data.activeConversationId,file=path.join(store.historyDirectory,target+'.json'),bytes=fs.readFileSync(file);
  store.newConversation();store.data.messages=[{id:'current',role:'user',text:'current',status:'completed',createdAt:1700000000001}];store.save();const previous=store.data.activeConversationId,snapshot=store.snapshot,rename=fs.renameSync;let commits=0;
  const mock=t.mock.method(fs,'renameSync',(from,to)=>{if(to===store.file&&++commits===2)throw Error('injected active state failure');return rename(from,to);});
  try{assert.throws(()=>store.openConversation(target),/active state failure/);}finally{mock.mock.restore();}
  assert.equal(store.data.activeConversationId,previous);assert.equal(store.data.messages[0].text,'current');assert.equal(store.snapshot,snapshot);assert.equal(JSON.parse(fs.readFileSync(store.file)).activeConversationId,previous);assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(store.writeBlocked,false);
});
