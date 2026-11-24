const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {setImmediate}=require('node:timers');
const {AttachmentStore}=require('../src/attachments.cjs'),{ResponseImages}=require('../src/response-images.cjs'),{Store}=require('../src/store.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4P8EBiBggFAA1rgc9lj6CJAAAAABJRU5ErkJggg==','base64');

test('attachments keep immutable file/image snapshots and only metadata survives Store reload',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-attachments-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const images=new ResponseImages(path.join(root,'images'),{validate:async p=>{p.thumbnail=p.imageFiles[0].source;}}),library=new AttachmentStore(path.join(root,'attachments'),images);
  const file=path.join(root,'한글 공백 $(literal).md'),picture=path.join(root,'picture.png');fs.writeFileSync(file,'first snapshot');fs.writeFileSync(picture,png);
  const [document,image]=await library.import([file,picture]);assert.equal(document.kind,'file');assert.equal(image.kind,'image');assert.equal(document.extension,'.md');assert.equal(image.width,2);
  fs.writeFileSync(file,'changed source');fs.writeFileSync(picture,'changed source');assert.equal(fs.readFileSync(library.read(document).file,'utf8'),'first snapshot');assert.ok(fs.readFileSync(library.read(image).file).equals(png));
  const store=new Store(path.join(root,'profile'),{});store.data.messages=[{id:'u',role:'user',text:'inspect',status:'queued',attachments:[document,image]}];store.save();const restored=new Store(store.directory,{});
  assert.equal(restored.data.messages[0].status,'interrupted');assert.deepEqual(restored.data.messages[0].attachments,[document,image]);assert.ok(!JSON.stringify(restored.data.messages).includes(root));assert.equal(fs.readFileSync(file,'utf8'),'changed source');
  fs.writeFileSync(library.read(document).file,'tampered');assert.throws(()=>library.read(document),/변경/);
});

test('file selection rejects links, directories, empty/oversized files and unsupported image selection',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-attachment-bounds-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const library=new AttachmentStore(path.join(root,'attachments'),{});
  const empty=path.join(root,'empty'),large=path.join(root,'large'),text=path.join(root,'plain.txt'),link=path.join(root,'link');fs.writeFileSync(empty,'');fs.writeFileSync(large,'x');fs.truncateSync(large,17*1024*1024);fs.writeFileSync(text,'preserve');fs.symlinkSync(text,link);
  for(const file of [empty,large,link,root])await assert.rejects(library.import([file]),/파일|16MiB/);await assert.rejects(library.import([text],{imagesOnly:true}),/PNG/);await assert.rejects(library.import(Array(9).fill(text)),/8개/);assert.equal(fs.readFileSync(text,'utf8'),'preserve');
});

test('clipboard bytes are captured immutably and reject unsafe names and inconsistent input',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-clipboard-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let release;const images=new ResponseImages(path.join(root,'images'),{validate:async pack=>{await new Promise(resolve=>{release=resolve;});pack.thumbnail=pack.imageFiles[0].source;}}),library=new AttachmentStore(path.join(root,'attachments'),images);
  const source=Buffer.from(png),pending=library.import([{name:'붙여넣기.png',bytes:source}],{imagesOnly:true});
  const deadline=Date.now()+1000;while(!release&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(release);source.fill(0);release();
  const [image]=await pending;assert.ok(fs.readFileSync(library.read(image).file).equals(png));
  for(const entry of [{name:'../escape.png',bytes:png},{name:'x.png',bytes:'not bytes'},{name:'x.png',bytes:Buffer.alloc(0)},{name:'x.png',bytes:png,path:root}])await assert.rejects(library.import([entry]),/첨부|파일/);
  await assert.rejects(library.import([{name:'unsupported.png',bytes:Buffer.from('ordinary text')}],{imagesOnly:true}),/PNG/);
});

test('attachment quota counts orphan files, deduplicates and never follows a replaced storage root',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-attachment-quota-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const library=new AttachmentStore(path.join(root,'attachments'),{}),source=path.join(root,'source.txt');fs.writeFileSync(source,'keep');
  const [first]=await library.import([source]),[duplicate]=await library.import([source]);assert.equal(first.hash,duplicate.hash);assert.equal(fs.readdirSync(library.root).length,1);
  const orphan=path.join(library.root,'orphan');fs.writeFileSync(orphan,'x');fs.truncateSync(orphan,512*1024*1024);fs.writeFileSync(source,'different');await assert.rejects(library.import([source]),/512MiB/);assert.equal(fs.readFileSync(library.read(first).file,'utf8'),'keep');
  fs.renameSync(library.root,library.root+'-old');fs.symlinkSync(library.root+'-old',library.root);assert.throws(()=>library.read(first),/폴더|경로/);await assert.rejects(library.import([source]),/폴더/);
});

test('invalid attachment references and response-only attachments are stripped on restart',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-attachment-records-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root,{});
  store.data.messages=[{id:'u',role:'user',text:'keep',status:'completed',attachments:[{id:'../escape',kind:'file',hash:'a'.repeat(64),extension:'.txt',name:'bad',bytes:3}]},{id:'a',role:'assistant',text:'answer',status:'completed',attachments:[{path:'/unowned'}]}];store.save();const restored=new Store(root,{});assert.deepEqual(restored.data.messages[0].attachments,[]);assert.equal(restored.data.messages[1].attachments,undefined);
});

test('large attachment quota scans yield between chunks and preserve all eight inputs and deduplication',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-attachment-chunks-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const library=new AttachmentStore(path.join(root,'attachments'),{});
  for(let index=0;index<256;index++)fs.writeFileSync(path.join(library.root,'orphan-'+String(index).padStart(4,'0')),'x');
  let ticks=0,finished=false;const heartbeat=()=>{if(!finished){ticks++;setImmediate(heartbeat);}};setImmediate(heartbeat);
  const inputs=Array.from({length:8},(_,index)=>({name:'input-'+index+'.txt',bytes:Buffer.from('owned content '+index)}));let imported;
  try{imported=await library.import(inputs);}finally{finished=true;}
  assert.ok(ticks>=2,'the shared baseline must yield at both 128-entry boundaries');assert.equal(imported.length,8);
  for(let index=0;index<8;index++)assert.ok(fs.readFileSync(library.read(imported[index]).file).equals(inputs[index].bytes));
  const duplicate=await library.import(inputs);assert.deepEqual(duplicate.map(item=>item.hash),imported.map(item=>item.hash));assert.equal(fs.readdirSync(library.root).length,264);
});

test('yielding attachment quota scans reject replaced roots and changed listings before writing new files',async t=>{
  for(const mode of ['replacement-directory','replacement-link','add','remove','late-child-link']){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-attachment-race-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const library=new AttachmentStore(path.join(root,'attachments'),{}),outside=path.join(root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'preserve.txt'),'external original');
    for(let index=0;index<512;index++)fs.writeFileSync(path.join(library.root,'orphan-'+String(index).padStart(4,'0')),'original');
    const entry=path.join(library.root,'orphan-0511');let mutated=false;
    const mutation=new Promise((resolve,reject)=>setImmediate(()=>{
      try{
        if(mode==='replacement-directory'||mode==='replacement-link'){
          fs.renameSync(library.root,library.root+'-old');
          if(mode==='replacement-directory'){fs.mkdirSync(library.root);fs.writeFileSync(path.join(library.root,'preserve.txt'),'replacement original');}
          else fs.symlinkSync(outside,library.root);
        }else if(mode==='add')fs.writeFileSync(path.join(library.root,'added-user.txt'),'user addition');
        else if(mode==='remove')fs.unlinkSync(entry);
        else{fs.unlinkSync(entry);fs.symlinkSync(path.join(outside,'preserve.txt'),entry);}
        mutated=true;resolve();
      }catch(error){reject(error);}
    }));
    await assert.rejects(library.import([{name:'new.txt',bytes:Buffer.from('must never be stored')}]),/첨부 폴더/);await mutation;assert.equal(mutated,true,mode);
    assert.deepEqual(fs.readdirSync(outside),['preserve.txt']);assert.equal(fs.readFileSync(path.join(outside,'preserve.txt'),'utf8'),'external original');
    const original=mode.startsWith('replacement-')?library.root+'-old':library.root;
    assert.equal(fs.readFileSync(path.join(original,'orphan-0000'),'utf8'),'original');assert.ok(fs.readdirSync(original).every(name=>!name.includes('.tmp-')&&!/^[a-f0-9]{64}\.txt$/.test(name)),mode);
    if(mode==='replacement-directory'){assert.deepEqual(fs.readdirSync(library.root),['preserve.txt']);assert.equal(fs.readFileSync(path.join(library.root,'preserve.txt'),'utf8'),'replacement original');}
    if(mode==='add')assert.equal(fs.readFileSync(path.join(library.root,'added-user.txt'),'utf8'),'user addition');
    if(mode==='remove')assert.equal(fs.existsSync(entry),false);
    if(mode==='late-child-link')assert.equal(fs.lstatSync(entry).isSymbolicLink(),true);
  }
});

test('chunked attachment quotas accept the exact limit, reject overflow and still deduplicate owned bytes',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-attachment-chunk-limit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const library=new AttachmentStore(path.join(root,'attachments'),{});
  for(let index=0;index<256;index++)fs.writeFileSync(path.join(library.root,'orphan-'+index),'');
  const orphan=path.join(library.root,'sparse-quota');fs.writeFileSync(orphan,'');fs.truncateSync(orphan,512*1024*1024-4);
  const [first]=await library.import([{name:'exact.txt',bytes:Buffer.from('keep')}]);assert.equal(fs.readFileSync(library.read(first).file,'utf8'),'keep');
  await assert.rejects(library.import([{name:'overflow.txt',bytes:Buffer.from('x')}]),/512MiB/);
  const [duplicate]=await library.import([{name:'same.txt',bytes:Buffer.from('keep')}]);assert.equal(duplicate.hash,first.hash);assert.equal(fs.readdirSync(library.root).length,258);assert.equal(fs.statSync(orphan).size,512*1024*1024-4);
});

test('a batch observes unrelated cache growth even when directory timestamps stay unchanged',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-attachment-batch-growth-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const library=new AttachmentStore(path.join(root,'attachments'),{});
  const [first]=await library.import([{name:'first.txt',bytes:Buffer.from('keep')}]),orphan=path.join(library.root,'orphan');fs.writeFileSync(orphan,'x');
  const readdir=fs.readdirSync;let scans=0,unchanged=false;
  fs.readdirSync=function(directory,...args){
    if(directory===library.root&&++scans===2){const before=fs.statSync(library.root);fs.truncateSync(orphan,512*1024*1024-4);const after=fs.statSync(library.root);unchanged=before.dev===after.dev&&before.ino===after.ino&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs;}
    return readdir.call(this,directory,...args);
  };
  try{await assert.rejects(library.import([{name:'duplicate.txt',bytes:Buffer.from('keep')},{name:'new.txt',bytes:Buffer.from('x')}]),/512MiB|파일이 변경/);}finally{fs.readdirSync=readdir;}
  assert.equal(scans,2);assert.equal(unchanged,true);assert.equal(fs.readFileSync(library.read(first).file,'utf8'),'keep');assert.equal(fs.readdirSync(library.root).length,2);
});

test('duplicate entries in one batch verify cache content again after a same-size external edit',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-attachment-batch-hash-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const library=new AttachmentStore(path.join(root,'attachments'),{});
  const [first]=await library.import([{name:'first.txt',bytes:Buffer.from('keep')}]),file=library.read(first).file;
  const open=fs.openSync,readdir=fs.readdirSync;let reads=0,scans=0,unchanged=false;
  fs.readdirSync=function(directory,...args){if(directory===library.root)scans++;return readdir.call(this,directory,...args);};
  fs.openSync=function(target,...args){
    if(target===file&&typeof args[0]==='number'&&++reads===2){const before=fs.statSync(library.root);fs.writeFileSync(file,'evil');const after=fs.statSync(library.root);unchanged=before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs;}
    return open.call(this,target,...args);
  };
  try{await assert.rejects(library.import([{name:'same.txt',bytes:Buffer.from('keep')},{name:'same.txt',bytes:Buffer.from('keep')}]),/변경/);}finally{fs.openSync=open;fs.readdirSync=readdir;}
  assert.equal(scans,0);assert.equal(reads,2);assert.equal(unchanged,true);assert.equal(fs.readFileSync(file,'utf8'),'evil');assert.equal(fs.readdirSync(library.root).length,1);assert.throws(()=>library.read(first),/변경/);
});

test('attachment and image reads reject real FIFOs before and after a regular-file precheck without blocking',t=>{
  if(process.platform==='win32'||!fs.constants.O_NONBLOCK){t.skip('POSIX FIFO and nonblocking open are required');return;}
  const {spawnSync}=require('node:child_process'),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'onggi-special-files-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const script=`const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');const [root,attachmentsSource,imagesSource]=process.argv.slice(1),{AttachmentStore}=require(attachmentsSource),{ResponseImages}=require(imagesSource);(async()=>{for(const race of [false,true])for(const mode of ['import','saved','image-cache','file-cache']){const directory=path.join(root,mode+'-'+race);fs.mkdirSync(directory);const images=new ResponseImages(path.join(directory,'images'),{}),attachments=new AttachmentStore(path.join(directory,'attachments'),images),file=mode==='image-cache'?path.join(images.root,'a'.repeat(64)+'.png'):mode==='file-cache'?path.join(attachments.root,'a'.repeat(64)+'.txt'):path.join(directory,'source.png');const fifo=()=>{const result=spawnSync('mkfifo',[file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);};if(race)fs.writeFileSync(file,'original');else fifo();const open=fs.openSync,asyncOpen=fs.promises.open;let changed=false;const replace=target=>{if(race&&target===file&&!changed){changed=true;fs.unlinkSync(file);fifo();}};fs.openSync=function(target,...args){replace(target);return open(target,...args);};fs.promises.open=async function(target,...args){replace(target);return asyncOpen(target,...args);};try{if(mode==='import')await assert.rejects(attachments.import([file]),/파일|16MiB/);else if(mode==='saved'){const [image]=await images.capture({id:'fifo',type:'imageGeneration',status:'completed',savedPath:file},{workspace:directory});assert.equal(image.status,'failed');}else if(mode==='image-cache')assert.throws(()=>images.read({id:'a'.repeat(64),mime:'image/png'}));else assert.throws(()=>attachments.read({kind:'file',hash:'a'.repeat(64),extension:'.txt',bytes:1}));if(race)assert.equal(changed,true,mode);assert.equal(fs.lstatSync(file).isFIFO(),true);console.log(mode,race,'rejected');}finally{fs.openSync=open;fs.promises.open=asyncOpen;}}})().catch(error=>{console.error(error);process.exitCode=1;});`;
  const child=spawnSync(process.execPath,['-e',script,root,path.join(__dirname,'../src/attachments.cjs'),path.join(__dirname,'../src/response-images.cjs')],{encoding:'utf8',timeout:10000});
  assert.equal(child.error,undefined,child.stderr+'\n'+child.stdout);assert.equal(child.status,0,child.stderr+'\n'+child.stdout);assert.equal(child.stdout.trim().split('\n').length,8);
});

test('cache staging failures preserve collisions, external edits, replacements and unknown partial files',async t=>{
  for(const kind of ['attachment','image'])for(const scenario of ['collision','edit','replacement','partial','edited-success']){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-cache-stage-owner-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const images=new ResponseImages(path.join(root,'images'),{validate:async candidate=>{candidate.thumbnail=candidate.imageFiles[0].source;}}),attachments=new AttachmentStore(path.join(root,'files'),images),open=fs.promises.open,write=fs.promises.writeFile,owned=new WeakMap();let temporary;
    const opened=t.mock.method(fs.promises,'open',async(file,...args)=>{if(typeof file==='string'&&file.includes('.tmp-')&&args[0]==='wx'){temporary=file;if(scenario==='collision')fs.writeFileSync(file,'external collision',{flag:'wx'});}const handle=await open(file,...args);if(file===temporary)owned.set(handle,file);return handle;});
    const written=t.mock.method(fs.promises,'writeFile',async(file,bytes,...args)=>{if(!owned.has(file))return write(file,bytes,...args);if(scenario==='partial'){await write(file,bytes.subarray(0,2),...args);throw Error('incomplete cache write');}const result=await write(file,bytes,...args);if(scenario==='replacement'){fs.renameSync(temporary,temporary+'.owned-original');fs.writeFileSync(temporary,'external replacement',{flag:'wx'});}else fs.writeFileSync(temporary,'external edit');if(scenario!=='edited-success')throw Error('cache write failure');return result;});
    try{if(kind==='attachment')await assert.rejects(attachments.import([{name:'source.txt',bytes:Buffer.from('owned attachment')}]),scenario==='collision'?{code:'EEXIST'}:/failure|incomplete|변경/);else{const [image]=await images.capture({id:'owned',type:'imageGeneration',status:'completed',result:png.toString('base64')});assert.equal(image.status,'failed');}}finally{opened.mock.restore();written.mock.restore();}
    assert.ok(temporary&&fs.existsSync(temporary),kind+' '+scenario);const saved=fs.readFileSync(temporary);if(scenario==='partial')assert.ok(saved.equals((kind==='attachment'?Buffer.from('owned attachment'):png).subarray(0,2)));else assert.equal(saved.toString(),scenario==='collision'?'external collision':scenario==='replacement'?'external replacement':'external edit');
    const directory=kind==='attachment'?attachments.root:images.root;assert.ok(fs.readdirSync(directory).every(name=>name.includes('.tmp-')),kind+' '+scenario+' must not publish modified bytes');assert.equal(images.saveWork,null);
  }
});

test('quota scans reject in-place cache growth during a yield even when directory timestamps are unchanged',async t=>{
  const {setImmediate}=require('node:timers');
  for(const kind of ['attachment','image']){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-cache-yield-growth-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const images=new ResponseImages(path.join(root,'images'),{validate:async candidate=>{candidate.thumbnail=candidate.imageFiles[0].source;}}),attachments=new AttachmentStore(path.join(root,'files'),images),directory=kind==='attachment'?attachments.root:images.root;
    for(let i=0;i<256;i++)fs.writeFileSync(path.join(directory,'orphan-'+String(i).padStart(4,'0')),'');let unchanged=false;
    setImmediate(()=>{const before=fs.statSync(directory);fs.truncateSync(path.join(directory,'orphan-0000'),512*1024*1024);const after=fs.statSync(directory);unchanged=['dev','ino','mtimeMs','ctimeMs'].every(key=>before[key]===after[key]);});
    if(kind==='attachment')await assert.rejects(attachments.import([{name:'new.txt',bytes:Buffer.from('new')}]),/파일이 변경/);else{const [image]=await images.capture({id:'new',type:'imageGeneration',status:'completed',result:png.toString('base64')});assert.equal(image.status,'failed');assert.match(image.error,/파일이 변경/);}
    assert.equal(unchanged,true);assert.equal(fs.readdirSync(directory).length,256);assert.equal(fs.statSync(path.join(directory,'orphan-0000')).size,512*1024*1024);
  }
});
