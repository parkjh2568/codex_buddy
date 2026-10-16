const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {Store}=require('../src/store.cjs'),{StorageMaintenance}=require('../src/storage-maintenance.cjs');

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-maintenance-')),store=new Store(root,{demo:true});
  t.after(async()=>{await store.closeWorker();fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(path.join(root,'attachments'));fs.mkdirSync(path.join(root,'response-images'));
  const cache=[];for(const text of ['shared','orphan-one','orphan-two']){const bytes=Buffer.from(text),hash=createHash('sha256').update(bytes).digest('hex'),file=path.join(root,'attachments',hash+'.txt');fs.writeFileSync(file,bytes);cache.push({hash,file,bytes:bytes.length});}
  store.data.messages=[{id:'user',role:'user',text:'preserve',status:'completed',attachments:[{id:'11111111-1111-4111-8111-111111111111',kind:'file',name:'shared.txt',hash:cache[0].hash,bytes:cache[0].bytes,extension:'.txt'}]}];store.save();
  return{root,store,cache,maintenance:new StorageMaintenance(root),options:()=>({conversations:store.data.conversations,messages:store.data.messages})};
}

test('storage preview protects inactive conversations, pending drafts, shared hashes and user files',async t=>{
  const h=fixture(t);h.store.newConversation();
  const unknown=path.join(h.root,'attachments','notes.txt');fs.writeFileSync(unknown,'external');
  fs.writeFileSync(h.cache[2].file,'user-modified');
  const preview=await h.maintenance.inspect({...h.options(),extraMessages:[{attachments:[{hash:h.cache[1].hash,kind:'file'}]}]});
  assert.equal(preview.blocked,false);assert.equal(preview.items.filter(item=>item.eligible).length,0);
  assert.match(preview.items.find(item=>item.name.endsWith(h.cache[0].hash+'.txt')).reason,/참조/);
  assert.equal(fs.readFileSync(unknown,'utf8'),'external');assert.equal(fs.readFileSync(h.cache[2].file,'utf8'),'user-modified');
});

test('corrupt, missing and unregistered history references conservatively block cache cleanup',async t=>{
  const h=fixture(t),file=path.join(h.store.historyDirectory,h.store.data.activeConversationId+'.json');
  for(const contents of ['{',JSON.stringify({id:h.store.data.activeConversationId,source:'onggi_bot',messages:[{images:[{status:'ready',id:['invalid'],previewId:'a'.repeat(64)}]}]})]){
    fs.writeFileSync(file,contents);const preview=await h.maintenance.inspect(h.options());assert.equal(preview.blocked,true);assert.ok(preview.items.every(item=>!item.eligible));
  }
  fs.unlinkSync(file);assert.equal((await h.maintenance.inspect(h.options())).blocked,true);
  fs.writeFileSync(path.join(h.store.historyDirectory,'unregistered.json'),'{}');assert.equal((await h.maintenance.inspect(h.options())).blocked,true);
});

test('stale cleanup previews reject replaced cache bytes and newly referenced files',async t=>{
  const h=fixture(t);let preview=await h.maintenance.inspect(h.options()),candidate=preview.items.find(item=>item.name.endsWith(h.cache[1].hash+'.txt'));
  fs.writeFileSync(h.cache[1].file,'modified');await assert.rejects(h.maintenance.quarantine({token:preview.token,ids:[candidate.id]},h.options(),()=>true),/참조나 파일/);
  assert.equal(fs.readFileSync(h.cache[1].file,'utf8'),'modified');
  preview=await h.maintenance.inspect(h.options());candidate=preview.items.find(item=>item.name.endsWith(h.cache[2].hash+'.txt'));
  h.store.data.messages[0].attachments.push({hash:h.cache[2].hash,kind:'file',extension:'.txt'});
  await assert.rejects(h.maintenance.quarantine({token:preview.token,ids:[candidate.id]},h.options(),()=>true),/참조나 파일/);assert.ok(fs.existsSync(h.cache[2].file));
});

test('selected unreferenced caches move to a recoverable batch and restore without overwriting files',async t=>{
  const h=fixture(t),preview=await h.maintenance.inspect(h.options()),selected=preview.items.filter(item=>item.eligible);
  const result=await h.maintenance.quarantine({token:preview.token,ids:selected.map(item=>item.id)},h.options(),()=>true);
  assert.equal(result.partial,false);assert.equal(result.moved.length,2);assert.ok(fs.existsSync(h.cache[0].file));assert.equal(fs.existsSync(h.cache[1].file),false);
  fs.writeFileSync(h.cache[1].file,'external replacement');
  const restored=await h.maintenance.restore(result.batch,()=>true);assert.equal(restored.restored.length,1);assert.equal(restored.warnings.length,1);
  assert.equal(fs.readFileSync(h.cache[1].file,'utf8'),'external replacement');assert.equal(fs.readFileSync(h.cache[2].file,'utf8'),'orphan-two');
  assert.ok(fs.existsSync(path.join(h.root,'cache-quarantine',result.batch,'attachments',path.basename(h.cache[1].file))));
});

test('cleanup interruption preserves a recoverable partial batch and untouched remaining files',async t=>{
  const h=fixture(t),preview=await h.maintenance.inspect(h.options());let checks=0;
  const result=await h.maintenance.quarantine({token:preview.token,ids:preview.items.filter(item=>item.eligible).map(item=>item.id)},h.options(),()=>++checks<3);
  assert.equal(result.partial,true);assert.equal(result.moved.length,1);assert.equal(result.warnings.length,1);
  const restored=await h.maintenance.restore(result.batch,()=>true);assert.equal(restored.restored.length,1);assert.ok(h.cache.every(item=>fs.existsSync(item.file)));
});

test('a history change after reinspection prevents the first cache move',async t=>{
  const h=fixture(t),preview=await h.maintenance.inspect(h.options());let changed=false;
  const result=await h.maintenance.quarantine({token:preview.token,ids:[preview.items.find(item=>item.eligible).id]},h.options(),()=>{if(!changed){changed=true;fs.appendFileSync(path.join(h.store.historyDirectory,h.store.data.activeConversationId+'.json'),' ');}return true;});
  assert.equal(result.partial,true);assert.equal(result.moved.length,0);assert.ok(h.cache.every(item=>fs.existsSync(item.file)));
});

test('storage root links and tampered restore paths cannot reach external files',async t=>{
  const h=fixture(t),preview=await h.maintenance.inspect(h.options()),result=await h.maintenance.quarantine({token:preview.token,ids:[preview.items.find(item=>item.eligible).id]},h.options(),()=>true);
  const manifest=path.join(h.root,'cache-quarantine',result.batch,'manifest.json'),data=JSON.parse(fs.readFileSync(manifest));data.items[0].relative='../external';fs.writeFileSync(manifest,JSON.stringify(data));
  await assert.rejects(h.maintenance.restore(result.batch,()=>true),/범위/);
  const original=h.root+'-original';fs.renameSync(h.root,original);fs.symlinkSync(original,h.root);t.after(()=>fs.rmSync(original,{recursive:true,force:true}));
  await assert.rejects(h.maintenance.inspect(h.options()),/변경/);
});

test('restore observes cache quotas and preserves its backup when interrupted',async t=>{
  const h=fixture(t),preview=await h.maintenance.inspect(h.options()),result=await h.maintenance.quarantine({token:preview.token,ids:preview.items.filter(item=>item.eligible).map(item=>item.id)},h.options(),()=>true);
  const full=path.join(h.root,'attachments','external-large.bin'),descriptor=fs.openSync(full,'wx');fs.ftruncateSync(descriptor,512*1024*1024);fs.closeSync(descriptor);
  const limited=await h.maintenance.restore(result.batch,()=>true);assert.equal(limited.restored.length,0);assert.ok(limited.warnings.every(message=>message.includes('512MiB')));assert.equal(fs.statSync(full).size,512*1024*1024);
  fs.unlinkSync(full);let calls=0;const partial=await h.maintenance.restore(result.batch,()=>++calls===1);assert.equal(partial.restored.length,1);assert.equal(partial.warnings.length,1);
  const folder=path.join(h.root,'cache-quarantine',result.batch,'attachments');assert.equal(fs.readdirSync(folder).length,2);
});

test('canceling an inspection invalidates its preview and keeps every original cache',async t=>{
  const h=fixture(t);await h.maintenance.inspect(h.options());
  await assert.rejects(h.maintenance.inspect({...h.options(),isCurrent:()=>false}),/중단/);
  assert.equal(h.maintenance.preview,null);assert.ok(h.cache.every(item=>fs.existsSync(item.file)));
});

test('a cache growing after the final path stat stays at its original path',async t=>{
  const h=fixture(t),preview=await h.maintenance.inspect(h.options()),selected=preview.items.find(item=>item.name.endsWith(h.cache[1].hash+'.txt')),canonical=fs.realpathSync(h.cache[1].file),open=fs.openSync;let changed=false;
  fs.openSync=function(file,...args){if(file===canonical&&!changed){changed=true;fs.appendFileSync(file,'_EXTERNAL_APPEND');}return open.call(this,file,...args);};
  try{const result=await h.maintenance.quarantine({token:preview.token,ids:[selected.id]},h.options(),()=>true);assert.equal(changed,true);assert.equal(result.partial,true);assert.equal(result.moved.length,0);assert.equal(fs.readFileSync(h.cache[1].file,'utf8'),'orphan-one_EXTERNAL_APPEND');}
  finally{fs.openSync=open;}
});
