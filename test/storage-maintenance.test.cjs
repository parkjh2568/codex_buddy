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
  fs.unlinkSync(full);let calls=0;const partial=await h.maintenance.restore(result.batch,()=>++calls<=2);assert.equal(partial.restored.length,1);assert.equal(partial.warnings.length,1);
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

test('restore failures never expose partial destination files and a fresh instance can retry',async t=>{
  for(const failure of ['partial-write','sync','close','link']){
    const h=fixture(t),preview=await h.maintenance.inspect(h.options()),selected=preview.items.find(item=>item.name.endsWith(h.cache[1].hash+'.txt')),batch=await h.maintenance.quarantine({token:preview.token,ids:[selected.id]},h.options(),()=>true),open=fs.openSync,write=fs.writeFileSync,sync=fs.fsyncSync,close=fs.closeSync,link=fs.linkSync;let descriptor,failed=false;
    const opened=t.mock.method(fs,'openSync',(file,...args)=>{const fd=open(file,...args);if(typeof file==='string'&&path.basename(file).startsWith('.restore-')&&args[0]&fs.constants.O_CREAT)descriptor=fd;return fd;});
    const written=t.mock.method(fs,'writeFileSync',(file,bytes,...args)=>{if(file===descriptor&&failure==='partial-write'&&!failed){failed=true;write(file,bytes.subarray(0,5));throw Object.assign(Error('injected ENOSPC'),{code:'ENOSPC'});}return write(file,bytes,...args);});
    const synced=t.mock.method(fs,'fsyncSync',fd=>{if(fd===descriptor&&failure==='sync'){failed=true;throw Error('injected sync');}return sync(fd);});
    const closed=t.mock.method(fs,'closeSync',fd=>{const result=close(fd);if(fd===descriptor&&failure==='close'&&!failed){failed=true;throw Error('injected close');}return result;});
    const linked=t.mock.method(fs,'linkSync',(source,destination)=>{if(failure==='link'){failed=true;throw Object.assign(Error('unsupported link'),{code:'ENOTSUP'});}return link(source,destination);});
    let result;try{result=await h.maintenance.restore(batch.batch,()=>true);}finally{for(const mock of [opened,written,synced,closed,linked])mock.mock.restore();}
    assert.equal(failed,true,failure);assert.equal(result.restored.length,0,failure);assert.equal(result.warnings.length,1,failure);assert.equal(fs.existsSync(h.cache[1].file),false,failure);assert.equal(fs.readdirSync(path.join(h.root,'cache-quarantine',batch.batch)).some(name=>name.startsWith('.restore-')),false,failure);
    const backup=path.join(h.root,'cache-quarantine',batch.batch,'attachments',path.basename(h.cache[1].file));assert.equal(fs.readFileSync(backup,'utf8'),'orphan-one');assert.throws(()=>fs.fstatSync(descriptor),/EBADF/);
    const retried=await new StorageMaintenance(h.root).restore(batch.batch,()=>true);assert.equal(retried.restored.length,1,failure);assert.equal(fs.readFileSync(h.cache[1].file,'utf8'),'orphan-one');assert.equal(fs.readFileSync(backup,'utf8'),'orphan-one');
  }
});

test('restore does not overwrite a file created immediately before the atomic commit',async t=>{
  const h=fixture(t),preview=await h.maintenance.inspect(h.options()),batch=await h.maintenance.quarantine({token:preview.token,ids:[preview.items.find(item=>item.name.endsWith(h.cache[1].hash+'.txt')).id]},h.options(),()=>true),link=fs.linkSync;
  const linked=t.mock.method(fs,'linkSync',(source,destination)=>{fs.writeFileSync(destination,'external replacement',{flag:'wx'});return link(source,destination);});
  let result;try{result=await h.maintenance.restore(batch.batch,()=>true);}finally{linked.mock.restore();}
  assert.equal(result.restored.length,0);assert.match(result.warnings[0],/이미 있는 파일/);assert.equal(fs.readFileSync(h.cache[1].file,'utf8'),'external replacement');assert.equal(fs.readFileSync(path.join(h.root,'cache-quarantine',batch.batch,'attachments',path.basename(h.cache[1].file)),'utf8'),'orphan-one');
});

test('restore preserves an unowned file that occupies the exclusive staging name',async t=>{
  const h=fixture(t),preview=await h.maintenance.inspect(h.options()),batch=await h.maintenance.quarantine({token:preview.token,ids:[preview.items.find(item=>item.name.endsWith(h.cache[1].hash+'.txt')).id]},h.options(),()=>true),open=fs.openSync;let temporary;
  const opened=t.mock.method(fs,'openSync',(file,...args)=>{if(typeof file==='string'&&path.basename(file).startsWith('.restore-')&&args[0]&fs.constants.O_CREAT){temporary=file;fs.writeFileSync(file,'external collision',{flag:'wx'});}return open(file,...args);});let result;
  try{result=await h.maintenance.restore(batch.batch,()=>true);}finally{opened.mock.restore();}
  assert.equal(result.restored.length,0);assert.equal(fs.existsSync(h.cache[1].file),false);assert.equal(fs.readFileSync(temporary,'utf8'),'external collision');assert.ok(result.warnings.some(message=>message.includes('교체된 임시')));
});

test('restore preserves same-inode external edits to its staging file',async t=>{
  const h=fixture(t),preview=await h.maintenance.inspect(h.options()),batch=await h.maintenance.quarantine({token:preview.token,ids:[preview.items.find(item=>item.name.endsWith(h.cache[1].hash+'.txt')).id]},h.options(),()=>true),open=fs.openSync,sync=fs.fsyncSync;let temporary,descriptor;
  const opened=t.mock.method(fs,'openSync',(file,...args)=>{const fd=open(file,...args);if(typeof file==='string'&&path.basename(file).startsWith('.restore-')&&args[0]&fs.constants.O_CREAT){temporary=file;descriptor=fd;}return fd;});
  const synced=t.mock.method(fs,'fsyncSync',fd=>{const result=sync(fd);if(fd===descriptor)fs.writeFileSync(temporary,'changed!!!');return result;});let result;
  try{result=await h.maintenance.restore(batch.batch,()=>true);}finally{opened.mock.restore();synced.mock.restore();}
  assert.equal(result.restored.length,0);assert.equal(fs.existsSync(h.cache[1].file),false);assert.equal(fs.readFileSync(temporary,'utf8'),'changed!!!');assert.ok(result.warnings.some(message=>message.includes('수정된 임시')));assert.equal(fs.readFileSync(path.join(h.root,'cache-quarantine',batch.batch,'attachments',path.basename(h.cache[1].file)),'utf8'),'orphan-one');
});

test('restore cancellation after staging removes only the private temporary and leaves no final file',async t=>{
  const h=fixture(t),preview=await h.maintenance.inspect(h.options()),batch=await h.maintenance.quarantine({token:preview.token,ids:[preview.items.find(item=>item.name.endsWith(h.cache[1].hash+'.txt')).id]},h.options(),()=>true);let checks=0;
  const result=await h.maintenance.restore(batch.batch,()=>++checks===1);assert.equal(result.restored.length,0);assert.match(result.warnings[0],/작업 상태/);assert.equal(fs.existsSync(h.cache[1].file),false);assert.equal(fs.readdirSync(path.join(h.root,'cache-quarantine',batch.batch)).some(name=>name.startsWith('.restore-')),false);
});

test('successful restore remains successful when temporary cleanup fails and restart preserves the orphan',async t=>{
  const h=fixture(t),preview=await h.maintenance.inspect(h.options()),batch=await h.maintenance.quarantine({token:preview.token,ids:[preview.items.find(item=>item.name.endsWith(h.cache[1].hash+'.txt')).id]},h.options(),()=>true),unlink=fs.unlinkSync;
  const removed=t.mock.method(fs,'unlinkSync',file=>{if(path.basename(file).startsWith('.restore-'))throw Error('injected cleanup');return unlink(file);});let result;
  try{result=await h.maintenance.restore(batch.batch,()=>true);}finally{removed.mock.restore();}
  assert.equal(result.restored.length,1);assert.match(result.warnings[0],/정리가 필요/);assert.equal(fs.readFileSync(h.cache[1].file,'utf8'),'orphan-one');
  const folder=path.join(h.root,'cache-quarantine',batch.batch),temporary=fs.readdirSync(folder).find(name=>name.startsWith('.restore-'));assert.ok(temporary);
  const inspected=await h.maintenance.inspect(h.options());assert.equal(inspected.blocked,false);
  const retried=await new StorageMaintenance(h.root).restore(batch.batch,()=>true);assert.equal(retried.restored.length,0);assert.ok(retried.warnings.some(message=>message.includes('이전 복구')));assert.equal(fs.existsSync(path.join(folder,temporary)),true);assert.equal(fs.readFileSync(h.cache[1].file,'utf8'),'orphan-one');
});

test('restore keeps externally replaced temporary files and counts crash leftovers against the byte quota',async t=>{
  const h=fixture(t),preview=await h.maintenance.inspect(h.options()),batch=await h.maintenance.quarantine({token:preview.token,ids:[preview.items.find(item=>item.name.endsWith(h.cache[1].hash+'.txt')).id]},h.options(),()=>true),link=fs.linkSync;let temporary;
  const linked=t.mock.method(fs,'linkSync',(source,destination)=>{temporary=source;fs.unlinkSync(source);fs.writeFileSync(source,'external temporary',{flag:'wx'});return link(source,destination);});let result;
  try{result=await h.maintenance.restore(batch.batch,()=>true);}finally{linked.mock.restore();}
  assert.equal(result.restored.length,0);assert.ok(result.warnings.some(message=>message.includes('확정 중')));assert.ok(result.warnings.some(message=>message.includes('교체된 임시')));assert.equal(fs.readFileSync(temporary,'utf8'),'external temporary');
  // The replacement happens outside the final identity check and models an untrusted concurrent writer.
  assert.equal(fs.readFileSync(h.cache[1].file,'utf8'),'external temporary');fs.unlinkSync(h.cache[1].file);
  const descriptor=fs.openSync(temporary,'r+');fs.ftruncateSync(descriptor,512*1024*1024);fs.closeSync(descriptor);
  const retried=await new StorageMaintenance(h.root).restore(batch.batch,()=>true);assert.equal(retried.restored.length,0);assert.ok(retried.warnings.some(message=>message.includes('512MiB')));assert.equal(fs.existsSync(h.cache[1].file),false);assert.equal(fs.statSync(temporary).size,512*1024*1024);
});

test('restore survives real process exit during write, before commit and immediately after commit',async t=>{
  const {spawnSync}=require('node:child_process'),script=`const fs=require('node:fs'),path=require('node:path'),{StorageMaintenance}=require(process.argv[1]);const [root,batch,stage]=process.argv.slice(2),open=fs.openSync,write=fs.writeFileSync,sync=fs.fsyncSync,link=fs.linkSync;let descriptor;fs.openSync=function(file,...args){const fd=open(file,...args);if(typeof file==='string'&&path.basename(file).startsWith('.restore-')&&args[0]&fs.constants.O_CREAT)descriptor=fd;return fd;};fs.writeFileSync=function(file,bytes,...args){if(file===descriptor&&stage==='partial'){write(file,bytes.subarray(0,5));process.exit(43);}return write(file,bytes,...args);};fs.fsyncSync=function(fd){const result=sync(fd);if(fd===descriptor&&stage==='prepared')process.exit(43);return result;};fs.linkSync=function(source,destination){const result=link(source,destination);if(stage==='committed')process.exit(43);return result;};new StorageMaintenance(root).restore(batch,()=>true).then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});`;
  for(const stage of ['partial','prepared','committed']){
    const h=fixture(t),preview=await h.maintenance.inspect(h.options()),batch=await h.maintenance.quarantine({token:preview.token,ids:[preview.items.find(item=>item.name.endsWith(h.cache[1].hash+'.txt')).id]},h.options(),()=>true),child=spawnSync(process.execPath,['-e',script,path.join(__dirname,'../src/storage-maintenance.cjs'),h.root,batch.batch,stage],{encoding:'utf8',timeout:10000});
    assert.equal(child.status,43,child.stderr);assert.equal(fs.existsSync(h.cache[1].file),stage==='committed');
    const folder=path.join(h.root,'cache-quarantine',batch.batch),orphan=path.join(folder,fs.readdirSync(folder).find(name=>name.startsWith('.restore-'))),leftover=fs.readFileSync(orphan);assert.equal(leftover.toString(),stage==='partial'?'orpha':'orphan-one');
    const restarted=await new StorageMaintenance(h.root).restore(batch.batch,()=>true);assert.equal(restarted.restored.length,stage==='committed'?0:1);assert.ok(restarted.warnings.some(message=>message.includes('이전 복구')));assert.equal(fs.readFileSync(h.cache[1].file,'utf8'),'orphan-one');assert.ok(fs.readFileSync(orphan).equals(leftover));assert.equal(fs.readFileSync(path.join(folder,'attachments',path.basename(h.cache[1].file)),'utf8'),'orphan-one');
  }
});

test('restore caps preserved staging files instead of accumulating unbounded retry leftovers',async t=>{
  const h=fixture(t),preview=await h.maintenance.inspect(h.options()),batch=await h.maintenance.quarantine({token:preview.token,ids:[preview.items.find(item=>item.name.endsWith(h.cache[1].hash+'.txt')).id]},h.options(),()=>true),folder=path.join(h.root,'cache-quarantine',batch.batch);
  for(let index=0;index<128;index++)fs.writeFileSync(path.join(folder,'.restore-attachments-'+String(index).padStart(36,'0')+'.tmp'),'');
  const result=await h.maintenance.restore(batch.batch,()=>true);assert.equal(result.restored.length,0);assert.ok(result.warnings.some(message=>message.includes('수 한도')));assert.equal(fs.existsSync(h.cache[1].file),false);assert.equal(fs.readdirSync(folder).filter(name=>name.startsWith('.restore-')).length,128);
  fs.writeFileSync(path.join(folder,'.restore-attachments-'+String(128).padStart(36,'0')+'.tmp'),'');await assert.rejects(h.maintenance.restore(batch.batch,()=>true),/임시 파일이 많아요/);
});

test('restore never grows a cache beyond the existing file-count limit',async t=>{
  const h=fixture(t),preview=await h.maintenance.inspect(h.options()),batch=await h.maintenance.quarantine({token:preview.token,ids:preview.items.filter(item=>item.eligible).map(item=>item.id)},h.options(),()=>true),directory=path.join(h.root,'attachments');
  for(let index=0;index<9998;index++)fs.writeFileSync(path.join(directory,'external-'+index+'.txt'),'');
  const result=await h.maintenance.restore(batch.batch,()=>true);assert.equal(result.restored.length,1);assert.ok(result.warnings.some(message=>message.includes('파일 수 한도')));assert.equal(fs.readdirSync(directory).length,10000);assert.equal(fs.readdirSync(path.join(h.root,'cache-quarantine',batch.batch,'attachments')).length,2);
});

test('incremental history reference checks retain earlier hashes and enforce the combined message bound',async t=>{
  const h=fixture(t),{randomUUID}=require('node:crypto'),first=h.store.data.activeConversationId,second=randomUUID(),file=path.join(h.store.historyDirectory,first+'.json'),nextFile=path.join(h.store.historyDirectory,second+'.json');
  const messages=Array.from({length:25000},()=>({}));messages[0]={attachments:[{kind:'file',hash:h.cache[0].hash}]};fs.writeFileSync(file,JSON.stringify({id:first,source:'onggi_bot',messages}));
  const other=Array.from({length:25000},()=>({}));other[0]={attachments:[{kind:'file',hash:h.cache[1].hash}]};fs.writeFileSync(nextFile,JSON.stringify({id:second,source:'onggi_bot',messages:other}));
  const options={conversations:[{id:first},{id:second}],messages:[]},preview=await h.maintenance.inspect(options);assert.equal(preview.blocked,false);assert.equal(preview.items.find(item=>item.name.endsWith(h.cache[0].hash+'.txt')).eligible,false);assert.equal(preview.items.find(item=>item.name.endsWith(h.cache[1].hash+'.txt')).eligible,false);assert.equal(preview.items.find(item=>item.name.endsWith(h.cache[2].hash+'.txt')).eligible,true);
  other.push({});fs.writeFileSync(nextFile,JSON.stringify({id:second,source:'onggi_bot',messages:other}));const blocked=await h.maintenance.inspect(options);assert.equal(blocked.blocked,true);assert.ok(blocked.items.every(item=>!item.eligible));
});
