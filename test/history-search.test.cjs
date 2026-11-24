const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Worker}=require('node:worker_threads'),{once}=require('node:events');
const id='11111111-1111-4111-8111-111111111111';

function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-history-search-'))),directory=path.join(root,'conversations');fs.mkdirSync(directory);
  const worker=new Worker(path.join(__dirname,'../src/history-search-worker.cjs'),{workerData:{historyDirectory:directory}});
  t.after(async()=>{await worker.terminate();fs.rmSync(root,{recursive:true,force:true});});return{root,directory,worker,file:path.join(directory,id+'.json')};
}
async function request(worker,message){const result=once(worker,'message');worker.postMessage({id,query:'needle',remainingBytes:32*1024*1024,...message});return(await result)[0];}

test('history search returns exact byte charges and the first sanitized snippet without changing any files',async t=>{
  const h=fixture(t),text='prefix '.repeat(8)+'NeEdLe\n\t and text '.repeat(20),raw=JSON.stringify({id,source:'onggi_bot',messages:[{id:'first',role:'assistant',text,attachments:[{private:'never returned'}]}]}),bytes=Buffer.byteLength(raw);
  fs.writeFileSync(h.file,raw);fs.writeFileSync(path.join(h.root,'save-journal.json'),'preserve interrupted save');const names=fs.readdirSync(h.root),offset=text.toLocaleLowerCase().indexOf('needle');
  assert.deepEqual(await request(h.worker,{query:' NEEDLE ',remainingBytes:bytes}),{id,bytes,scanned:true,match:text.slice(offset-30,offset+120).replace(/\s+/g,' ')});
  assert.deepEqual(await request(h.worker,{query:'absent'}),{id,bytes,scanned:true});assert.equal(fs.readFileSync(h.file,'utf8'),raw);assert.equal(fs.readFileSync(path.join(h.root,'save-journal.json'),'utf8'),'preserve interrupted save');assert.deepEqual(fs.readdirSync(h.root),names);assert.deepEqual(fs.readdirSync(h.directory),[id+'.json']);
});

test('history search applies the same message ID, role and text filtering as Store',async t=>{
  const h=fixture(t),messages=[null,{id:'dup',role:'user',text:'no match'},{id:'dup',role:'assistant',text:'needle duplicate'},{id:'bad-role',role:'tool',text:'needle private tool'},{id:'',role:'assistant',text:'needle empty ID'},{id:'x'.repeat(257),role:'user',text:'needle long ID'},{id:'bad-type',role:'system',text:3},{id:'kept',role:'system',text:'SYSTEM NEEDLE preserved'},{id:'later',role:'assistant',text:'needle later'}];
  const raw=JSON.stringify({id,source:'onggi_bot',messages});fs.writeFileSync(h.file,raw);assert.deepEqual(await request(h.worker,{}),{id,bytes:Buffer.byteLength(raw),scanned:true,match:'SYSTEM NEEDLE preserved'});
  const active=messages.slice(0,-2);assert.deepEqual(await request(h.worker,{activeMessages:active}),{id,bytes:Buffer.byteLength(JSON.stringify({messages:active})),scanned:true});
});

test('active messages are searched and budgeted in the worker without a saved history file',async t=>{
  const h=fixture(t),activeMessages=[{id:'active',role:'assistant',text:'live needle',images:[{metadata:'count this entire object'}]}],bytes=Buffer.byteLength(JSON.stringify({messages:activeMessages}));
  assert.deepEqual(await request(h.worker,{activeMessages,remainingBytes:bytes}),{id,bytes,scanned:true,match:'live needle'});assert.deepEqual(await request(h.worker,{activeMessages,remainingBytes:bytes-1}),{id,bytes:0,scanned:false,limited:true});
  assert.deepEqual(fs.readdirSync(h.directory),[]);assert.deepEqual(await request(h.worker,{activeMessages:[]}),{id,bytes:Buffer.byteLength('{"messages":[]}'),scanned:true});assert.deepEqual(await request(h.worker,{activeMessages:{}}),{id,bytes:0,scanned:false,error:'unreadable'});
});

test('history file byte limits stop before reading and include the exact 32 MiB boundary',async t=>{
  const h=fixture(t),raw=JSON.stringify({id,source:'onggi_bot',messages:[{id:'text',role:'user',text:'needle'}]}),size=Buffer.byteLength(raw);fs.writeFileSync(h.file,raw);
  assert.deepEqual(await request(h.worker,{remainingBytes:size-1}),{id,bytes:0,scanned:false,limited:true});assert.deepEqual(await request(h.worker,{remainingBytes:size}),{id,bytes:size,scanned:true,match:'needle'});
  const descriptor=fs.openSync(h.file,'r+');fs.ftruncateSync(descriptor,32*1024*1024+1);fs.closeSync(descriptor);assert.deepEqual(await request(h.worker,{}),{id,bytes:0,scanned:false,limited:true});
  fs.writeFileSync(h.file,raw+' '.repeat(32*1024*1024-size));assert.deepEqual(await request(h.worker,{}),{id,bytes:32*1024*1024,scanned:true,match:'needle'});
});

test('malformed JSON, invalid UTF8 and mismatched ownership are unreadable while missing files stay distinct',async t=>{
  const h=fixture(t);assert.deepEqual(await request(h.worker,{}),{id,bytes:0,scanned:false,error:'missing'});
  for(const raw of [Buffer.from('{'),Buffer.from([0xff]),Buffer.from('null'),Buffer.from(JSON.stringify({id:'22222222-2222-4222-8222-222222222222',source:'onggi_bot',messages:[]})),Buffer.from(JSON.stringify({id,source:'external',messages:[]})),Buffer.from(JSON.stringify({id,source:'onggi_bot',messages:{}}))]){
    fs.writeFileSync(h.file,raw);assert.deepEqual(await request(h.worker,{}),{id,bytes:raw.length,scanned:false,error:'unreadable'});assert.deepEqual(fs.readFileSync(h.file),raw);
  }
});

test('history search rejects path traversal, noncanonical UUIDs, symlinks and malformed budgets',async t=>{
  const h=fixture(t),outside=path.join(h.root,'outside.json');fs.writeFileSync(outside,JSON.stringify({id,source:'onggi_bot',messages:[{id:'outside',role:'user',text:'needle secret'}]}));fs.symlinkSync(outside,h.file);
  assert.deepEqual(await request(h.worker,{}),{id,bytes:0,scanned:false,error:'unreadable'});assert.ok(fs.lstatSync(h.file).isSymbolicLink());assert.ok(fs.readFileSync(outside,'utf8').includes('needle secret'));
  for(const invalid of ['../outside','ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF',[id],'1'.repeat(36)])assert.deepEqual(await request(h.worker,{id:invalid}),{id:invalid,bytes:0,scanned:false,error:'unreadable'});
  for(const remainingBytes of [-1,1.5,32*1024*1024+1,NaN,'100'])assert.deepEqual(await request(h.worker,{remainingBytes}),{id,bytes:0,scanned:false,error:'unreadable'});
  for(const query of ['', ' ', 'x'.repeat(201),null])assert.deepEqual(await request(h.worker,{query}),{id,bytes:0,scanned:false,error:'unreadable'});
  fs.unlinkSync(h.file);fs.rmdirSync(h.directory);fs.symlinkSync(h.root,h.directory);assert.deepEqual(await request(h.worker,{}),{id,bytes:0,scanned:false,error:'unreadable'});
});

test('history search distinguishes read permission failures without exposing private paths',async t=>{
  if(process.platform==='win32'||process.getuid?.()===0){t.skip('POSIX file permissions require an unprivileged process');return;}
  const h=fixture(t);fs.writeFileSync(h.file,JSON.stringify({id,source:'onggi_bot',messages:[]}));fs.chmodSync(h.file,0);
  try{const result=await request(h.worker,{});assert.equal(result.error,'permission');assert.equal(result.scanned,false);assert.equal(JSON.stringify(result).includes(h.root),false);}finally{fs.chmodSync(h.file,0o600);}
});

test('history search binds each reader allocation to its reserved size and conservatively charges failed reads',()=>{
  const vm=require('node:vm'),directory='/fixture/conversations',raw=Buffer.from(JSON.stringify({id,source:'onggi_bot',messages:[{id:'hit',role:'assistant',text:'needle'}]})),readerSource=fs.readFileSync(path.join(__dirname,'../src/bounded-file.cjs'),'utf8'),workerSource=fs.readFileSync(path.join(__dirname,'../src/history-search-worker.cjs'),'utf8');
  for(const scenario of ['growth','normal','short']){
    let lstatCalls=0,fstatCalls=0,readBytes=0,listener,reply;const allocations=[],outerSize=scenario==='growth'?1:raw.length,innerSize=scenario==='growth'?32*1024*1024:raw.length;
    const fakeFs={constants:fs.constants,realpathSync:file=>file,openSync:()=>1,closeSync(){},lstatSync:()=>({dev:1,ino:1,size:++lstatCalls===1?outerSize:innerSize,mtimeMs:1,ctimeMs:1,isFile:()=>true,isSymbolicLink:()=>false}),fstatSync:()=>({dev:1,ino:1,size:innerSize,mtimeMs:scenario==='growth'&&++fstatCalls>1?2:1,ctimeMs:1,isFile:()=>true,isSymbolicLink:()=>false}),readSync:(_descriptor,buffer,offset,length)=>{const count=Math.min(length,(scenario==='short'?raw.length-1:innerSize)-readBytes);if(scenario!=='growth')raw.copy(buffer,offset,readBytes,readBytes+count);readBytes+=count;return count;}};
    const readerContext=vm.createContext({module:{exports:{}},require:name=>name==='node:fs'?fakeFs:require(name),process:{versions:{}},__dirname:'/fixture/src',Buffer:{alloc:size=>{allocations.push(size);return Buffer.alloc(size);}}});vm.runInContext(readerSource,readerContext);
    const parentPort={on:(_event,callback)=>{listener=callback;},postMessage:value=>{reply=value;}},workerContext=vm.createContext({require:name=>name==='node:fs'?fakeFs:name==='node:worker_threads'?{parentPort,workerData:{historyDirectory:directory}}:name==='./bounded-file.cjs'?readerContext.module.exports:require(name),Buffer,TextDecoder});vm.runInContext(workerSource,workerContext);
    listener({id,query:'needle',remainingBytes:32*1024*1024});
    if(scenario==='growth'){assert.deepEqual(allocations,[],JSON.stringify({outerSize,innerSize,allocations,readBytes,reply}));assert.equal(readBytes,0);assert.equal(reply.bytes,1);assert.equal(reply.scanned,false);assert.equal(reply.error,'unreadable');}
    else{assert.deepEqual(allocations,[outerSize+1]);assert.equal(reply.bytes,outerSize);assert.equal(readBytes,scenario==='short'?outerSize-1:outerSize);assert.equal(reply.scanned,scenario==='normal');if(scenario==='normal')assert.equal(reply.match,'needle');else assert.equal(reply.error,'unreadable');}
  }
});
