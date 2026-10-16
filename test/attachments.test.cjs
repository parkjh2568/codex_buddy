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
  assert.ok(ticks>=16,'each of eight complete scans must yield at both 128-entry boundaries');assert.equal(imported.length,8);
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
