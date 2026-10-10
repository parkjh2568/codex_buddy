const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
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
