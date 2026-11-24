const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {setImmediate}=require('node:timers');
const {CacheQuotaBatch}=require('../src/cache-quota.cjs'),{AttachmentStore}=require('../src/attachments.cjs'),{ResponseImages}=require('../src/response-images.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4P8EBiBggFAA1rgc9lj6CJAAAAABJRU5ErkJggg==','base64');

test('batch quota snapshots reduce new-file stat work and verified duplicates perform no quota scan',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-quota-batch-cost-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const kind of ['file','image']){
    const images=new ResponseImages(path.join(root,kind+'-images'),{validate:async candidate=>{candidate.thumbnail=candidate.imageFiles[0].source;}}),attachments=new AttachmentStore(path.join(root,kind+'-files'),images),directory=kind==='file'?attachments.root:images.root;
    for(let i=0;i<256;i++)fs.writeFileSync(path.join(directory,'padding-'+i),'x');
    const inputs=Array.from({length:8},(_,i)=>({name:'input-'+i+'.txt',bytes:Buffer.from('owned-'+i)})),content=Array.from({length:8},(_,i)=>{const bytes=Buffer.from(png);bytes[bytes.length-1]^=i;return{type:'image',data:bytes.toString('base64')};}),item={id:'batch',type:'mcpToolCall',status:'completed',result:{content}};
    let stats=0,scans=0;const lstat=fs.lstatSync,readdir=fs.readdirSync;
    t.mock.method(fs,'lstatSync',(file,...args)=>{if(typeof file==='string'&&(file===directory||file.startsWith(directory+path.sep)))stats++;return lstat(file,...args);});
    t.mock.method(fs,'readdirSync',(file,...args)=>{if(file===directory)scans++;return readdir(file,...args);});
    const result=kind==='file'?await attachments.import(inputs):await images.capture(item);assert.equal(result.length,8);assert.ok(result.every(value=>kind==='file'||value.status==='ready'));
    assert.ok(stats<256*12,'retain baseline + final per-commit stat, not sixteen complete stat passes');assert.equal(scans,9);
    stats=0;scans=0;const repeated=kind==='file'?await attachments.import(inputs):await images.capture(item);assert.equal(repeated.length,8);assert.equal(scans,0);assert.ok(stats<100);t.mock.restoreAll();assert.equal(CacheQuotaBatch.activeRoots,0);
  }
});

test('quota is revalidated after asynchronous staging for growth and foreign listing changes',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-quota-publish-race-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const kind of ['file','image'])for(const mode of ['growth','add','remove','same-count-swap','temporary-gone']){
    const directory=path.join(root,kind+'-'+mode),images=new ResponseImages(directory,{validate:async candidate=>{candidate.thumbnail=candidate.imageFiles[0].source;}}),attachments=new AttachmentStore(directory,images),orphan=path.join(directory,'orphan');fs.writeFileSync(orphan,'x');
    const write=fs.promises.writeFile,open=fs.promises.open;let changed=false,unchanged=false,temporary;
    t.mock.method(fs.promises,'open',async(file,...args)=>{if(args[0]==='wx')temporary=file;return open(file,...args);});
    t.mock.method(fs.promises,'writeFile',async(...args)=>{const result=await write(...args);if(!changed){changed=true;const before=fs.statSync(directory);if(mode==='growth')fs.truncateSync(orphan,512*1024*1024);else if(mode==='add')fs.writeFileSync(path.join(directory,'foreign'),'preserve');else if(mode==='temporary-gone')fs.renameSync(temporary,path.join(directory,'foreign-temporary'));else{fs.unlinkSync(orphan);if(mode==='same-count-swap')fs.writeFileSync(path.join(directory,'foreign'),'preserve');}const after=fs.statSync(directory);unchanged=['dev','ino','mtimeMs','ctimeMs'].every(key=>before[key]===after[key]);}return result;});
    if(kind==='file')await assert.rejects(attachments.import([{name:'new.txt',bytes:Buffer.from('owned')}]),/파일이 변경/);else{const [image]=await images.capture({id:'new',type:'imageGeneration',status:'completed',result:png.toString('base64')});assert.equal(image.status,'failed');assert.match(image.error,/파일이 변경/);}
    t.mock.restoreAll();assert.equal(changed,true);if(mode==='growth'){assert.equal(unchanged,true);assert.equal(fs.statSync(orphan).size,512*1024*1024);}if(['add','same-count-swap'].includes(mode))assert.equal(fs.readFileSync(path.join(directory,'foreign'),'utf8'),'preserve');if(['remove','same-count-swap'].includes(mode))assert.equal(fs.existsSync(orphan),false);
    if(mode==='temporary-gone')assert.ok(fs.readFileSync(path.join(directory,'foreign-temporary')).equals(kind==='file'?Buffer.from('owned'):png));
    assert.ok(fs.readdirSync(directory).every(name=>!name.includes('.tmp-')&&!/^[a-f0-9]{64}\./.test(name)));assert.equal(CacheQuotaBatch.activeRoots,0);
  }
});

test('independent stores sharing one canonical root serialize quota commits and release ownership after failure',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-quota-shared-root-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const images=new ResponseImages(path.join(root,'cache'),{validate:async candidate=>{candidate.thumbnail=candidate.imageFiles[0].source;}}),attachments=new AttachmentStore(path.join(root,'cache'),images),padding=path.join(images.root,'padding');fs.writeFileSync(padding,'');fs.truncateSync(padding,512*1024*1024-png.length-1);
  let release,entered;const blocked=new Promise(resolve=>{entered=resolve;}),write=fs.promises.writeFile;let writes=0;
  t.mock.method(fs.promises,'writeFile',async(...args)=>{writes++;if(!release)await new Promise(resolve=>{release=resolve;entered();});return write(...args);});
  const first=images.capture({id:'first',type:'imageGeneration',status:'completed',result:png.toString('base64')});await blocked;
  const second=attachments.import([{name:'second.txt',bytes:Buffer.from('next')}]);await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,1);release();
  assert.equal((await first)[0].status,'ready');await assert.rejects(second,/512MiB/);t.mock.restoreAll();assert.equal(CacheQuotaBatch.activeRoots,0);
  fs.unlinkSync(padding);const third=new AttachmentStore(images.root,images);assert.equal((await third.import([{name:'after.txt',bytes:Buffer.from('next')}])).length,1);assert.equal(CacheQuotaBatch.activeRoots,0);
});

test('unrelated roots proceed while a writer is blocked and mixed same-root attachments do not nest locks',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onggi-quota-independent-roots-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const images=new ResponseImages(path.join(root,'shared'),{validate:async candidate=>{candidate.thumbnail=candidate.imageFiles[0].source;}}),shared=new AttachmentStore(images.root,images),other=new AttachmentStore(path.join(root,'other'),images),write=fs.promises.writeFile;let release,entered;
  const blocked=new Promise(resolve=>{entered=resolve;});t.mock.method(fs.promises,'writeFile',async(...args)=>{if(!release)await new Promise(resolve=>{release=resolve;entered();});return write(...args);});
  const first=shared.import([{name:'first.txt',bytes:Buffer.from('first')}]);await blocked;
  try{const second=await other.import([{name:'other.txt',bytes:Buffer.from('other')}]);assert.equal(second.length,1);assert.equal(CacheQuotaBatch.activeRoots,1);}finally{release();await first;t.mock.restoreAll();}
  const result=await shared.import([{name:'a.txt',bytes:Buffer.from('alpha')},{name:'image.png',bytes:png},{name:'b.txt',bytes:Buffer.from('beta')}]);assert.deepEqual(result.map(item=>item.kind),['file','image','file']);assert.equal(CacheQuotaBatch.activeRoots,0);for(const item of result)assert.ok(fs.existsSync(shared.read(item).file));
});
